import { prisma } from "@/lib/db";
import { searchChunks, buildFeedbackQuery, type SearchResult } from "@/lib/search";
import { logger } from "@/lib/logger";
import { captureException } from "@/lib/error-reporter";
import type { FeedbackExcerpt } from "@/services/content";
import { runTask } from "@/lib/ai/gateway";
import type { GatewayContext } from "@/lib/ai/gateway";
import { AiTask } from "@/lib/ai/types";
import { getPrompt } from "@/lib/ai/prompt-registry";
import { createProvider } from "@/lib/ai/provider-factory";

export interface FeedbackResponse {
  status: "OK" | "UNAVAILABLE";
  excerpts: FeedbackExcerpt[];
  // AI explanation (PARTIAL/INCORRECT)
  explanation?: string;
  key_takeaway?: string;
  // Concept connections (all scores)
  concept_connection?: string;
  // Mnemonic (PARTIAL/INCORRECT)
  mnemonic?: string;
  // Mistake pattern advice (PARTIAL/INCORRECT)
  pattern_advice?: string;
  // Reinforcement (CORRECT)
  reinforcement?: string;
  deeper_insight?: string;
  // Socratic follow-up (all scores)
  socratic_followup?: string;
  socratic_purpose?: string;
}

/**
 * Generate feedback for a scored attempt. Called via the deferred feedback endpoint.
 *
 * 1. If citations already exist, return them (idempotent).
 * 2. Otherwise, check objective anchors first, then fall back to FTS.
 * 3. Store AttemptCitation rows and return excerpts.
 * 4. For PARTIAL/INCORRECT: AI explanation + concept connections + mnemonics + mistake patterns.
 * 5. For CORRECT: AI reinforcement + concept connections.
 * 6. For all: Socratic follow-up question.
 * 7. On failure, return { status: "UNAVAILABLE" } — never throw.
 */
