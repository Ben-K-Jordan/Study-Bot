/**
 * POST /api/assistant/answer: answers a question from the student's course
 * materials, with numbered sources.
 *
 * 1. Search course materials (hybrid FTS + vector): first for passages with
 *    every word of the question, then, if none has them all, for passages
 *    with enough of its words (search.ts, match "any")
 * 2. Pass retrieved chunks + question to AI (ANSWER_WITH_CITATIONS)
 * 3. Renumber the sources so inline [n] matches sources[n - 1]
 * 4. When nothing is retrieved, or the model says the excerpts don't answer
 *    the question, reply with the app's own notice instead of AI text
 * 5. With save: true, store the question (first) and the answer in the
 *    course's chat history. A retry passes question_id so the question is
 *    stored once.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hybridSearch, type RetrievalMode } from "@/lib/search";
import { runTask, embed, GatewayError, type GatewayContext } from "@/lib/ai/gateway";
import { AiTask } from "@/lib/ai/types";
import { getPrompt } from "@/lib/ai/prompt-registry";
import { createProvider } from "@/lib/ai/provider-factory";
import { logger } from "@/lib/logger";
import { aiLimiter } from "@/lib/rate-limit";
import {
  failed,
  gatewayFailure,
  invalidInput,
  invalidJson,
  rateLimited,
  unauthorized,
} from "../../flashcards/_lib/http";
import { normalizeAnswer, noticeText, type ModelCitation, type StoredNotice } from "../../chat/_lib/sources";
import { MESSAGE_SELECT, toMessageDtos } from "../../chat/_lib/messages";

const QUESTION_MAX = 2000;

const answerRequestSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, "Type a question first.")
    .max(QUESTION_MAX, "Shorten your question to 2,000 characters."),
  course_name: z.string().trim().min(1).max(200),
  exam_name: z.string().trim().max(200).optional(),
  verbosity: z.enum(["SHORT", "MEDIUM", "LONG"]).default("MEDIUM"),
  retrieval_mode: z.enum(["FTS", "VECTOR", "HYBRID"]).optional(),
  top_k: z.number().int().min(1).max(10).default(5),
  /** Store the question and the answer in the course's chat history. */
  save: z.boolean().default(false),
  /** Retrying a question that is already stored: answer it without storing it again. */
  question_id: z.string().min(1).max(100).optional(),
});

interface AnswerOutput {
  answer_markdown: string;
  citations: ModelCitation[];
}

const EMBED_MODEL = process.env.AI_MODEL_EMBED || "text-embedding-3-small";
const ANSWER_MODEL = process.env.AI_MODEL_ANSWER || "gpt-4o-mini";
const NOT_ANSWERED = "Answer not generated. Retry.";

/**
 * What ANSWER_WITH_CITATIONS tells the model to write when the excerpts
 * don't answer the question. It's not an answer, so it gets the notice.
 */
