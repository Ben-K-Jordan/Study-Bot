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
import type { Prisma } from "../../generated/prisma/client";

export interface FeedbackResponse {
  status: "OK" | "UNAVAILABLE" | "NOT_FOUND" | "PENDING";
  excerpts: FeedbackExcerpt[];
  /**
   * Explicit terminal no-sources marker: search found nothing in the user's
   * materials for this attempt. Persisted READY (like any generated result)
   * so polling clients resolve to an honest "nothing in your materials"
   * state instead of treating the empty payload as still-loading.
   */
  no_sources?: boolean;
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
 * Feedback generation lifecycle (persisted on SessionAttempt):
 *
 *   feedbackStatus: NONE -> GENERATING (claimed) -> READY
 *
 * - The claim is taken atomically via updateMany({ where: { feedbackStatus:
 *   "NONE" } }), so a concurrent GET and an eager submit-path call can never
 *   both run the AI generation.
 * - While GENERATING, feedbackJson holds { feedbackClaimedAt: ISO } — the
 *   claim timestamp. Readers only trust feedbackJson as a FeedbackResponse
 *   when feedbackStatus is READY.
 * - Stale-claim policy: a GENERATING row whose claim stamp is older than
 *   2 minutes (or unparsable) is treated as abandoned — the worker crashed
 *   before its catch block could reset the status — and may be reclaimed.
 *   The reclaim compare-and-swaps on the old stamp so two readers cannot
 *   both reclaim the same stale row.
 * - On generation failure, the claim is released (feedbackStatus back to
 *   NONE) so a later request can retry.
 *
 * Rationale: elaborated feedback has one of the largest effect sizes in the
 * feedback literature (Van der Kleij 2015, g = 0.49) — it must survive
 * refetch instead of being regenerated (or silently dropped) on every GET.
 */
const STALE_CLAIM_MS = 2 * 60 * 1000;

function loadAttempt(attemptId: string) {
  return prisma.sessionAttempt.findUnique({
    where: { id: attemptId },
    include: {
      run: {
        include: {
          session: {
            select: { courseName: true, examName: true, objectives: true },
          },
        },
      },
    },
  });
}

type LoadedAttempt = NonNullable<Awaited<ReturnType<typeof loadAttempt>>>;

/** Read the claim stamp stored inside feedbackJson while GENERATING. */
function readClaimStamp(json: unknown): string | null {
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const value = (json as Record<string, unknown>).feedbackClaimedAt;
    if (typeof value === "string") return value;
  }
  return null;
}

function newClaimStamp(): { feedbackClaimedAt: string } {
  return { feedbackClaimedAt: new Date().toISOString() };
}

/**
 * Atomically claim generation for a loaded attempt. Returns true when this
 * caller now owns generation, false when another caller does (live claim).
 */
async function claimGeneration(attempt: LoadedAttempt): Promise<boolean> {
  const data = { feedbackStatus: "GENERATING", feedbackJson: newClaimStamp() };

  if (attempt.feedbackStatus === "GENERATING") {
    // Stale-claim recovery: claims newer than 2 minutes belong to a live
    // worker — do not duplicate its AI calls.
    const stamp = readClaimStamp(attempt.feedbackJson);
    const claimedMs = stamp === null ? NaN : Date.parse(stamp);
    if (!Number.isNaN(claimedMs) && Date.now() - claimedMs < STALE_CLAIM_MS) {
      return false;
    }
    if (stamp !== null) {
      // CAS on the old stamp so two readers cannot both reclaim a stale row.
      const reclaimed = await prisma.sessionAttempt.updateMany({
        where: {
          id: attempt.id,
          feedbackStatus: "GENERATING",
          feedbackJson: { path: ["feedbackClaimedAt"], equals: stamp },
        },
        data,
      });
      if (reclaimed.count > 0) {
        logger.info("feedback.claim_reclaimed", { attempt_id: attempt.id, stale_stamp: stamp });
      }
      return reclaimed.count > 0;
    }
    // GENERATING without a stamp (unexpected): reclaim on status alone.
    const reclaimed = await prisma.sessionAttempt.updateMany({
      where: { id: attempt.id, feedbackStatus: "GENERATING" },
      data,
    });
    return reclaimed.count > 0;
  }

  // Normal path: atomically claim NONE -> GENERATING. Matching on the loaded
  // status (rather than hardcoding "NONE") also self-heals the unexpected
  // READY-with-null-feedbackJson state, which would otherwise never regenerate.
  const claimed = await prisma.sessionAttempt.updateMany({
    where: { id: attempt.id, feedbackStatus: attempt.feedbackStatus },
    data,
  });
  return claimed.count > 0;
}

