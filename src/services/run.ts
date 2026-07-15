import { prisma } from "@/lib/db";
import { generateSessionId } from "@/lib/session-id";
import {
  generateRetrievalPrompts,
  generateInterleavedPrompts,
  generateExamSimPrompts,
  generateErrorRepairPrompts,
  interleaveByObjective,
  type Prompt,
  type ErrorLogForRepair,
} from "@/lib/prompts";
import { generateContentAwarePrompts } from "@/lib/content-prompts";
import { generateWorkedExampleDeck } from "@/lib/worked-examples";
import { generateFeedbackEager } from "@/services/feedback";
import { followupsFromDueDates } from "@/lib/spacing";
import { createProvider } from "@/lib/ai/provider-factory";
import type { GatewayContext } from "@/lib/ai/gateway";
import { initBreakState, checkBreakNeeded, type BreakState } from "@/lib/breaks";
import { computeFollowups } from "@/lib/spacing";
import { updateMastery, getDueObjectives, accuracyToQuality, confidenceAdjustedQuality } from "@/lib/mastery";
import { logger } from "@/lib/logger";
import { captureException } from "@/lib/error-reporter";
import type {
  SubmitAttemptInput,
  ExamAnswerInput,
  ExamScoreInput,
  AttemptPayload,
  RunnableMode,
} from "@/lib/validation";
import { RUNNABLE_MODES } from "@/lib/validation";
import { generateVariantQuestion, MAX_VARIANTS_PER_SESSION } from "@/lib/variant-questions";
import { createFlashcardsFromErrors } from "@/lib/auto-flashcards";

// ---- Sentinel errors for transaction control flow ----

class DuplicateAttemptError extends Error {
  constructor() { super("duplicate_attempt"); }
}
class WrongIndexError extends Error {
  expected: number;
  constructor(expected: number) { super("wrong_index"); this.expected = expected; }
}
class RunCompletedError extends Error {
  constructor() { super("run_completed"); }
}

// ---- Types ----

export interface RunPolicies {
  scoring: "IMMEDIATE" | "DELAYED";
  requiresErrorLogOn: string[];
  allowHintsBeforeAnswer: boolean;
  allowEndBreakEarly: boolean;
}

export interface RunMetrics {
  attempts_count: number;
  correct_count: number;
  partial_count: number;
  incorrect_count: number;
  accuracy: number;
  time_spent_seconds: number;
  // Pretest items are diagnostic (Richland 2009) — tracked separately so
  // expected pre-study errors never contaminate accuracy or mastery.
  pretest_count?: number;
  pretest_correct?: number;
  recommended_followups?: { label: string; days_from_now: number; date: string }[];
}

export interface PromptView {
  prompt_index: number;
  text: string;
  objective_id?: string;
  difficulty?: number;
  source_type?: string;
  format?: "FREE_RECALL" | "MCQ";
  choices?: string[];
  correctIndex?: number;
  meta?: {
    distractorRationales?: string[];
    /** Deck-pack marker (PRE_TEST, WORKED_EXAMPLE, WE_*) — drives UI framing. */
    pack?: string;
    [key: string]: unknown;
  };
}

function emptyMetrics(): RunMetrics {
  return {
    attempts_count: 0,
    correct_count: 0,
    partial_count: 0,
    incorrect_count: 0,
    accuracy: 0,
    time_spent_seconds: 0,
  };
}

function policiesForMode(mode: string): RunPolicies {
  switch (mode) {
    case "EXAM_SIM":
      return {
        scoring: "DELAYED",
        requiresErrorLogOn: ["PARTIAL", "INCORRECT"],
        allowHintsBeforeAnswer: false,
        allowEndBreakEarly: true,
      };
    case "ERROR_REPAIR":
    case "INTERLEAVED_PRACTICE":
    case "RETRIEVAL":
    default:
      return {
        scoring: "IMMEDIATE",
        requiresErrorLogOn: ["PARTIAL", "INCORRECT"],
        allowHintsBeforeAnswer: false,
        allowEndBreakEarly: true,
      };
  }
}

function initialPhaseForMode(mode: string): string {
  return mode === "EXAM_SIM" ? "EXAM" : "ACTIVE";
}

/**
 * Convert a generated Prompt to a PromptView for API responses.
 *
 * The answer key (correctIndex, distractorRationales) is withheld unless
 * includeAnswer is true — it is only exposed during EXAM_SIM REVIEW, after
 * all answers are locked in. Immediate-scoring modes grade MCQ selections
 * server-side, so the client never needs the key before answering.
 */
function toPromptView(prompt: Prompt, index: number, includeAnswer = false): PromptView {
  const view: PromptView = {
    prompt_index: index,
    text: prompt.text,
    objective_id: prompt.objective_id,
    difficulty: prompt.difficulty,
  };
  if (prompt.format === "MCQ" && prompt.choices) {
    view.format = "MCQ";
    view.choices = prompt.choices;
    if (includeAnswer && prompt.correctIndex != null) {
      view.correctIndex = prompt.correctIndex;
      if (prompt.meta?.distractorRationales) {
        view.meta = { distractorRationales: prompt.meta.distractorRationales };
      }
    }
  }
  // Error-repair context (not an answer key) — lets the UI show which
  // question the repair prompt refers to.
  if (prompt.meta?.original_prompt_text) {
    view.meta = { ...(view.meta ?? {}), original_prompt_text: prompt.meta.original_prompt_text };
  }
  // Pack marker (PRE_TEST etc.) drives client framing; not sensitive.
  if (prompt.meta?.pack) {
    view.meta = { ...(view.meta ?? {}), pack: prompt.meta.pack };
  }
  return view;
}

/**
 * Redact answer keys from a raw prompts array before returning it to the
 * client (run start/resume and GET /runs/:id responses include the full
 * deck; without redaction that response is a one-click answer key).
 */
function redactPrompts(prompts: Prompt[]): Prompt[] {
  return prompts.map((p) => {
    const { correctIndex: _ci, ...rest } = p;
    let meta = p.meta;
    if (meta) {
      const {
        distractorRationales: _dr,
        expected_correction_rule: _ecr,
        model_answer: _ma,
        key_points: _kp,
        ...metaRest
      } = meta;
      meta = Object.keys(metaRest).length > 0 ? metaRest : undefined;
    }
    return { ...rest, meta } as Prompt;
  });
}

// ---- Post-completion side effects ----

/**
 * Shared post-completion work: mastery update, flashcard generation,
 * plan item completion. Called from all three completion paths
 * (handleImmediateScoring, handleExamScore, completeRun) to ensure
 * consistency.
 */
async function runPostCompletionEffects(
  userId: string,
  runId: string,
  sessionId: string,
): Promise<void> {
  try {
    const s = await prisma.session.findUnique({
      where: { sessionId },
      select: { courseName: true },
    });
    if (!s) return;

    await updateObjectiveMastery(userId, runId, s.courseName);

    // Replace the fixed-offset follow-up ladder with the actual SM-2 due
    // dates just computed (Cepeda 2008: the review gap should come from the
    // scheduler, not a static table). Falls back to the fixed ladder when no
    // mastery rows exist.
    try {
      const dueRows = await prisma.objectiveMastery.findMany({
        where: { userId, courseName: s.courseName, nextDueAt: { not: null } },
        orderBy: { nextDueAt: "asc" },
        take: 3,
        select: { nextDueAt: true },
      });
      const followups = followupsFromDueDates(
        dueRows.map((r) => r.nextDueAt!).filter(Boolean),
      );
      if (followups.length > 0) {
        const runRow = await prisma.sessionRun.findUnique({
          where: { runId },
          select: { metrics: true },
        });
        if (runRow) {
          const m = runRow.metrics as unknown as RunMetrics;
          await prisma.sessionRun.update({
            where: { runId },
            data: { metrics: { ...m, recommended_followups: followups } as object },
          });
        }
      }
    } catch (fuErr) {
      logger.warn("followups.mastery_derived_failed", { user_id: userId, run_id: runId, error: String(fuErr) });
    }

    // Auto-generate flashcards from errors (Roediger & Butler 2011)
    try {
      await createFlashcardsFromErrors(userId, runId, s.courseName);
    } catch (fcErr) {
      logger.error("auto_flashcards.call_failed", { user_id: userId, run_id: runId, error: String(fcErr) });
    }

    // Auto-complete plan items linked to this session
    try {
      await completePlanItemsForSession(sessionId, runId);
    } catch (planErr) {
      logger.error("plan_item.auto_complete_failed", { user_id: userId, run_id: runId, error: String(planErr) });
    }
  } catch (masteryErr) {
    logger.error("mastery.update_failed", { user_id: userId, run_id: runId, error: String(masteryErr) });
  }
}

// ---- Start / Resume ----