export async function generateFeedback(
  userId: string,
  attemptId: string
): Promise<FeedbackResponse> {
  const ftsStart = Date.now();

  try {
    // Load attempt with run + session context
    const attempt = await prisma.sessionAttempt.findUnique({
      where: { id: attemptId },
      include: {
        run: {
          include: {
            session: {
              select: { courseName: true, examName: true, objectives: true },
            },
          },
        },
        citations: {
          include: {
            chunk: {
              include: { document: { select: { title: true } } },
            },
          },
          orderBy: { rank: "asc" },
        },
      },
    });

    if (!attempt) return { status: "UNAVAILABLE", excerpts: [] };
    if (attempt.run.userId !== userId) return { status: "UNAVAILABLE", excerpts: [] };

    // Idempotent: if citations already exist, return them
    if (attempt.citations.length > 0) {
      const excerpts: FeedbackExcerpt[] = attempt.citations.map((c) => ({
        chunk_id: c.chunkId,
        doc_title: c.chunk.document.title,
        page_number: c.chunk.pageNumber,
        snippet: c.snippet,
        rank: c.rank,
      }));
      logger.info("feedback.cached", { attempt_id: attemptId, count: excerpts.length });
      return { status: "OK", excerpts };
    }

    const session = attempt.run.session;
    const courseName = session.courseName;
    const examName = session.examName;
    const isCorrect = attempt.selfScore === "CORRECT";

    // For CORRECT answers: generate reinforcement + Socratic follow-up
    if (isCorrect) {
      const [reinforcement, socratic] = await Promise.all([
        generateReinforcement(
          userId, attempt.promptText, attempt.userAnswer || "", courseName, examName,
        ),
        generateSocraticFollowup(
          userId, attempt.promptText, attempt.userAnswer || "", "CORRECT",
          undefined, courseName, examName,
        ),
      ]);
      return { status: "OK", excerpts: [], ...reinforcement, ...socratic };
    }

    // For unscored: nothing to do
    if (attempt.selfScore === null) {
      return { status: "OK", excerpts: [] };
    }

    // Fetch error log, prompt row, and mistake patterns in parallel
    const [errorLog, promptRow, mistakePatterns] = await Promise.all([
      prisma.sessionErrorLog.findFirst({
        where: { runId: attempt.runId, promptIndex: attempt.promptIndex },
      }),
      prisma.sessionRunPrompt.findUnique({
        where: { runId_promptIndex: { runId: attempt.runId, promptIndex: attempt.promptIndex } },
      }),
      detectMistakePatterns(userId, courseName),
    ]);
    const objectives = session.objectives as { id: string; title: string }[] | null;
    const objectiveTitle = promptRow?.objectiveId
      ? objectives?.find((o) => o.id === promptRow.objectiveId)?.title
      : objectives?.[0]?.title;

    // Phase 3: Try objective anchors first
    let results: SearchResult[] = [];
    if (promptRow?.objectiveId) {
      results = await tryObjectiveAnchors(
        userId, courseName, examName, promptRow.objectiveId
      );
    }

    // Fall back to FTS if anchors returned nothing
    if (results.length === 0) {
      const query = buildFeedbackQuery(
        attempt.promptText,
        errorLog?.correctionRule,
        objectiveTitle
      );

      results = await searchChunks({
        userId,
        q: query,
        namespace: "COURSE",
        courseName,
        examName,
        topK: 5,
      });

      if (results.length === 0) {
        results = await searchChunks({
          userId,
          q: query,
          namespace: "COURSE",
          courseName,
          topK: 5,
        });
      }
    }

    const ftsMs = Date.now() - ftsStart;

    if (results.length === 0) {
      logger.info("feedback.empty", { attempt_id: attemptId, fts_ms: ftsMs });
      return { status: "OK", excerpts: [] };
    }

    // Store citations in parallel
    const excerpts: FeedbackExcerpt[] = await Promise.all(
      results.map(async (r, i) => {
        await prisma.attemptCitation.upsert({
          where: {
            attemptId_chunkId: { attemptId, chunkId: r.chunk_id },
          },
          create: {
            attemptId,
            chunkId: r.chunk_id,
            rank: i + 1,
            snippet: r.snippet,
          },
          update: {
            rank: i + 1,
            snippet: r.snippet,
          },
        });
        return {
          chunk_id: r.chunk_id,
          doc_title: r.doc_title,
          page_number: r.page_number,
          snippet: r.snippet,
          rank: i + 1,
        };
      })
    );

    // Generate AI explanation and Socratic follow-up in parallel
    const [aiExplanation, socratic] = await Promise.all([
      generateAIExplanation(
        userId,
        attempt.promptText,
        attempt.userAnswer || "",
        attempt.selfScore || "INCORRECT",
        errorLog?.errorType,
        errorLog?.correctionRule,
        mistakePatterns,
        results,
      ),
      generateSocraticFollowup(
        userId, attempt.promptText, attempt.userAnswer || "",
        attempt.selfScore || "INCORRECT", undefined, courseName, examName,
      ),
    ]);

    logger.info("feedback.generated", {
      attempt_id: attemptId,
      count: excerpts.length,
      has_explanation: !!aiExplanation?.explanation,
      has_socratic: !!socratic?.socratic_followup,
      has_patterns: mistakePatterns.length > 0,
      fts_ms: ftsMs,
    });

    return { status: "OK", excerpts, ...aiExplanation, ...socratic };
  } catch (err: unknown) {
    captureException(err, { user_id: userId, attempt_id: attemptId, action: "generateFeedback" });
    logger.error("feedback.failed", { user_id: userId, attempt_id: attemptId, error: String(err) });
    return { status: "UNAVAILABLE", excerpts: [] };
  }
}

// ---- Mistake Pattern Detection ----

interface MistakePattern {
  error_type: string;
  count: number;
}

/**
 * Detect recurring mistake patterns for a user+course.
 * Looks at the last 50 error logs and groups by error type.
 * Returns patterns with 3+ occurrences.
 */