/**
 * Release a held claim so a later request can retry. Leaves feedbackJson
 * as-is: readers only trust it when feedbackStatus is READY, and the next
 * claim overwrites it.
 */
async function releaseClaim(attemptId: string): Promise<void> {
  await prisma.sessionAttempt.updateMany({
    where: { id: attemptId, feedbackStatus: "GENERATING" },
    data: { feedbackStatus: "NONE" },
  });
}

/**
 * Generate feedback for a scored attempt. Called via the deferred feedback
 * endpoint (GET) — see generateFeedbackEager for the submit-path variant.
 *
 * 1. If persisted feedback exists (feedbackStatus READY), return it verbatim.
 * 2. If another caller is generating (GENERATING, claim < 2 min old), return
 *    { status: "PENDING" } so the client polls instead of duplicating work.
 * 3. Otherwise claim generation, run it, persist the full FeedbackResponse
 *    into feedbackJson, and return it.
 * 4. For PARTIAL/INCORRECT: AI explanation + concept connections + mnemonics
 *    + mistake patterns. For CORRECT: AI reinforcement + concept connections.
 *    For all: Socratic follow-up question.
 * 5. On failure, release the claim and return { status: "UNAVAILABLE" } —
 *    never throw.
 * 6. For missing attempts or attempts owned by another user, return
 *    { status: "NOT_FOUND" }.
 */
export async function generateFeedback(
  userId: string,
  attemptId: string
): Promise<FeedbackResponse> {
  try {
    const attempt = await loadAttempt(attemptId);

    if (!attempt) return { status: "NOT_FOUND", excerpts: [] };
    if (attempt.run.userId !== userId) return { status: "NOT_FOUND", excerpts: [] };

    // Idempotent: persisted feedback is returned verbatim — the elaborated
    // AI fields survive refetch (previously only citation excerpts did).
    if (attempt.feedbackStatus === "READY" && attempt.feedbackJson != null) {
      logger.info("feedback.cached", { attempt_id: attemptId });
      return attempt.feedbackJson as unknown as FeedbackResponse;
    }

    // Unscored (EXAM phase): nothing to generate yet. Do not claim or
    // persist, so feedback still generates once the attempt is scored.
    if (attempt.selfScore === null) {
      return { status: "OK", excerpts: [] };
    }

    const claimed = await claimGeneration(attempt);
    if (!claimed) {
      // Another request/worker owns generation (or just finished) — client polls.
      logger.info("feedback.pending", { attempt_id: attemptId });
      return { status: "PENDING", excerpts: [] };
    }

    return await generateAndPersist(userId, attempt);
  } catch (err: unknown) {
    // Pre-claim failure (e.g. the attempt load): no claim is held here, so
    // there is nothing to release — generateAndPersist handles its own.
    captureException(err, { user_id: userId, attempt_id: attemptId, action: "generateFeedback" });
    logger.error("feedback.failed", { user_id: userId, attempt_id: attemptId, error: String(err) });
    return { status: "UNAVAILABLE", excerpts: [] };
  }
}

