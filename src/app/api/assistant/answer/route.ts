/**
 * POST /api/assistant/answer — RAG-powered study assistant.
 *
 * 1. Search course materials (hybrid FTS+vector)
 * 2. Pass retrieved chunks + question to AI (ANSWER_WITH_CITATIONS)
 * 3. Return answer with citations
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getUserId } from "@/lib/auth";
import { hybridSearch } from "@/lib/search";
import { runTask, embed, GatewayError, type GatewayContext } from "@/lib/ai/gateway";
import { AiTask } from "@/lib/ai/types";
import { getPrompt } from "@/lib/ai/prompt-registry";
import { MockProvider } from "@/lib/ai/providers/mock";
import type { AiProvider } from "@/lib/ai/provider";
import { logger } from "@/lib/logger";

const answerRequestSchema = z.object({
  question: z.string().min(1).max(2000),
  course_name: z.string().min(1),
  exam_name: z.string().optional(),
  verbosity: z.enum(["SHORT", "MEDIUM", "LONG"]).default("MEDIUM"),
  retrieval_mode: z.enum(["FTS", "VECTOR", "HYBRID"]).optional(),
  top_k: z.number().int().min(1).max(10).default(5),
});

interface AnswerOutput {
  answer_markdown: string;
  citations: { chunk_id: string; reason: string; quote_snippet: string }[];
}

function getProvider(): AiProvider {
  const name = process.env.AI_PROVIDER || "mock";
  if (name === "mock") return new MockProvider();
  throw new Error(`Unknown AI_PROVIDER: ${name}`);
}

const EMBED_MODEL = process.env.AI_MODEL_EMBED || "text-embedding-3-small";
const ANSWER_MODEL = process.env.AI_MODEL_ANSWER || "gpt-4o-mini";

export async function POST(request: NextRequest) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = answerRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { question, course_name, exam_name, verbosity, retrieval_mode, top_k } = parsed.data;
  const provider = getProvider();
  const ctx: GatewayContext = { userId, provider };

  try {
    // Generate query embedding for vector/hybrid search
    let queryEmbedding: number[] | undefined;
    if (retrieval_mode !== "FTS") {
      try {
        const embedResult = await embed(ctx, [question], EMBED_MODEL);
        queryEmbedding = embedResult.embeddings[0];
      } catch {
        // Fall back to FTS if embedding fails
        logger.warn("assistant.embed_fallback", { userId, reason: "embed_failed" });
      }
    }

    // Retrieve relevant chunks
    const searchResults = await hybridSearch({
      userId,
      q: question,
      namespace: "COURSE",
      courseName: course_name,
      examName: exam_name,
      topK: top_k,
      embedding: queryEmbedding,
      mode: retrieval_mode,
    });

    if (searchResults.length === 0) {
      return NextResponse.json({
        answer_markdown: "I couldn't find any relevant materials in your course documents to answer this question. Try uploading more materials or rephrasing your question.",
        citations: [],
        meta: { chunks_retrieved: 0 },
      });
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

    return NextResponse.json({
      answer_markdown: result.output.answer_markdown,
      citations: result.output.citations,
      meta: {
        chunks_retrieved: searchResults.length,
        cache_hit: result.meta.cacheHit,
        latency_ms: result.meta.latencyMs,
        model: result.meta.model,
      },
    });
  } catch (err) {
    if (err instanceof GatewayError) {
      const status = err.code === "BUDGET_EXCEEDED" ? 429 : err.code === "AI_DISABLED" ? 503 : 502;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    logger.error("assistant.answer_failed", { userId, error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