async function detectMistakePatterns(
  userId: string,
  courseName: string,
): Promise<MistakePattern[]> {
  try {
    const recentErrors = await prisma.sessionErrorLog.findMany({
      where: {
        userId,
        run: {
          session: { courseName },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { errorType: true },
    });

    if (recentErrors.length === 0) return [];

    // Group by error type
    const counts = new Map<string, number>();
    for (const err of recentErrors) {
      counts.set(err.errorType, (counts.get(err.errorType) || 0) + 1);
    }

    // Return patterns with 3+ occurrences (meaningful pattern)
    return Array.from(counts.entries())
      .filter(([, count]) => count >= 3)
      .map(([error_type, count]) => ({ error_type, count }))
      .sort((a, b) => b.count - a.count);
  } catch (err) {
    logger.error("feedback.pattern_detection_failed", { user_id: userId, error: String(err) });
    return [];
  }
}

// ---- AI Explanation (PARTIAL/INCORRECT) ----

async function generateAIExplanation(
  userId: string,
  question: string,
  userAnswer: string,
  selfScore: string,
  errorType?: string | null,
  correctionRule?: string | null,
  mistakePatterns: MistakePattern[] = [],
  searchResults: SearchResult[] = [],
): Promise<{
  explanation?: string;
  key_takeaway?: string;
  concept_connection?: string;
  mnemonic?: string;
  pattern_advice?: string;
}> {
  const providerName = process.env.AI_PROVIDER || "mock";
  if (providerName === "mock") return {};

  try {
    const gatewayCtx: GatewayContext = { userId, provider: createProvider() };
    const prompt = getPrompt(AiTask.GENERATE_FEEDBACK);

    const result = await runTask<{
      explanation: string;
      key_takeaway: string;
      concept_connection: string | null;
      mnemonic: string | null;
      pattern_advice: string | null;
      referenced_chunk_ids: string[];
    }>(
      gatewayCtx,
      {
        task: AiTask.GENERATE_FEEDBACK,
        model: process.env.AI_MODEL_ANSWER || "gpt-4o-mini",
        promptVersion: prompt.version,
        input: {
          question,
          userAnswer,
          selfScore,
          errorType: errorType || undefined,
          correctionRule: correctionRule || undefined,
          mistakePatterns: mistakePatterns.length > 0 ? mistakePatterns : undefined,
          chunks: searchResults.map((r) => ({
            chunk_id: r.chunk_id,
            title: r.doc_title,
            page: r.page_number,
            text: r.snippet,
          })),
        },
        parseOutput: (raw: unknown) => {
          const data = raw as Record<string, unknown>;
          return {
            explanation: (data.explanation as string) || "",
            key_takeaway: (data.key_takeaway as string) || "",
            concept_connection: (data.concept_connection as string) || null,
            mnemonic: (data.mnemonic as string) || null,
            pattern_advice: (data.pattern_advice as string) || null,
            referenced_chunk_ids: (data.referenced_chunk_ids as string[]) || [],
          };
        },
      },
    );

    return {
      explanation: result.output.explanation || undefined,
      key_takeaway: result.output.key_takeaway || undefined,
      concept_connection: result.output.concept_connection || undefined,
      mnemonic: result.output.mnemonic || undefined,
      pattern_advice: result.output.pattern_advice || undefined,
    };
  } catch (err) {
    logger.error("feedback.ai_explanation_failed", { user_id: userId, error: String(err) });
    return {};
  }
}

// ---- Reinforcement (CORRECT) ----

async function generateReinforcement(
  userId: string,
  question: string,
  userAnswer: string,
  courseName: string,
  examName: string,
): Promise<{ reinforcement?: string; deeper_insight?: string; concept_connection?: string }> {
  const providerName = process.env.AI_PROVIDER || "mock";
  if (providerName === "mock") return {};

  try {
    const results = await searchChunks({
      userId,
      q: question,
      namespace: "COURSE",
      courseName,
      examName,
      topK: 3,
    });

    const gatewayCtx: GatewayContext = { userId, provider: createProvider() };
    const prompt = getPrompt(AiTask.REINFORCE_CORRECT);

    const result = await runTask<{ reinforcement: string; deeper_insight: string; concept_connection: string | null }>(
      gatewayCtx,
      {
        task: AiTask.REINFORCE_CORRECT,
        model: process.env.AI_MODEL_ANSWER || "gpt-4o-mini",
        promptVersion: prompt.version,
        input: {
          question,
          userAnswer,
          chunks: results.map((r) => ({
            chunk_id: r.chunk_id,
            title: r.doc_title,
            page: r.page_number,
            text: r.snippet,
          })),
        },
        parseOutput: (raw: unknown) => {
          const data = raw as Record<string, unknown>;
          return {
            reinforcement: (data.reinforcement as string) || "",
            deeper_insight: (data.deeper_insight as string) || "",
            concept_connection: (data.concept_connection as string) || null,
          };
        },
      },
    );

    return {
      reinforcement: result.output.reinforcement || undefined,
      deeper_insight: result.output.deeper_insight || undefined,
      concept_connection: result.output.concept_connection || undefined,
    };
  } catch (err) {
    logger.error("feedback.reinforcement_failed", { user_id: userId, error: String(err) });
    return {};
  }
}

// ---- Socratic Follow-up ----

async function generateSocraticFollowup(
  userId: string,
  question: string,
  userAnswer: string,
  selfScore: string,
  explanation: string | undefined,
  courseName: string,
  examName: string,
): Promise<{ socratic_followup?: string; socratic_purpose?: string }> {
  const providerName = process.env.AI_PROVIDER || "mock";
  if (providerName === "mock") return {};

  try {
    const results = await searchChunks({
      userId,
      q: question,
      namespace: "COURSE",
      courseName,
      examName,
      topK: 3,
    });

    const gatewayCtx: GatewayContext = { userId, provider: createProvider() };
    const prompt = getPrompt(AiTask.SOCRATIC_FOLLOWUP);

    const result = await runTask<{ followup_question: string; purpose: string }>(
      gatewayCtx,
      {
        task: AiTask.SOCRATIC_FOLLOWUP,
        model: process.env.AI_MODEL_ANSWER || "gpt-4o-mini",
        promptVersion: prompt.version,
        input: {
          question,
          userAnswer,
          selfScore,
          explanation,
          chunks: results.map((r) => ({
            chunk_id: r.chunk_id,
            title: r.doc_title,
            page: r.page_number,
            text: r.snippet,
          })),
        },
        parseOutput: (raw: unknown) => {
          const data = raw as Record<string, unknown>;
          return {
            followup_question: (data.followup_question as string) || "",
            purpose: (data.purpose as string) || "",
          };
        },
      },
    );

    return {
      socratic_followup: result.output.followup_question || undefined,
      socratic_purpose: result.output.purpose || undefined,
    };
  } catch (err) {
    logger.error("feedback.socratic_failed", { user_id: userId, error: String(err) });
    return {};
  }
}

// ---- Objective Anchors ----

async function tryObjectiveAnchors(
  userId: string,
  courseName: string,
  examName: string,
  objectiveId: string
): Promise<SearchResult[]> {
  try {
    const anchors = await prisma.objectiveAnchor.findMany({
      where: { userId, courseName, examName, objectiveId },
      orderBy: { rank: "asc" },
      take: 5,
      include: {
        chunk: {
          include: { document: { select: { id: true, title: true } } },
        },
      },
    });

    if (anchors.length === 0) return [];

    return anchors.map((a) => ({
      chunk_id: a.chunkId,
      doc_id: a.chunk.document.id,
      doc_title: a.chunk.document.title,
      page_number: a.chunk.pageNumber,
      rank_score: 1.0 / a.rank,
      snippet: a.chunk.text.slice(0, 300),
    }));
  } catch (err) {
    logger.error("feedback.anchor_lookup_failed", { error: String(err) });
    return [];
  }
}