const MODEL_NO_ANSWER = /^your materials don['’]t cover this( question)?\.?$/i;

/** The search mode hybridSearch would pick, so FTS-only setups skip the embedding call. */
function retrievalMode(requested: RetrievalMode | undefined): RetrievalMode {
  return requested ?? (process.env.HYBRID_SEARCH_ENABLED === "true" ? "HYBRID" : "FTS");
}

const provider = createProvider();

export async function POST(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return unauthorized();

  const rl = aiLimiter.check(userId);
  if (!rl.allowed) return rateLimited(rl.retryAfterMs);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidJson();
  }

  const parsed = answerRequestSchema.safeParse(body);
  if (!parsed.success) {
    const questionIssue = parsed.error.issues.find((i) => i.path[0] === "question");
    return invalidInput(parsed.error, questionIssue?.message ?? "Choose a course, then ask again.");
  }

  const { question, course_name, exam_name, verbosity, retrieval_mode, top_k, save, question_id } = parsed.data;
  const examName = exam_name || undefined;
  const courseKey = examName ? `${course_name}||${examName}` : course_name;
  const ctx: GatewayContext = { userId, provider };

  // Store the question before anything can fail, so it's never lost.
  let questionRow: Awaited<ReturnType<typeof saveQuestion>> | null = null;
  if (save) {
    try {
      questionRow = await saveQuestion(userId, courseKey, question, question_id);
    } catch (err) {
      if (err instanceof QuestionMissingError) {
        return failed("This question isn't in your chat history anymore. Ask it again.", 404, "QUESTION_NOT_FOUND");
      }
      logger.error("assistant.question_save_failed", { userId, error: String(err) });
      return failed("Question not saved. Retry.");
    }
  }
  const questionDto = questionRow ? (await toMessageDtos(userId, courseKey, [questionRow]))[0] : null;
  const extra = questionDto ? { question: questionDto } : undefined;

  try {
    const mode = retrievalMode(retrieval_mode);
    // Generate query embedding for vector/hybrid search
    let queryEmbedding: number[] | undefined;
    if (mode !== "FTS") {
      try {
        const embedResult = await embed(ctx, [question], EMBED_MODEL);
        queryEmbedding = embedResult.embeddings[0];
      } catch {
        // Fall back to FTS if embedding fails
        logger.warn("assistant.embed_fallback", { userId, reason: "embed_failed" });
      }
    }

    // Retrieve relevant chunks. Passages with every word of the question
    // come first; a question rarely repeats its passage word for word
    // ("Why does an ID selector beat any number of class selectors?"), so
    // when none has them all, passages with enough of its words count.
    const search = {
      userId,
      q: question,
      namespace: "COURSE" as const,
      courseName: course_name,
      examName,
      topK: top_k,
      embedding: queryEmbedding,
      mode,
    };
    let searchResults = await hybridSearch({ ...search, match: "all" });
    if (searchResults.length === 0) searchResults = await hybridSearch({ ...search, match: "any" });

    // Say plainly why there's no answer; never fill the gap with unsourced text.
    const replyWithNotice = async (notice: StoredNotice["notice"], chunksRetrieved: number) => {
      const content = noticeText(notice, course_name);
      const answer = save ? await saveAnswer(userId, courseKey, content, { notice }) : null;
      return NextResponse.json({
        answer_markdown: content,
        citations: [],
        sources: [],
        kind: "notice",
        meta: { chunks_retrieved: chunksRetrieved },
        ...extra,
        ...(answer ? { answer } : {}),
      });
    };

    if (searchResults.length === 0) {
      return replyWithNotice(await noticeFor(userId, course_name, examName), 0);
    }

    // Build AI task input
    const chunks = searchResults.map((r) => ({
      chunk_id: r.chunk_id,
      title: r.doc_title,
      page: r.page_number ?? undefined,
      text: r.snippet,
    }));

    const prompt = getPrompt(AiTask.ANSWER_WITH_CITATIONS);

    const result = await runTask<AnswerOutput>(ctx, {
      task: AiTask.ANSWER_WITH_CITATIONS,
      promptVersion: prompt.version,
      model: ANSWER_MODEL,
      input: { question, chunks, verbosity },
      parseOutput: (raw) => raw as AnswerOutput,
    });

    const rawMarkdown = typeof result.output.answer_markdown === "string" ? result.output.answer_markdown.trim() : "";
    if (!rawMarkdown) throw new GatewayError("EMPTY_OUTPUT", "The model returned no answer", true);

    const normalized = normalizeAnswer(
      rawMarkdown,
      Array.isArray(result.output.citations) ? result.output.citations : [],
      searchResults,
    );

    // The model found nothing in the excerpts: that's the notice, not an AI answer
    if (normalized.citations.length === 0 && MODEL_NO_ANSWER.test(normalized.markdown.trim())) {
      return replyWithNotice("no_match", searchResults.length);
    }

    const answer = save ? await saveAnswer(userId, courseKey, normalized.markdown, normalized.citations) : null;

    return NextResponse.json({
      answer_markdown: normalized.markdown,
      citations: normalized.citations,
      sources: answer?.sources ?? (await toMessageDtos(userId, courseKey, [syntheticRow(normalized.markdown, normalized.citations)]))[0].sources,
      kind: "answer",
      meta: {
        chunks_retrieved: searchResults.length,
        cache_hit: result.meta.cacheHit,
        latency_ms: result.meta.latencyMs,
      },
      ...extra,
      ...(answer ? { answer } : {}),
    });
  } catch (err) {
    if (err instanceof GatewayError) return gatewayFailure(err, NOT_ANSWERED, extra);
    logger.error("assistant.answer_failed", { userId, error: String(err) });
    return failed(NOT_ANSWERED, 500, "SERVER_ERROR", extra);
  }
}

class QuestionMissingError extends Error {}

async function saveQuestion(userId: string, courseKey: string, question: string, questionId?: string) {
  if (questionId) {
    const existing = await prisma.chatMessage.findFirst({
      where: { id: questionId, userId, courseKey, role: "user" },
      select: MESSAGE_SELECT,
    });
    if (!existing) throw new QuestionMissingError();
    return existing;
  }
  return prisma.chatMessage.create({
    data: { userId, courseKey, role: "user", content: question },
    select: MESSAGE_SELECT,
  });
}

async function saveAnswer(userId: string, courseKey: string, content: string, citations: unknown) {
  const row = await prisma.chatMessage.create({
    data: { userId, courseKey, role: "assistant", content, citations: citations as object },
    select: MESSAGE_SELECT,
  });
  logger.info("chat.answer.saved", { userId, courseKey, messageId: row.id });
  return (await toMessageDtos(userId, courseKey, [row]))[0];
}

function syntheticRow(content: string, citations: unknown) {
  return { id: "unsaved", role: "assistant", content, citations, createdAt: new Date() };
}

/** Why retrieval found nothing: no files, files still processing, or nothing relevant. */
async function noticeFor(userId: string, courseName: string, examName?: string): Promise<StoredNotice["notice"]> {
  const where = { userId, namespace: "COURSE", courseName, ...(examName ? { examName } : {}) };
  const [uploaded, ready] = await Promise.all([
    prisma.contentDocument.count({ where }),
    prisma.contentDocument.count({ where: { ...where, status: "PROCESSED" } }),
  ]);
  if (uploaded === 0) return "no_materials";
  if (ready === 0) return "processing";
  return "no_match";
}