export async function startOrResumeRun(userId: string, sessionId: string) {
  const session = await prisma.session.findUnique({ where: { sessionId } });
  if (!session) return { error: "session_not_found" as const };
  if (session.userId !== userId) return { error: "forbidden" as const };

  // Validate mode is runnable
  if (!(RUNNABLE_MODES as readonly string[]).includes(session.mode)) {
    return { error: "unsupported_mode" as const };
  }

  // Idempotent: return existing active run if present
  const existingRun = await prisma.sessionRun.findFirst({
    where: { sessionId: session.sessionId, userId, status: { in: ["CREATED", "ACTIVE"] } },
    orderBy: { createdAt: "desc" },
  });

  if (existingRun) {
    const breakState = existingRun.breakState as unknown as BreakState;
    const updatedBreakState = checkBreakNeeded(breakState);
    if (updatedBreakState !== breakState) {
      await prisma.sessionRun.update({
        where: { id: existingRun.id },
        data: { breakState: updatedBreakState as object },
      });
    }

    // Fetch current prompt from run_prompts table, falling back to JSONB.
    // MCQ answer keys are only included during EXAM_SIM REVIEW.
    const currentPrompt = await getPromptAt(
      existingRun.runId,
      existingRun.currentIndex,
      existingRun.prompts as unknown as Prompt[],
      existingRun.phase === "REVIEW",
    );

    logger.info("run.resumed", {
      user_id: userId,
      session_id: sessionId,
      run_id: existingRun.runId,
      current_index: existingRun.currentIndex,
      mode: existingRun.mode,
      phase: existingRun.phase,
    });

    return {
      data: {
        run_id: existingRun.runId,
        status: existingRun.status,
        mode: existingRun.mode,
        phase: existingRun.phase,
        current_index: existingRun.currentIndex,
        prompt_count: existingRun.promptCount,
        current_prompt: currentPrompt,
        answered_count: existingRun.answeredCount,
        scored_count: existingRun.scoredCount,
        prompts: redactPrompts(existingRun.prompts as unknown as Prompt[]),
        policies: existingRun.policies,
        metrics: existingRun.metrics,
        break_state: updatedBreakState,
        resumed: true,
      },
    };
  }

  // Generate deck based on mode
  const mode = session.mode as RunnableMode;
  const targetOutcome = session.targetOutcome as Record<string, unknown> | null;
  const objectives = session.objectives as { id: string; title: string }[] | null;
  const breakProtocol = session.breakProtocol as { type?: string; cycles?: number } | null;

  const sessionParams = {
    objectives,
    target_outcome: targetOutcome
      ? { prompt_count: targetOutcome.prompt_count as number | undefined }
      : null,
    topic_scope: session.topicScope,
  };

  const promptCount = targetOutcome?.prompt_count as number | undefined ?? 10;

  // Build AI gateway context for content-aware prompt generation
  let gatewayCtx: GatewayContext | null = null;
  const providerName = process.env.AI_PROVIDER || "mock";
  if (providerName !== "mock") {
    gatewayCtx = { userId, provider: createProvider() };
  }

  let prompts: Prompt[];

  switch (mode) {
    case "INTERLEAVED_PRACTICE":
    case "EXAM_SIM":
    case "RETRIEVAL": {
      // Try content-aware AI-generated prompts first
      const contentPrompts = await generateContentAwarePrompts({
        userId,
        courseName: session.courseName,
        examName: session.examName || undefined,
        mode,
        topicScope: session.topicScope,
        objectives: objectives || [{ id: "topic_0", title: session.topicScope }],
        promptCount,
        gatewayCtx,
      });

      if (contentPrompts) {
        // AI decks arrive grouped by objective — re-interleave so mixed
        // practice actually mixes (Rohrer & Taylor 2007). Skip for EXAM_SIM
        // (fixed exam order) and RETRIEVAL (single-topic focus is fine).
        prompts = mode === "INTERLEAVED_PRACTICE"
          ? interleaveByObjective(contentPrompts, session.sessionId)
          : contentPrompts;
        logger.info("run.content_aware_prompts", {
          user_id: userId,
          session_id: sessionId,
          mode,
          count: prompts.length,
        });
      } else {
        // Fall back to deterministic prompts
        if (mode === "INTERLEAVED_PRACTICE") {
          prompts = generateInterleavedPrompts({ ...sessionParams, seed: session.sessionId });
        } else {
          prompts = generateRetrievalPrompts(sessionParams);
        }
      }
      break;
    }

    case "WORKED_EXAMPLES": {
      // Worked-example effect with backward fading (Sweller & Cooper 1985;
      // Renkl 2002): study a full example, then completion problems with
      // progressively more steps removed, then a full near-transfer problem.
      const weDeck = await generateWorkedExampleDeck({
        userId,
        courseName: session.courseName,
        examName: session.examName || undefined,
        topicScope: session.topicScope,
        objectives: objectives || [{ id: "topic_0", title: session.topicScope }],
        promptCount,
        gatewayCtx,
      });

      if (weDeck) {
        prompts = weDeck;
        logger.info("run.worked_examples_deck", {
          user_id: userId,
          session_id: sessionId,
          count: prompts.length,
        });
      } else {
        // No content or no AI — fall back to retrieval practice so the
        // session still runs rather than dead-ending.
        prompts = generateRetrievalPrompts(sessionParams);
        logger.info("run.worked_examples_fallback", { user_id: userId, session_id: sessionId });
      }
      break;
    }

    case "ERROR_REPAIR": {
      const count = promptCount;
      // Fetch unresolved error logs — high-confidence errors first
      // (hypercorrection: Butterfield & Metcalfe 2001 — confident misses,
      // once corrected, are remembered best), then newest.
      const errorLogs = await prisma.sessionErrorLog.findMany({
        where: {
          run: { userId },
          resolvedAt: null,
        },
        orderBy: [
          { confidenceRating: { sort: "desc", nulls: "last" } },
          { createdAt: "desc" },
        ],
        take: count,
        include: {
          run: {
            select: {
              attempts: {
                select: { promptText: true, promptIndex: true },
              },
            },
          },
        },
      });

      const logsForRepair: ErrorLogForRepair[] = errorLogs.map((log) => {
        const attempt = log.run.attempts.find((a) => a.promptIndex === log.promptIndex);
        return {
          id: log.id,
          prompt_index: log.promptIndex,
          error_type: log.errorType,
          correction_rule: log.correctionRule,
          variant_question: log.variantQuestion,
          prompt_text: attempt?.promptText,
        };
      });

      if (logsForRepair.length === 0) {
        // No unresolved errors — generate a minimal retrieval deck instead
        prompts = generateRetrievalPrompts({
          ...sessionParams,
          target_outcome: { prompt_count: Math.min(count, 3) },
        });
      } else {
        prompts = generateErrorRepairPrompts(logsForRepair, count);
      }
      break;
    }

    default:
      prompts = generateRetrievalPrompts(sessionParams);
      break;
  }

  // ---- Pre-test + Spaced Review + Cross-Session Error Repair Warm-ups ----
  // Skip for EXAM_SIM (fixed format) and ERROR_REPAIR (already targeted).
  if (mode !== "EXAM_SIM" && mode !== "ERROR_REPAIR") {
    // Pre-test: generate diagnostic questions for new objectives with no mastery records
    const pretestPrompts = await generatePretestPrompts(userId, session.courseName, objectives);
    // Spaced review: prepend review questions on due objectives
    const warmupPrompts = await generateWarmupPrompts(userId, session.courseName, objectives);
    // Cross-session error repair: inject unresolved errors from previous sessions
    // Research (Rawson & Dunlosky 2011): Successive relearning — re-testing errors
    // from prior sessions produces cumulative retention gains across sessions.
    const errorRepairPrompts = await generateCrossSessionRepairs(userId, session.courseName);

    const prependedPrompts = [...pretestPrompts, ...warmupPrompts, ...errorRepairPrompts];
    if (prependedPrompts.length > 0) {
      prompts = [...prependedPrompts, ...prompts];
      logger.info("run.warmup_prepended", {
        user_id: userId,
        session_id: sessionId,
        pretest_count: pretestPrompts.length,
        warmup_count: warmupPrompts.length,
        error_repair_count: errorRepairPrompts.length,
      });
    }
  }

  const runId = generateSessionId();
  const breakState = initBreakState(breakProtocol);
  const metrics = emptyMetrics();
  const policies = policiesForMode(mode);
  const phase = initialPhaseForMode(mode);

  // Create run + persist prompts to SessionRunPrompt table in one transaction.
  // An advisory lock + re-check closes the find-then-create race: two
  // overlapping /runs/start requests must not both create an ACTIVE run for
  // the same session (deck generation above is too slow to hold a lock over,
  // so the loser discards its generated deck and resumes the winner's run).
  let concurrentRunId: string | null = null;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${session.sessionId}))`;
    const concurrent = await tx.sessionRun.findFirst({
      where: { sessionId: session.sessionId, userId, status: { in: ["CREATED", "ACTIVE"] } },
      select: { runId: true },
    });
    if (concurrent) {
      concurrentRunId = concurrent.runId;
      return;
    }
    await tx.sessionRun.create({
      data: {
        runId,
        sessionId: session.sessionId,
        userId,
        mode,
        phase,
        status: "ACTIVE",
        startedAt: new Date(),
        currentIndex: 0,
        promptCount: prompts.length,
        answeredCount: mode === "EXAM_SIM" ? 0 : null,
        scoredCount: mode === "EXAM_SIM" ? 0 : null,
        prompts: prompts as object[],
        policies: policies as object,
        metrics: metrics as object,
        breakState: breakState as object,
      },
    });

    // Write prompts to normalized table
    for (let i = 0; i < prompts.length; i++) {
      const p = prompts[i];
      // Merge MCQ fields into meta JSON for storage
      const storedMeta: Record<string, unknown> = p.meta ? { ...p.meta } : {};
      if (p.format === "MCQ" && p.choices && p.correctIndex != null) {
        storedMeta.format = p.format;
        storedMeta.choices = p.choices;
        storedMeta.correctIndex = p.correctIndex;
      }
      await tx.sessionRunPrompt.create({
        data: {
          runId,
          promptIndex: i,
          objectiveId: p.objective_id ?? null,
          text: p.text,
          difficulty: p.difficulty ?? 1,
          sourceType: p.meta?.source_error_log_id ? "ERROR_LOG" : "GENERATED",
          sourceRefId: p.meta?.source_error_log_id ?? null,
          meta: Object.keys(storedMeta).length > 0 ? (storedMeta as object) : undefined,
        },
      });
    }
  });

  // Lost the race — another request created a run for this session while we
  // were generating the deck. Resume that run instead of duplicating it.
  if (concurrentRunId) {
    logger.info("run.start_race_resolved", {
      user_id: userId,
      session_id: sessionId,
      winner_run_id: concurrentRunId,
    });
    return startOrResumeRun(userId, sessionId);
  }

  const currentPrompt = toPromptView(prompts[0], 0);

  logger.info("run.started", {
    user_id: userId,
    session_id: sessionId,
    run_id: runId,
    mode,
    phase,
    prompt_count: prompts.length,
    break_type: breakProtocol?.type ?? "50_10",
  });

  return {
    data: {
      run_id: runId,
      status: "ACTIVE",
      mode,
      phase,
      current_index: 0,
      prompt_count: prompts.length,
      current_prompt: currentPrompt,
      answered_count: mode === "EXAM_SIM" ? 0 : null,
      scored_count: mode === "EXAM_SIM" ? 0 : null,
      prompts: redactPrompts(prompts),
      policies,
      metrics,
      break_state: breakState,
      resumed: false,
    },
  };
}

// ---- Get Prompt by Index ----

async function getPromptAt(
  runId: string,
  index: number,
  fallbackPrompts: Prompt[],
  includeAnswer = false,
): Promise<PromptView> {
  const row = await prisma.sessionRunPrompt.findUnique({
    where: { runId_promptIndex: { runId, promptIndex: index } },
  });
  if (row) {
    const meta = row.meta as Record<string, unknown> | null;
    const view: PromptView = {
      prompt_index: row.promptIndex,
      text: row.text,
      objective_id: row.objectiveId ?? undefined,
      difficulty: row.difficulty,
      source_type: row.sourceType,
    };
    // Extract MCQ fields stored in meta JSON; withhold the answer key
    // unless explicitly requested (EXAM_SIM REVIEW phase).
    if (meta?.format === "MCQ" && Array.isArray(meta.choices)) {
      view.format = "MCQ";
      view.choices = meta.choices as string[];
      if (includeAnswer && meta.correctIndex != null) {
        view.correctIndex = meta.correctIndex as number;
        if (Array.isArray(meta.distractorRationales)) {
          view.meta = { distractorRationales: meta.distractorRationales as string[] };
        }
      }
    }
    if (typeof meta?.original_prompt_text === "string") {
      view.meta = { ...(view.meta ?? {}), original_prompt_text: meta.original_prompt_text };
    }
    if (typeof meta?.pack === "string") {
      view.meta = { ...(view.meta ?? {}), pack: meta.pack };
    }
    return view;
  }
  // Fallback to JSONB for runs created before migration
  const p = fallbackPrompts[index];
  if (!p) return { prompt_index: index, text: "" };
  return toPromptView(p, index, includeAnswer);
}

export async function getRunPrompt(userId: string, runId: string, index: number) {
  const run = await prisma.sessionRun.findUnique({
    where: { runId },
    select: { userId: true, promptCount: true, prompts: true, metrics: true, mode: true, phase: true, status: true, currentIndex: true },
  });
  if (!run) return { error: "not_found" as const };
  if (run.userId !== userId) return { error: "forbidden" as const };

  const count = run.promptCount || (run.prompts as unknown as Prompt[]).length;
  if (index < 0 || index >= count) return { error: "invalid_index" as const };

  // MCQ answer keys are only revealed during EXAM_SIM REVIEW, after all
  // answers are locked in.
  const includeAnswer = run.phase === "REVIEW";

  // Adaptive difficulty: reorder remaining prompts based on running accuracy.
  // Only on an ACTIVE run's CURRENT prompt — GET must otherwise stay a pure
  // read (a stale tab fetching an answered index must never reorder the deck).
  const metrics = run.metrics as unknown as RunMetrics;
  if (
    run.mode !== "EXAM_SIM" &&
    run.status === "ACTIVE" &&
    run.phase === "ACTIVE" &&
    index === run.currentIndex &&
    metrics.attempts_count >= 2 &&
    index > 0
  ) {
    const adapted = await adaptPromptDifficulty(runId, index, count, metrics.accuracy);
    if (adapted) return { data: adapted };
  }

  const prompt = await getPromptAt(runId, index, run.prompts as unknown as Prompt[], includeAnswer);
  return { data: prompt };
}

/**
 * Adaptive difficulty: select the best-fit prompt from remaining prompts
 * based on the student's running accuracy.
 *
 * - accuracy >= 0.8 → prefer harder prompts (difficulty 4-5)
 * - accuracy >= 0.5 → prefer medium prompts (difficulty 2-3)
 * - accuracy < 0.5  → prefer easier prompts (difficulty 1-2)
 *
 * Returns null if the current prompt is already at the right difficulty,
 * or if no better-fit prompt exists.
 */
async function adaptPromptDifficulty(
  runId: string,
  currentIndex: number,
  totalCount: number,
  accuracy: number,
): Promise<PromptView | null> {
  // Determine target difficulty range
  let targetMin: number, targetMax: number;
  if (accuracy >= 0.8) {
    targetMin = 4; targetMax = 5;
  } else if (accuracy >= 0.5) {
    targetMin = 2; targetMax = 4;
  } else {
    targetMin = 1; targetMax = 2;
  }

  // Get current prompt, previous prompt (for interleaving adjacency), and
  // remaining prompts
  const [currentPrompt, previousPrompt, remainingPrompts] = await Promise.all([
    prisma.sessionRunPrompt.findUnique({
      where: { runId_promptIndex: { runId, promptIndex: currentIndex } },
    }),
    prisma.sessionRunPrompt.findUnique({
      where: { runId_promptIndex: { runId, promptIndex: currentIndex - 1 } },
    }),
    prisma.sessionRunPrompt.findMany({
      where: {
        runId,
        promptIndex: { gt: currentIndex, lt: totalCount },
      },
      orderBy: { promptIndex: "asc" },
    }),
  ]);

  if (!currentPrompt || remainingPrompts.length === 0) return null;

  // If current prompt is already in target range, keep it
  if (currentPrompt.difficulty >= targetMin && currentPrompt.difficulty <= targetMax) {
    return null;
  }

  // Find better-fit prompts among remaining prompts; prefer one whose
  // objective differs from the previous prompt so a difficulty swap never
  // silently un-interleaves the deck (Rohrer & Taylor 2007).
  const candidates = remainingPrompts.filter(
    (p) => p.difficulty >= targetMin && p.difficulty <= targetMax
  );
  const betterFit =
    candidates.find((p) => p.objectiveId !== previousPrompt?.objectiveId) ??
    candidates[0];

  if (!betterFit) return null;

  // Swap the two rows inside a transaction, parking the current row at a
  // temporary out-of-range index first. A single-statement CASE swap would
  // violate the non-deferrable unique index on (run_id, prompt_index) —
  // PostgreSQL enforces unique indexes per-row during UPDATE.
  const swapIdx = betterFit.promptIndex;
  await prisma.$transaction([
    prisma.sessionRunPrompt.update({
      where: { runId_promptIndex: { runId, promptIndex: currentIndex } },
      data: { promptIndex: -1 },
    }),
    prisma.sessionRunPrompt.update({
      where: { runId_promptIndex: { runId, promptIndex: swapIdx } },
      data: { promptIndex: currentIndex },
    }),
    prisma.sessionRunPrompt.update({
      where: { runId_promptIndex: { runId, promptIndex: -1 } },
      data: { promptIndex: swapIdx },
    }),
  ]);

  logger.info("adaptive.swapped", {
    run_id: runId,
    index: currentIndex,
    old_difficulty: currentPrompt.difficulty,
    new_difficulty: betterFit.difficulty,
    accuracy,
    target_range: `${targetMin}-${targetMax}`,
  });

  // Answer key deliberately omitted — this view is served pre-answer.
  const swapMeta = betterFit.meta as Record<string, unknown> | null;
  const swapView: PromptView = {
    prompt_index: currentIndex,
    text: betterFit.text,
    objective_id: betterFit.objectiveId ?? undefined,
    difficulty: betterFit.difficulty,
    source_type: betterFit.sourceType,
  };
  if (swapMeta?.format === "MCQ" && Array.isArray(swapMeta.choices)) {
    swapView.format = "MCQ";
    swapView.choices = swapMeta.choices as string[];
  }
  return swapView;
}

// ---- Get Run ----

export async function getRun(userId: string, runId: string) {
  const run = await prisma.sessionRun.findUnique({
    where: { runId },
    include: {
      attempts: { orderBy: { promptIndex: "asc" } },
      errorLogs: { orderBy: { promptIndex: "asc" } },
      session: true,
    },
  });

  if (!run) return { error: "not_found" as const };
  if (run.userId !== userId) return { error: "forbidden" as const };

  return {
    data: {
      run_id: run.runId,
      session_id: run.sessionId,
      status: run.status,
      mode: run.mode,
      phase: run.phase,
      current_index: run.currentIndex,
      prompt_count: run.promptCount,
      answered_count: run.answeredCount,
      scored_count: run.scoredCount,
      prompts: redactPrompts((run.prompts as unknown as Prompt[]) ?? []),
      policies: run.policies,
      metrics: run.metrics,
      break_state: run.breakState,
      started_at: run.startedAt?.toISOString() ?? null,
      ended_at: run.endedAt?.toISOString() ?? null,
      attempts: run.attempts.map((a) => ({
        id: a.id,
        prompt_index: a.promptIndex,
        prompt_id: a.promptId,
        prompt_text: a.promptText,
        user_answer: a.userAnswer,
        self_score: a.selfScore,
        confidence_rating: a.confidenceRating,
        time_to_answer_seconds: a.timeToAnswerSeconds,
        created_at: a.createdAt.toISOString(),
      })),
      error_logs: run.errorLogs.map((e) => ({
        prompt_index: e.promptIndex,
        error_type: e.errorType,
        correction_rule: e.correctionRule,
        variant_question: e.variantQuestion,
        created_at: e.createdAt.toISOString(),
      })),
      session: {
        course_name: run.session.courseName,
        exam_name: run.session.examName,
        mode: run.session.mode,
        topic_scope: run.session.topicScope,
      },
    },
  };
}

// ---- Submit Attempt (unified for all modes) ----

export async function submitAttempt(userId: string, runId: string, input: AttemptPayload) {
  const txStart = Date.now();
  const run = await prisma.sessionRun.findUnique({ where: { runId } });
  if (!run) return { error: "not_found" as const };
  if (run.userId !== userId) return { error: "forbidden" as const };
  if (run.status === "COMPLETED") return { error: "run_completed" as const };

  const mode = run.mode;
  const phase = run.phase;

  // Determine attempt kind
  const kind = "kind" in input && input.kind ? input.kind : "LEGACY";

  // Phase compatibility
  if (mode === "EXAM_SIM") {
    if (phase === "EXAM" && kind === "SCORE") {
      return { error: "wrong_phase" as const, message: "Cannot score during EXAM phase" };
    }
    if (phase === "REVIEW" && (kind === "ANSWER" || kind === "LEGACY")) {
      return { error: "wrong_phase" as const, message: "Cannot answer during REVIEW phase" };
    }
  }

  // Check break state
  const breakState = checkBreakNeeded(run.breakState as unknown as BreakState);
  if (breakState.on_break) {
    await prisma.sessionRun.update({
      where: { id: run.id },
      data: { breakState: breakState as object },
    });
    logger.info("break.started", { run_id: runId, user_id: userId });
    return { error: "on_break" as const, break_state: breakState };
  }

  const promptIndex = input.prompt_index;

  // Enforce linear flow
  if (promptIndex !== run.currentIndex) {
    return { error: "wrong_index" as const, expected: run.currentIndex };
  }

  // Read prompt from normalized table, fall back to JSONB
  const prompts = run.prompts as unknown as Prompt[];
  const promptRow = await prisma.sessionRunPrompt.findUnique({
    where: { runId_promptIndex: { runId, promptIndex } },
  });
  const prompt: Prompt = promptRow
    ? (() => {
        const rowMeta = promptRow.meta as Record<string, unknown> | null;
        return {
          id: promptRow.id,
          text: promptRow.text,
          objective_id: promptRow.objectiveId ?? undefined,
          difficulty: promptRow.difficulty,
          format: rowMeta?.format as Prompt["format"],
          choices: rowMeta?.choices as string[] | undefined,
          correctIndex: rowMeta?.correctIndex as number | undefined,
          meta: rowMeta as Prompt["meta"],
        };
      })()
    : prompts[promptIndex];
  if (!prompt) return { error: "invalid_index" as const };

  // Route to the appropriate handler
  if (mode === "EXAM_SIM" && (kind === "ANSWER" || (kind === "LEGACY" && phase === "EXAM"))) {
    return handleExamAnswer(run, prompt, input as ExamAnswerInput | SubmitAttemptInput, breakState, txStart);
  }

  if (mode === "EXAM_SIM" && (kind === "SCORE" || (kind === "LEGACY" && phase === "REVIEW"))) {
    return handleExamScore(run, prompt, input as ExamScoreInput | SubmitAttemptInput, breakState, userId, txStart);
  }

  // RETRIEVAL / INTERLEAVED / ERROR_REPAIR: immediate scoring
  return handleImmediateScoring(run, prompt, input as SubmitAttemptInput, breakState, userId, txStart);
}

// ---- Immediate scoring (RETRIEVAL / INTERLEAVED / ERROR_REPAIR) ----

async function handleImmediateScoring(
  run: { id: string; runId: string; userId: string; sessionId: string; currentIndex: number; promptCount: number; mode: string; metrics: unknown; breakState: unknown; prompts: unknown },
  prompt: Prompt,
  input: SubmitAttemptInput,
  breakState: BreakState,
  userId: string,
  txStart: number
) {
  // ---- Server-side MCQ grading ----
  // The client never receives the answer key, so it submits only the chosen
  // index. The server grades against the stored correctIndex and builds the
  // error log from the correct answer (never from the distractor's
  // misconception rationale alone — that would drill the misconception).
  let effectiveScore = input.self_score;
  let effectiveErrorLog = input.error_log;
  let mcqResult:
    | { selected_index: number; correct_index: number; is_correct: boolean; correct_choice: string; rationale?: string }
    | null = null;

  if (
    prompt.format === "MCQ" &&
    prompt.choices &&
    prompt.correctIndex != null &&
    input.mcq_choice_index != null &&
    input.mcq_choice_index < prompt.choices.length
  ) {
    const selected = input.mcq_choice_index;
    const isCorrect = selected === prompt.correctIndex;
    const correctChoice = prompt.choices[prompt.correctIndex];
    const rationale = isCorrect ? undefined : prompt.meta?.distractorRationales?.[selected];

    effectiveScore = isCorrect ? "CORRECT" : "INCORRECT";
    if (!isCorrect) {
      effectiveErrorLog = {
        error_type: "MISCONCEPTION",
        correction_rule: `The correct answer is "${correctChoice}".${rationale ? ` Common trap: ${rationale}` : ""}`,
      };
    }
    mcqResult = {
      selected_index: selected,
      correct_index: prompt.correctIndex,
      is_correct: isCorrect,
      correct_choice: correctChoice,
      rationale,
    };
  }

  if (!effectiveScore) return { error: "missing_score" as const };
  const finalScoreValue = effectiveScore;
  const finalErrorLog = effectiveErrorLog;

  // Server-stored prompt meta is authoritative (never trust client flags):
  // pretest items are diagnostic — quarantined from accuracy, error logs,
  // variant injection, and mastery (Richland et al. 2009: pretesting helps
  // even when answers are wrong, so wrong answers must not be punished).
  const isPretest = prompt.meta?.pack === "PRE_TEST";
  // Repair prompts (variants, cross-session repairs, ERROR_REPAIR decks)
  // link back to a source error log and never mint a NEW error log.
  const sourceErrorLogId = prompt.meta?.source_error_log_id;

  let attemptId: string;
  try {
    const txResult = await prisma.$transaction(async (tx) => {
      // Re-read inside the transaction to get fresh metrics/index and prevent
      // concurrent submissions from clobbering each other.
      const fresh = await tx.sessionRun.findUniqueOrThrow({ where: { id: run.id } });

      // A concurrent completeRun may have finished the run since the
      // pre-transaction check — never resurrect a completed run.
      if (fresh.status === "COMPLETED") throw new RunCompletedError();

      // Check for duplicate attempt
      const existing = await tx.sessionAttempt.findUnique({
        where: { runId_promptIndex: { runId: run.runId, promptIndex: input.prompt_index } },
      });
      if (existing) throw new DuplicateAttemptError();

      // Re-validate index against fresh state
      if (input.prompt_index !== fresh.currentIndex) {
        throw new WrongIndexError(fresh.currentIndex);
      }

      const promptCount = fresh.promptCount || (fresh.prompts as unknown as Prompt[]).length;
      const metrics = fresh.metrics as unknown as RunMetrics;
      const freshBreak = fresh.breakState as unknown as BreakState;
      const newMetrics: RunMetrics = isPretest
        ? {
            ...metrics,
            time_spent_seconds: metrics.time_spent_seconds + (input.time_to_answer_seconds ?? 0),
            pretest_count: (metrics.pretest_count ?? 0) + 1,
            pretest_correct: (metrics.pretest_correct ?? 0) + (finalScoreValue === "CORRECT" ? 1 : 0),
          }
        : {
            ...metrics,
            attempts_count: metrics.attempts_count + 1,
            correct_count: metrics.correct_count + (finalScoreValue === "CORRECT" ? 1 : 0),
            partial_count: metrics.partial_count + (finalScoreValue === "PARTIAL" ? 1 : 0),
            incorrect_count: metrics.incorrect_count + (finalScoreValue === "INCORRECT" ? 1 : 0),
            accuracy: 0,
            time_spent_seconds: metrics.time_spent_seconds + (input.time_to_answer_seconds ?? 0),
          };
      if (!isPretest) {
        newMetrics.accuracy = newMetrics.attempts_count > 0
          ? newMetrics.correct_count / newMetrics.attempts_count
          : 0;
      }

      const newIndex = fresh.currentIndex + 1;
      const isLastPrompt = newIndex >= promptCount;
      const updatedBreakState = isLastPrompt ? freshBreak : checkBreakNeeded(freshBreak);

      const attempt = await tx.sessionAttempt.create({
        data: {
          runId: run.runId,
          promptIndex: input.prompt_index,
          promptId: prompt.id,
          promptText: prompt.text,
          userAnswer: input.user_answer,
          selfScore: finalScoreValue,
          timeToAnswerSeconds: input.time_to_answer_seconds ?? null,
          confidenceRating: input.confidence_rating ?? null,
          selfExplanation: input.self_explanation ?? null,
          generatedExample: input.generated_example ?? null,
        },
      });

      // Error logs: only for genuine (non-pretest) errors on prompts that
      // aren't already repairing an existing error. Confidence is stored for
      // hypercorrection prioritization (Butterfield & Metcalfe 2001).
      let errorLogId: string | undefined;
      if (
        (finalScoreValue === "PARTIAL" || finalScoreValue === "INCORRECT") &&
        finalErrorLog &&
        !isPretest &&
        !sourceErrorLogId
      ) {
        const errorLog = await tx.sessionErrorLog.create({
          data: {
            runId: run.runId,
            userId: run.userId,
            promptIndex: input.prompt_index,
            errorType: finalErrorLog.error_type,
            correctionRule: finalErrorLog.correction_rule,
            variantQuestion: finalErrorLog.variant_question ?? null,
            confidenceRating: input.confidence_rating ?? null,
          },
        });
        errorLogId = errorLog.id;
      }

      // Criterion-based successive relearning (Rawson & Dunlosky 2011):
      // a linked error log resolves only after TWO correct retrievals on
      // DIFFERENT days — one lucky in-session hit is not mastery. A wrong
      // answer on a repair prompt resets the streak.
      if (sourceErrorLogId && !isPretest) {
        if (finalScoreValue === "CORRECT") {
          const srcLog = await tx.sessionErrorLog.findUnique({
            where: { id: sourceErrorLogId },
          });
          if (srcLog && !srcLog.resolvedAt) {
            const now = new Date();
            const today = now.toISOString().slice(0, 10);
            const lastDay = srcLog.lastCorrectAt
              ? srcLog.lastCorrectAt.toISOString().slice(0, 10)
              : null;
            // At most one streak increment per calendar day (UTC)
            if (lastDay !== today) {
              const newStreak = srcLog.correctStreak + 1;
              await tx.sessionErrorLog.update({
                where: { id: srcLog.id },
                data: {
                  correctStreak: newStreak,
                  lastCorrectAt: now,
                  ...(newStreak >= 2
                    ? { resolvedAt: now, resolvedByRunId: run.runId }
                    : {}),
                },
              });
            }
          }
        } else {
          await tx.sessionErrorLog.updateMany({
            where: { id: sourceErrorLogId, resolvedAt: null },
            data: { correctStreak: 0 },
          });
        }
      }

      // ---- In-session error repair: inject variant question ----
      // When the student gets a question wrong, append a variant question to the
      // end of the deck. This provides natural spacing (1-3 intervening items)
      // before the retry, which research shows enhances the retrieval effect
      // (Kornell & Bjork 2008).
      // In-session repair loop: a wrong answer injects a spaced retry variant
      // at the end of the deck (Kornell & Bjork 2008). A wrong answer ON a
      // repair prompt re-injects for the SAME source error (criterion loop) —
      // the session doesn't end until each miss gets a correct retrieval or
      // the cap is hit. Pretest misses never inject (they aren't errors yet).
      let variantInjected = false;
      let finalPromptCount = promptCount;
      const repairSourceId = sourceErrorLogId ?? errorLogId;
      if (
        (finalScoreValue === "PARTIAL" || finalScoreValue === "INCORRECT") &&
        (finalErrorLog || sourceErrorLogId) &&
        !isPretest &&
        run.mode !== "ERROR_REPAIR" // ERROR_REPAIR already has targeted repair prompts
      ) {
        // Count existing variants in this session to cap injection
        const existingVariants = await tx.sessionRunPrompt.count({
          where: { runId: run.runId, sourceType: "VARIANT_REPAIR" },
        });

        if (existingVariants < MAX_VARIANTS_PER_SESSION) {
          // MCQ stems say "which of the following" — the free-recall variant
          // must carry the answer context or the reference is incoherent.
          const variantSourceText = mcqResult && prompt.choices
            ? `${prompt.text} (Correct answer: "${mcqResult.correct_choice}"; you chose "${prompt.choices[mcqResult.selected_index]}")`
            : prompt.text;
          const variantPrompt = generateVariantQuestion(
            promptCount, // append at end of current deck
            variantSourceText,
            finalErrorLog?.error_type ?? "MISCONCEPTION",
            finalErrorLog?.correction_rule ?? prompt.meta?.expected_correction_rule ?? "",
            prompt.objective_id,
            repairSourceId,
          );

          await tx.sessionRunPrompt.create({
            data: {
              runId: run.runId,
              promptIndex: promptCount,
              objectiveId: variantPrompt.objective_id ?? null,
              text: variantPrompt.text,
              difficulty: variantPrompt.difficulty,
              sourceType: "VARIANT_REPAIR",
              sourceRefId: repairSourceId ?? null,
              meta: variantPrompt.meta ? (variantPrompt.meta as object) : undefined,
            },
          });

          finalPromptCount = promptCount + 1;
          variantInjected = true;
        }
      }

      const isLastPromptFinal = newIndex >= finalPromptCount;
      const updatedBreakStateFinal = isLastPromptFinal ? freshBreak : updatedBreakState;

      const metricsToStore = isLastPromptFinal
        ? { ...newMetrics, recommended_followups: computeFollowups(newMetrics.accuracy) }
        : newMetrics;

      await tx.sessionRun.update({
        where: { id: run.id },
        data: {
          currentIndex: newIndex,
          promptCount: finalPromptCount,
          metrics: metricsToStore as object,
          breakState: updatedBreakStateFinal as object,
          status: isLastPromptFinal ? "COMPLETED" : "ACTIVE",
          phase: isLastPromptFinal ? "COMPLETE" : undefined,
          endedAt: isLastPromptFinal ? new Date() : undefined,
        },
      });

      return { attemptId: attempt.id, newMetrics, newIndex, promptCount: finalPromptCount, isLastPrompt: isLastPromptFinal, updatedBreakState: updatedBreakStateFinal, variantInjected };
    });
    attemptId = txResult.attemptId;
    const { newMetrics, newIndex, promptCount, isLastPrompt, updatedBreakState, variantInjected } = txResult;

    // Eager feedback (Kulik & Kulik 1988 — immediate feedback default):
    // start generating elaborated feedback the moment the attempt lands so
    // the review panel barely waits. Fire-and-forget; the GET endpoint is
    // the fallback and the claim in generateFeedbackEager prevents doubles.
    void generateFeedbackEager(userId, attemptId).catch(() => {});

    const dbTxMs = Date.now() - txStart;
    const feedbackStatus = (finalScoreValue === "PARTIAL" || finalScoreValue === "INCORRECT")
      ? "PENDING" as const
      : "NONE" as const;

    logger.info("prompt.submitted", {
      user_id: userId,
      run_id: run.runId,
      prompt_index: input.prompt_index,
      self_score: finalScoreValue,
      mode: run.mode,
      is_last: isLastPrompt,
      variant_injected: variantInjected,
      mcq_graded: mcqResult != null,
      db_tx_ms: dbTxMs,
    });

    if (isLastPrompt) {
      const finalMetrics = { ...newMetrics, recommended_followups: computeFollowups(newMetrics.accuracy) };
      logger.info("run.completed", { user_id: userId, run_id: run.runId, accuracy: finalMetrics.accuracy });

      await runPostCompletionEffects(userId, run.runId, run.sessionId);

      return {
        data: {
          attempt_id: attemptId,
          feedback_status: feedbackStatus,
          status: "COMPLETED" as const,
          phase: "COMPLETE",
          current_index: newIndex,
          prompt_count: promptCount,
          metrics: finalMetrics,
          break_state: updatedBreakState,
          mcq_result: mcqResult,
        },
      };
    }

    return {
      data: {
        attempt_id: attemptId,
        feedback_status: feedbackStatus,
        status: "ACTIVE" as const,
        phase: "ACTIVE",
        current_index: newIndex,
        prompt_count: promptCount,
        metrics: newMetrics,
        break_state: updatedBreakState,
        mcq_result: mcqResult,
      },
    };
  } catch (err: unknown) {
    if (err instanceof DuplicateAttemptError) return { error: "duplicate_attempt" as const };
    if (err instanceof WrongIndexError) return { error: "wrong_index" as const, expected: err.expected };
    if (err instanceof RunCompletedError) return { error: "run_completed" as const };
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return { error: "duplicate_attempt" as const };
    }
    captureException(err, { user_id: userId, run_id: run.runId, action: "submitAttempt" });
    throw err;
  }
}

// ---- EXAM_SIM: EXAM phase (answer only, no scoring) ----

async function handleExamAnswer(
  run: { id: string; runId: string; userId: string; currentIndex: number; promptCount: number; answeredCount: number | null; scoredCount: number | null; metrics: unknown; breakState: unknown; prompts: unknown },
  prompt: Prompt,
  input: ExamAnswerInput | SubmitAttemptInput,
  breakState: BreakState,
  txStart: number
) {
  const userAnswer = "user_answer" in input ? input.user_answer : "";
  const timeToAnswer = "time_to_answer_seconds" in input ? input.time_to_answer_seconds : undefined;
  const confidenceRating = "confidence_rating" in input ? input.confidence_rating : undefined;

  try {
    const txResult = await prisma.$transaction(async (tx) => {
      const fresh = await tx.sessionRun.findUniqueOrThrow({ where: { id: run.id } });
      if (fresh.status === "COMPLETED") throw new RunCompletedError();

      const existing = await tx.sessionAttempt.findUnique({
        where: { runId_promptIndex: { runId: run.runId, promptIndex: input.prompt_index } },
      });
      if (existing) throw new DuplicateAttemptError();

      const promptCount = fresh.promptCount || (fresh.prompts as unknown as Prompt[]).length;
      const freshBreak = fresh.breakState as unknown as BreakState;
      const newIndex = fresh.currentIndex + 1;
      const newAnsweredCount = (fresh.answeredCount ?? 0) + 1;
      const isLastAnswer = newIndex >= promptCount;
      const updatedBreakState = isLastAnswer ? freshBreak : checkBreakNeeded(freshBreak);

      const metrics = fresh.metrics as unknown as RunMetrics;
      const newMetrics: RunMetrics = {
        ...metrics,
        time_spent_seconds: metrics.time_spent_seconds + (timeToAnswer ?? 0),
      };

      const attempt = await tx.sessionAttempt.create({
        data: {
          runId: run.runId,
          promptIndex: input.prompt_index,
          promptId: prompt.id,
          promptText: prompt.text,
          userAnswer,
          selfScore: null,
          timeToAnswerSeconds: timeToAnswer ?? null,
          confidenceRating: confidenceRating ?? null,
        },
      });

      await tx.sessionRun.update({
        where: { id: run.id },
        data: {
          currentIndex: isLastAnswer ? 0 : newIndex,
          answeredCount: newAnsweredCount,
          metrics: newMetrics as object,
          breakState: updatedBreakState as object,
          phase: isLastAnswer ? "REVIEW" : "EXAM",
        },
      });

      return { attemptId: attempt.id, promptCount, newIndex, newAnsweredCount, isLastAnswer, updatedBreakState, newMetrics };
    });

    const { attemptId, promptCount, newIndex, newAnsweredCount, isLastAnswer, updatedBreakState, newMetrics } = txResult;

    const dbTxMs = Date.now() - txStart;
    logger.info("prompt.submitted", {
      user_id: run.userId,
      run_id: run.runId,
      prompt_index: input.prompt_index,
      mode: "EXAM_SIM",
      phase: isLastAnswer ? "REVIEW" : "EXAM",
      is_last_answer: isLastAnswer,
      db_tx_ms: dbTxMs,
    });

    return {
      data: {
        attempt_id: attemptId,
        feedback_status: "NONE" as const,
        status: "ACTIVE" as const,
        phase: isLastAnswer ? "REVIEW" : "EXAM",
        current_index: isLastAnswer ? 0 : newIndex,
        prompt_count: promptCount,
        answered_count: newAnsweredCount,
        scored_count: run.scoredCount ?? 0,
        metrics: newMetrics,
        break_state: updatedBreakState,
      },
    };
  } catch (err: unknown) {
    if (err instanceof DuplicateAttemptError) return { error: "duplicate_attempt" as const };
    if (err instanceof RunCompletedError) return { error: "run_completed" as const };
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return { error: "duplicate_attempt" as const };
    }
    throw err;
  }
}

// ---- EXAM_SIM: REVIEW phase (score existing attempt) ----

async function handleExamScore(
  run: { id: string; runId: string; userId: string; sessionId: string; currentIndex: number; promptCount: number; answeredCount: number | null; scoredCount: number | null; metrics: unknown; breakState: unknown; prompts: unknown },
  _prompt: Prompt,
  input: ExamScoreInput | SubmitAttemptInput,
  breakState: BreakState,
  userId: string,
  txStart: number
) {
  const selfScore = "self_score" in input ? input.self_score : null;
  const errorLog = "error_log" in input ? input.error_log : undefined;
  const selfExplanation = "self_explanation" in input ? input.self_explanation : undefined;
  const generatedExample = "generated_example" in input ? input.generated_example : undefined;

  if (!selfScore) return { error: "missing_score" as const };

  try {
    const txResult = await prisma.$transaction(async (tx) => {
      // Re-read inside the transaction to get fresh metrics/index
      const fresh = await tx.sessionRun.findUniqueOrThrow({ where: { id: run.id } });
      if (fresh.status === "COMPLETED") throw new RunCompletedError();

      // Find existing attempt (must exist from EXAM phase)
      const existing = await tx.sessionAttempt.findUnique({
        where: { runId_promptIndex: { runId: run.runId, promptIndex: input.prompt_index } },
      });
      if (!existing) throw new Error("no_attempt_to_score");
      if (existing.selfScore !== null) throw new Error("already_scored");

      const promptCount = fresh.promptCount || (fresh.prompts as unknown as Prompt[]).length;
      const metrics = fresh.metrics as unknown as RunMetrics;
      const newScoredCount = (fresh.scoredCount ?? 0) + 1;
      const newIndex = fresh.currentIndex + 1;
      const isLastScore = newIndex >= promptCount;

      const newMetrics: RunMetrics = {
        attempts_count: metrics.attempts_count + 1,
        correct_count: metrics.correct_count + (selfScore === "CORRECT" ? 1 : 0),
        partial_count: metrics.partial_count + (selfScore === "PARTIAL" ? 1 : 0),
        incorrect_count: metrics.incorrect_count + (selfScore === "INCORRECT" ? 1 : 0),
        accuracy: 0,
        time_spent_seconds: metrics.time_spent_seconds,
      };
      newMetrics.accuracy = newMetrics.attempts_count > 0
        ? newMetrics.correct_count / newMetrics.attempts_count
        : 0;

      // Update existing attempt with score and metacognitive fields
      await tx.sessionAttempt.update({
        where: { id: existing.id },
        data: {
          selfScore,
          selfExplanation: selfExplanation ?? undefined,
          generatedExample: generatedExample ?? undefined,
        },
      });

      // Insert error log if needed — carrying the exam-time confidence for
      // hypercorrection prioritization (Butterfield & Metcalfe 2001).
      if ((selfScore === "PARTIAL" || selfScore === "INCORRECT") && errorLog) {
        await tx.sessionErrorLog.create({
          data: {
            runId: run.runId,
            userId: run.userId,
            promptIndex: input.prompt_index,
            errorType: errorLog.error_type,
            correctionRule: errorLog.correction_rule,
            variantQuestion: errorLog.variant_question ?? null,
            confidenceRating: existing.confidenceRating ?? null,
          },
        });
      }

      const metricsToStore = isLastScore
        ? { ...newMetrics, recommended_followups: computeFollowups(newMetrics.accuracy) }
        : newMetrics;

      await tx.sessionRun.update({
        where: { id: run.id },
        data: {
          currentIndex: newIndex,
          scoredCount: newScoredCount,
          metrics: metricsToStore as object,
          status: isLastScore ? "COMPLETED" : "ACTIVE",
          phase: isLastScore ? "COMPLETE" : "REVIEW",
          endedAt: isLastScore ? new Date() : undefined,
        },
      });

      return { attemptId: existing.id, newMetrics, newIndex, promptCount, newScoredCount, isLastScore, answeredCount: fresh.answeredCount };
    });

    const { attemptId, newMetrics, newIndex, promptCount, newScoredCount, isLastScore, answeredCount } = txResult;

    // Eager feedback: start generation as soon as the score lands.
    void generateFeedbackEager(userId, attemptId).catch(() => {});

    const dbTxMs = Date.now() - txStart;
    const feedbackStatus = (selfScore === "PARTIAL" || selfScore === "INCORRECT")
      ? "PENDING" as const
      : "NONE" as const;

    logger.info("prompt.scored", {
      user_id: userId,
      run_id: run.runId,
      prompt_index: input.prompt_index,
      self_score: selfScore,
      mode: "EXAM_SIM",
      is_last_score: isLastScore,
      db_tx_ms: dbTxMs,
    });

    if (isLastScore) {
      const finalMetrics = { ...newMetrics, recommended_followups: computeFollowups(newMetrics.accuracy) };
      logger.info("run.completed", { user_id: userId, run_id: run.runId, accuracy: finalMetrics.accuracy });

      await runPostCompletionEffects(userId, run.runId, run.sessionId);

      return {
        data: {
          attempt_id: attemptId,
          feedback_status: feedbackStatus,
          status: "COMPLETED" as const,
          phase: "COMPLETE",
          current_index: newIndex,
          prompt_count: promptCount,
          answered_count: answeredCount,
          scored_count: newScoredCount,
          metrics: finalMetrics,
          break_state: breakState,
        },
      };
    }

    return {
      data: {
        attempt_id: attemptId,
        feedback_status: feedbackStatus,
        status: "ACTIVE" as const,
        phase: "REVIEW",
        current_index: newIndex,
        prompt_count: promptCount,
        answered_count: answeredCount,
        scored_count: newScoredCount,
        metrics: newMetrics,
        break_state: breakState,
      },
    };
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "no_attempt_to_score") return { error: "no_attempt_to_score" as const };
    if (err instanceof Error && err.message === "already_scored") return { error: "already_scored" as const };
    if (err instanceof RunCompletedError) return { error: "run_completed" as const };
    captureException(err, { user_id: userId, run_id: run.runId, action: "examScore" });
    throw err;
  }
}

// ---- Pre-test Prompt Generator ----

/**
 * Generate diagnostic pre-test questions for objectives the student has never studied.
 * Research (Richland et al. 2009): testing BEFORE studying enhances subsequent learning
 * by 10-20%, even when students get pre-test questions wrong.
 *
 * Returns up to 2 pre-test prompts for never-seen objectives.
 */
async function generatePretestPrompts(
  userId: string,
  courseName: string,
  objectives: { id: string; title: string }[] | null,
): Promise<Prompt[]> {
  if (!objectives || objectives.length === 0) return [];

  try {
    // Find which objectives already have mastery records
    const existingMastery = await prisma.objectiveMastery.findMany({
      where: { userId, courseName },
      select: { objectiveKey: true },
    });

    const masteredKeys = new Set(existingMastery.map((m) => m.objectiveKey));
    const newObjectives = objectives.filter((o) => !masteredKeys.has(o.id));

    if (newObjectives.length === 0) return [];

    // Generate up to 2 pre-test diagnostic questions
    const maxPretest = Math.min(2, newObjectives.length);
    const pretests: Prompt[] = [];

    for (let i = 0; i < maxPretest; i++) {
      const obj = newObjectives[i];
      pretests.push({
        id: `pretest_${i}`,
        objective_id: obj.id,
        text: `Diagnostic: Before we dive in — what do you already know about "${obj.title}"? Explain as much as you can from memory.`,
        difficulty: 2,
        meta: { pack: "PRE_TEST" },
      });
    }

    return pretests;
  } catch (err) {
    logger.error("pretest.generation_failed", { user_id: userId, error: String(err) });
    return [];
  }
}

// ---- Cross-Session Error Repair Generator ----

/**
 * Generate repair prompts from unresolved errors in PREVIOUS sessions.
 *
 * Research basis (Rawson & Dunlosky 2011): Successive relearning — re-testing
 * errors from prior sessions — produces cumulative retention gains. Each
 * retrieval attempt on a previously-failed concept strengthens the corrected
 * memory trace and reduces future interference from the original error.
 *
 * Max 2 repair prompts to avoid overwhelming the session. These are injected
 * as warm-ups alongside pre-test and spaced review questions.
 */
async function generateCrossSessionRepairs(
  userId: string,
  courseName: string,
): Promise<Prompt[]> {
  try {
    // Find unresolved errors from this course's sessions, newest first
    // High-confidence errors first (hypercorrection), then newest.
    const unresolvedErrors = await prisma.sessionErrorLog.findMany({
      where: {
        userId,
        resolvedAt: null,
        run: {
          session: { courseName },
        },
      },
      orderBy: [
        { confidenceRating: { sort: "desc", nulls: "last" } },
        { createdAt: "desc" },
      ],
      take: 4, // fetch more than needed to filter
      select: {
        id: true,
        promptIndex: true,
        errorType: true,
        correctionRule: true,
        variantQuestion: true,
        createdAt: true,
        runId: true,
      },
    });

    if (unresolvedErrors.length === 0) return [];

    // Batch-fetch only the specific attempts we need (avoids loading all attempts per run)
    const attemptKeys = unresolvedErrors.map((e) => ({
      runId: e.runId,
      promptIndex: e.promptIndex,
    }));
    const relevantAttempts = await prisma.sessionAttempt.findMany({
      where: {
        OR: attemptKeys.map((k) => ({
          runId: k.runId,
          promptIndex: k.promptIndex,
        })),
      },
      select: { runId: true, promptIndex: true, promptText: true },
    });
    const attemptMap = new Map(
      relevantAttempts.map((a) => [`${a.runId}:${a.promptIndex}`, a.promptText]),
    );

    const repairs: Prompt[] = [];
    const maxRepairs = Math.min(2, unresolvedErrors.length);

    for (let i = 0; i < maxRepairs; i++) {
      const err = unresolvedErrors[i];
      const originalText = attemptMap.get(`${err.runId}:${err.promptIndex}`) || "a previous question";
      const daysSince = Math.floor(
        (Date.now() - err.createdAt.getTime()) / (1000 * 60 * 60 * 24),
      );

      const variant = err.variantQuestion?.trim();
      const text = variant
        ? `Error repair (from ${daysSince}d ago): You previously made a ${err.errorType.toLowerCase()} error. Try this variant:\n\n${variant}\n\nAnswer from memory, then state the correction rule.`
        : `Error repair (from ${daysSince}d ago): You made a ${err.errorType.toLowerCase()} error on: "${originalText}"\n\nFrom memory, state the correct rule and explain why the common mistake happens. Then give a new example where this rule applies.`;

      repairs.push({
        id: `repair_${i}`,
        objective_id: undefined,
        text,
        difficulty: 2,
        meta: {
          pack: "CROSS_SESSION_REPAIR",
          source_error_log_id: err.id,
          original_prompt_text: originalText,
          expected_correction_rule: err.correctionRule,
        },
      });
    }

    return repairs;
  } catch (err) {
    logger.error("cross_session_repair.generation_failed", {
      user_id: userId,
      error: String(err),
    });
    return [];
  }
}

// ---- Spaced Review Warm-up Generator ----

/**
 * Generate 2-3 warm-up review prompts from due objectives.
 * Uses SM-2 mastery data to find objectives that are overdue for review,
 * then creates brief recall questions for them.
 */
async function generateWarmupPrompts(
  userId: string,
  courseName: string,
  objectives: { id: string; title: string }[] | null,
): Promise<Prompt[]> {
  try {
    const dueObjectives = await getDueObjectives(userId, courseName, 5);
    if (dueObjectives.length === 0) return [];

    // Match due objectives to session objectives for titles
    const objMap = new Map((objectives || []).map((o) => [o.id, o.title]));

    const warmups: Prompt[] = [];
    const maxWarmups = Math.min(3, dueObjectives.length);

    for (let i = 0; i < maxWarmups; i++) {
      const due = dueObjectives[i];
      const title = objMap.get(due.objectiveKey) || due.objectiveKey;
      const daysSince = due.lastStudiedAt
        ? Math.floor((Date.now() - due.lastStudiedAt.getTime()) / (1000 * 60 * 60 * 24))
        : null;

      const timeContext = daysSince !== null
        ? ` (last studied ${daysSince} day${daysSince !== 1 ? "s" : ""} ago)`
        : "";

      warmups.push({
        id: `warmup_${i}`,
        objective_id: due.objectiveKey,
        text: `Quick review${timeContext}: From memory, explain the key concept behind "${title}". What are the most important things to remember?`,
        difficulty: Math.min(due.repetitions + 1, 3), // easier for less-practiced items
        meta: { pack: "WARMUP" },
      });
    }

    return warmups;
  } catch (err) {
    logger.error("warmup.generation_failed", { user_id: userId, error: String(err) });
    return [];
  }
}

// ---- Mastery Update ----

/**
 * Compute per-objective accuracy from attempts and update SM-2 mastery records.
 * Fire-and-forget: errors are logged but never thrown.
 */
async function updateObjectiveMastery(userId: string, runId: string, courseName: string) {
  try {
    // Fetch all scored attempts with their objective IDs and confidence ratings
    const [attempts, promptRows, plan] = await Promise.all([
      prisma.sessionAttempt.findMany({
        where: { runId, selfScore: { not: null } },
        select: { selfScore: true, promptIndex: true, confidenceRating: true },
      }),
      prisma.sessionRunPrompt.findMany({
        where: { runId },
        select: { promptIndex: true, objectiveId: true, meta: true },
      }),
      // Find nearest exam date for exam-aware spacing
      prisma.studyPlan.findFirst({
        where: { userId, courseName, examDate: { gte: new Date() } },
        orderBy: { examDate: "asc" },
        select: { examDate: true },
      }),
    ]);

    const examDate = plan?.examDate ?? undefined;

    // Build objective -> scores map (with confidence data).
    // Pretest attempts are diagnostic — expected pre-study errors must not
    // depress mastery (Richland et al. 2009).
    const objectiveScores = new Map<string, { correct: number; total: number; confidenceSum: number; confidenceCount: number }>();
    for (const attempt of attempts) {
      const promptRow = promptRows.find((p) => p.promptIndex === attempt.promptIndex);
      const objId = promptRow?.objectiveId;
      if (!objId) continue;
      const rowMeta = promptRow?.meta as { pack?: string } | null;
      if (rowMeta?.pack === "PRE_TEST") continue;

      const entry = objectiveScores.get(objId) || { correct: 0, total: 0, confidenceSum: 0, confidenceCount: 0 };
      entry.total++;
      if (attempt.selfScore === "CORRECT") entry.correct++;
      if (attempt.confidenceRating != null) {
        entry.confidenceSum += attempt.confidenceRating;
        entry.confidenceCount++;
      }
      objectiveScores.set(objId, entry);
    }

    // Update mastery for each objective (with confidence-weighted quality + exam-aware spacing)
    const updates = Array.from(objectiveScores.entries()).map(
      ([objectiveKey, { correct, total, confidenceSum, confidenceCount }]) => {
        const accuracy = total > 0 ? correct / total : 0;
        const avgConfidence = confidenceCount > 0 ? confidenceSum / confidenceCount : null;
        return updateMastery(userId, courseName, objectiveKey, accuracy, new Date(), examDate, avgConfidence);
      }
    );

    await Promise.all(updates);

    logger.info("mastery.updated", {
      user_id: userId,
      run_id: runId,
      objectives_updated: objectiveScores.size,
    });
  } catch (err) {
    logger.error("mastery.update_failed", {
      user_id: userId,
      run_id: runId,
      error: String(err),
    });
  }
}

// ---- Complete Run (idempotent) ----

export async function completeRun(userId: string, runId: string) {
  const run = await prisma.sessionRun.findUnique({
    where: { runId },
    select: { id: true, runId: true, userId: true, sessionId: true, status: true },
  });
  if (!run) return { error: "not_found" as const };
  if (run.userId !== userId) return { error: "forbidden" as const };

  // Atomically claim the ACTIVE -> COMPLETED transition inside a transaction:
  // metrics are re-read fresh (so a just-committed final attempt is included)
  // and the conditional updateMany guarantees exactly one caller wins.
  // Post-completion effects (SM-2 mastery, auto-flashcards) must run at most
  // once per run — a double-click on "End Session" must not double-advance
  // spaced-repetition schedules.
  const endedAt = new Date();
  const txResult = await prisma.$transaction(async (tx) => {
    const fresh = await tx.sessionRun.findUniqueOrThrow({
      where: { id: run.id },
      select: { status: true, metrics: true, startedAt: true, endedAt: true },
    });
    if (fresh.status === "COMPLETED") {
      return { won: false as const, metrics: fresh.metrics as unknown as RunMetrics, startedAt: fresh.startedAt, endedAt: fresh.endedAt };
    }

    const metrics = fresh.metrics as unknown as RunMetrics;
    const finalMetrics = { ...metrics, recommended_followups: computeFollowups(metrics.accuracy) };

    const updated = await tx.sessionRun.updateMany({
      where: { id: run.id, status: { not: "COMPLETED" } },
      data: {
        status: "COMPLETED",
        phase: "COMPLETE",
        endedAt,
        metrics: finalMetrics as object,
      },
    });
    if (updated.count === 0) {
      return { won: false as const, metrics: finalMetrics, startedAt: fresh.startedAt, endedAt: fresh.endedAt };
    }
    return { won: true as const, metrics: finalMetrics, startedAt: fresh.startedAt, endedAt };
  });

  if (!txResult.won) {
    return {
      data: {
        run_id: run.runId,
        status: "COMPLETED" as const,
        metrics: txResult.metrics,
        started_at: txResult.startedAt?.toISOString() ?? null,
        ended_at: txResult.endedAt?.toISOString() ?? null,
      },
    };
  }

  await runPostCompletionEffects(userId, runId, run.sessionId);

  logger.info("run.completed", {
    user_id: userId,
    run_id: runId,
    accuracy: txResult.metrics.accuracy,
    attempts_count: txResult.metrics.attempts_count,
    manual: true,
  });

  return {
    data: {
      run_id: run.runId,
      status: "COMPLETED" as const,
      metrics: txResult.metrics,
      started_at: txResult.startedAt?.toISOString() ?? null,
      ended_at: endedAt.toISOString(),
    },
  };
}

// ---- Answer standard reveal ----

/**
 * Reveal the model answer / key points for the CURRENT prompt so the student
 * can self-score against an explicit standard instead of a feeling
 * (calibration: self-assessment without a reference answer is unreliable).
 *
 * Withheld during the EXAM phase of EXAM_SIM (delayed feedback is the point
 * of an exam simulation). For repair prompts the expected correction rule
 * serves as the standard.
 */
export async function getAnswerReveal(userId: string, runId: string, index: number) {
  const run = await prisma.sessionRun.findUnique({
    where: { runId },
    select: { userId: true, currentIndex: true, phase: true, status: true, promptCount: true },
  });
  if (!run) return { error: "not_found" as const };
  if (run.userId !== userId) return { error: "forbidden" as const };
  if (run.phase === "EXAM") {
    return { error: "wrong_phase" as const, message: "Answers are revealed after the exam phase" };
  }
  if (index !== run.currentIndex) {
    return { error: "wrong_index" as const, expected: run.currentIndex };
  }

  const row = await prisma.sessionRunPrompt.findUnique({
    where: { runId_promptIndex: { runId, promptIndex: index } },
  });
  const meta = (row?.meta ?? null) as {
    format?: string;
    model_answer?: string;
    key_points?: string[];
    expected_correction_rule?: string;
  } | null;

  // Never reveal for an UNANSWERED MCQ — the model answer names the correct
  // choice, which would defeat server-side grading. MCQ correctness arrives
  // in the attempt response instead.
  if (meta?.format === "MCQ") {
    const answered = await prisma.sessionAttempt.findUnique({
      where: { runId_promptIndex: { runId, promptIndex: index } },
      select: { id: true },
    });
    if (!answered) {
      return { data: { model_answer: null, key_points: null } };
    }
  }

  return {
    data: {
      model_answer: meta?.model_answer ?? meta?.expected_correction_rule ?? null,
      key_points: Array.isArray(meta?.key_points) ? meta.key_points : null,
    },
  };
}

// ---- Post-review metacognition update ----

/**
 * Attach a self-explanation / generated example to an already-submitted
 * attempt. The review panel collects these AFTER the attempt is recorded;
 * they must never be posted as a new attempt (that would fabricate a scored
 * attempt against the next, unseen prompt).
 */
export async function updateAttemptMeta(
  userId: string,
  attemptId: string,
  input: { self_explanation?: string; generated_example?: string; socratic_answer?: string },
) {
  const attempt = await prisma.sessionAttempt.findUnique({
    where: { id: attemptId },
    select: { id: true, run: { select: { userId: true } } },
  });
  if (!attempt) return { error: "not_found" as const };
  if (attempt.run.userId !== userId) return { error: "forbidden" as const };

  await prisma.sessionAttempt.update({
    where: { id: attemptId },
    data: {
      selfExplanation: input.self_explanation ?? undefined,
      generatedExample: input.generated_example ?? undefined,
      socraticAnswer: input.socratic_answer ?? undefined,
    },
  });

  return { data: { ok: true } };
}

// ---- End break early ----

export async function endBreak(userId: string, runId: string) {
  const run = await prisma.sessionRun.findUnique({ where: { runId } });
  if (!run) return { error: "not_found" as const };
  if (run.userId !== userId) return { error: "forbidden" as const };

  const breakState = run.breakState as unknown as BreakState;
  if (!breakState.on_break) return { error: "not_on_break" as const };

  const now = new Date();
  const newState: BreakState = {
    ...breakState,
    on_break: false,
    break_started_at: undefined,
    current_cycle: breakState.current_cycle + 1,
    work_started_at: now.toISOString(),
    completed_breaks: [...breakState.completed_breaks, breakState.break_started_at!],
  };

  await prisma.sessionRun.update({
    where: { id: run.id },
    data: { breakState: newState as object },
  });

  logger.info("break.ended", {
    user_id: userId,
    run_id: runId,
    cycle: newState.current_cycle,
    early: true,
  });

  return { data: { break_state: newState } };
}

// ---- Auto-complete plan items ----

/**
 * Mark StudyPlanItems linked to this session as DONE when a run completes.
 * Only updates items in SCHEDULED or IN_PROGRESS status.
 */
async function completePlanItemsForSession(
  sessionId: string,
  completedRunId: string,
): Promise<number> {
  const result = await prisma.studyPlanItem.updateMany({
    where: {
      sessionId,
      status: { in: ["SCHEDULED", "IN_PROGRESS"] },
    },
    data: {
      status: "DONE",
      completedRunId,
      completedAt: new Date(),
    },
  });

  if (result.count > 0) {
    logger.info("plan_item.auto_completed", {
      session_id: sessionId,
      completed_run_id: completedRunId,
      items_completed: result.count,
    });
  }

  return result.count;
}