/**
 * Eagerly generate feedback right after an attempt is submitted (Kulik &
 * Kulik 1988: immediate feedback outperforms delayed). Intended to be called
 * fire-and-forget from the submit path.
 *
 * Atomically claims generation (NONE -> GENERATING); returns null when the
 * claim is lost — another caller owns generation or feedback is already
 * READY — so a concurrent GET and this eager call never both run the AI
 * generation.
 */
export async function generateFeedbackEager(
  userId: string,
  attemptId: string
): Promise<FeedbackResponse | null> {
  let claimed = false;
  try {
    const claim = await prisma.sessionAttempt.updateMany({
      where: { id: attemptId, feedbackStatus: "NONE" },
      data: { feedbackStatus: "GENERATING", feedbackJson: newClaimStamp() },
    });
    if (claim.count === 0) return null;
    claimed = true;

    const attempt = await loadAttempt(attemptId);
    if (!attempt || attempt.run.userId !== userId) {
      await releaseClaim(attemptId);
      return { status: "NOT_FOUND", excerpts: [] };
    }

    // Unscored (EXAM phase): release so the post-scoring request can claim.
    if (attempt.selfScore === null) {
      await releaseClaim(attemptId);
      return { status: "OK", excerpts: [] };
    }

    return await generateAndPersist(userId, attempt);
  } catch (err: unknown) {
    captureException(err, { user_id: userId, attempt_id: attemptId, action: "generateFeedbackEager" });
    logger.error("feedback.eager_failed", { user_id: userId, attempt_id: attemptId, error: String(err) });
    if (claimed) {
      await releaseClaim(attemptId).catch(() => {});
    }
    return { status: "UNAVAILABLE", excerpts: [] };
  }
}

/**
 * Run generation while holding the claim, persist the result (READY), and
 * release the claim (back to NONE) on failure so a later request can retry.
 */
async function generateAndPersist(
  userId: string,
  attempt: LoadedAttempt
): Promise<FeedbackResponse> {
  try {
    const result = await generateContent(userId, attempt);

    // Persist the full FeedbackResponse so refetch/polling returns it
    // verbatim and never re-runs the AI calls. updateMany tolerates the
    // attempt having been deleted while generation ran (eager generation
    // races test cleanup / account deletion) — 0 rows is a clean no-op.
    await prisma.sessionAttempt.updateMany({
      where: { id: attempt.id },
      data: {
        feedbackStatus: "READY",
        feedbackJson: result as unknown as Prisma.InputJsonValue,
      },
    });

    return result;
  } catch (err: unknown) {
    captureException(err, { user_id: userId, attempt_id: attempt.id, action: "generateFeedback" });
    logger.error("feedback.failed", { user_id: userId, attempt_id: attempt.id, error: String(err) });
    await releaseClaim(attempt.id).catch((releaseErr) => {
      logger.error("feedback.claim_release_failed", {
        attempt_id: attempt.id,
        error: String(releaseErr),
      });
    });
    return { status: "UNAVAILABLE", excerpts: [] };
  }
}

/**
 * The actual generation work. Assumes the caller holds the GENERATING claim
 * and that the attempt is scored (selfScore != null). Throws on failure —
 * generateAndPersist owns error handling.
 */
async function generateContent(
  userId: string,
  attempt: LoadedAttempt
): Promise<FeedbackResponse> {
  const ftsStart = Date.now();
  const attemptId = attempt.id;
  const session = attempt.run.session;
  const courseName = session.courseName;
  const examName = session.examName;

  // For CORRECT answers: generate reinforcement + Socratic follow-up
  if (attempt.selfScore === "CORRECT") {
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

    // Run both scoped (with examName) and unscoped searches in parallel
    const [scopedResults, unscopedResults] = await Promise.all([
      searchChunks({ userId, q: query, namespace: "COURSE", courseName, examName, topK: 5 }),
      searchChunks({ userId, q: query, namespace: "COURSE", courseName, topK: 5 }),
    ]);
    results = scopedResults.length > 0 ? scopedResults : unscopedResults;
  }

  const ftsMs = Date.now() - ftsStart;

  if (results.length === 0) {
    logger.info("feedback.empty", { attempt_id: attemptId, fts_ms: ftsMs });
    // Terminal state: generateAndPersist stores this as READY, so refetches
    // return it verbatim and the client stops polling. Without the explicit
    // marker this payload is indistinguishable from "not generated yet".
    return { status: "OK", excerpts: [], no_sources: true };
  }

  // Build excerpts and store citations in a single batch transaction
  const excerpts: FeedbackExcerpt[] = results.map((r, i) => ({
    chunk_id: r.chunk_id,
    doc_title: r.doc_title,
    page_number: r.page_number,
    snippet: r.snippet,
    rank: i + 1,
  }));

  await prisma.$transaction(
    results.map((r, i) =>
      prisma.attemptCitation.upsert({
        where: { attemptId_chunkId: { attemptId, chunkId: r.chunk_id } },
        create: { attemptId, chunkId: r.chunk_id, rank: i + 1, snippet: r.snippet },
        update: { rank: i + 1, snippet: r.snippet },
      }),
    ),
  );

  // Generate AI explanation and Socratic follow-up in parallel
  const [aiExplanation, socratic] = await Promise.all([
    generateAIExplanation(
      userId,
      attempt.promptText,
      attempt.userAnswer || "",
      attempt.selfScore || "INCORRECT",
      attempt.confidenceRating,
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

// ---- Model output guards ----

/**
 * Model output is untrusted JSON. Only accept real strings — any other shape
 * (number, array, object, null) is dropped so malformed fields never reach
 * feedbackJson. A bare `as string` cast would let e.g. a numeric
 * `explanation: 42` survive `|| undefined` (truthy) and get persisted.
 */
function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Coerce untrusted model output into a plain record for field extraction. */
function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

// ---- AI Explanation (PARTIAL/INCORRECT) ----

async function generateAIExplanation(
  userId: string,
  question: string,
  userAnswer: string,
  selfScore: string,
  confidence: number | null | undefined,
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
          // Hypercorrection (Butterfield & Metcalfe 2001): pre-answer
          // confidence lets the template correct high-confidence errors
          // more emphatically.
          confidence: confidence ?? undefined,
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
          const data = asRecord(raw);
          return {
            explanation: stringOrNull(data.explanation) ?? "",
            key_takeaway: stringOrNull(data.key_takeaway) ?? "",
            concept_connection: stringOrNull(data.concept_connection),
            mnemonic: stringOrNull(data.mnemonic),
            pattern_advice: stringOrNull(data.pattern_advice),
            referenced_chunk_ids: Array.isArray(data.referenced_chunk_ids)
              ? data.referenced_chunk_ids.filter((id): id is string => typeof id === "string")
              : [],
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
          const data = asRecord(raw);
          return {
            reinforcement: stringOrNull(data.reinforcement) ?? "",
            deeper_insight: stringOrNull(data.deeper_insight) ?? "",
            concept_connection: stringOrNull(data.concept_connection),
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
          const data = asRecord(raw);
          return {
            followup_question: stringOrNull(data.followup_question) ?? "",
            purpose: stringOrNull(data.purpose) ?? "",
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
    // Anchor rows may be keyed by the exact examName or by "" (the build
    // API treats exam_name as optional). Fetch both keys and prefer exact
    // matches so legacy ""-keyed rows still serve the fast path.
    const anchors = await prisma.objectiveAnchor.findMany({
      where: { userId, courseName, examName: { in: [examName, ""] }, objectiveId },
      orderBy: { rank: "asc" },
      take: 10, // up to 5 per examName key
      include: {
        chunk: {
          include: { document: { select: { id: true, title: true } } },
        },
      },
    });

    if (anchors.length === 0) return [];

    const exactMatches = anchors.filter((a) => a.examName === examName);
    const selected = (exactMatches.length > 0 ? exactMatches : anchors).slice(0, 5);

    return selected.map((a) => ({
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
