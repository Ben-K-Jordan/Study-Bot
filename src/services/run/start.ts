/**
 * Starting a run (building and storing its deck) or resuming the open one.
 */
import { prisma } from "@/lib/db";
import { generateSessionId } from "@/lib/session-id";
import {
  generateRetrievalPrompts,
  generateInterleavedPrompts,
  generateErrorRepairPrompts,
  interleaveByObjective,
  type Prompt,
  type ErrorLogForRepair,
} from "@/lib/prompts";
import { generateContentAwarePrompts } from "@/lib/content-prompts";
import { generateWorkedExampleDeck } from "@/lib/worked-examples";
import { createProvider } from "@/lib/ai/provider-factory";
import type { GatewayContext } from "@/lib/ai/gateway";
import { initBreakState, checkBreakNeeded, type BreakState } from "@/lib/breaks";
import { logger } from "@/lib/logger";
import type { RunnableMode } from "@/lib/validation";
import { clampPromptCount, RUNNABLE_MODES } from "@/lib/validation";
import { emptyMetrics, initialPhaseForMode, policiesForMode, prependBudget } from "./shared";
import { getPromptAt, redactPrompts, toPromptView } from "./prompt-view";
import { generateCrossSessionRepairs, generatePretestPrompts, generateWarmupPrompts } from "./generators";

// ---- Start / Resume ----

/**
 * Puts the questions a run adds (repairs of earlier errors, pretests for new
 * topics, reviews of due topics) in front of the mode's own deck, inside the
 * requested question count rather than on top of it. Pure, so the deck rules
 * are unit-tested without a database.
 *
 * - Up to prependBudget(promptCount) added questions. When the budget is
 *   tight, repairs win (successive relearning on known gaps), then
 *   pretests (they prime the new material), then reviews.
 * - Deck order: pretests first (pretesting primes what follows), then
 *   reviews, then repairs, whatever the selection order.
 * - The mode's own questions fill the rest of the count, at least one.
 *
 * Returns the base deck itself (same array) when nothing is added.
 */
export function assembleDeck(
  base: Prompt[],
  injections: { repairs: Prompt[]; pretests: Prompt[]; warmups: Prompt[] },
  promptCount: number,
): { prompts: Prompt[]; counts: { pretests: number; warmups: number; repairs: number } } {
  const budget = prependBudget(promptCount);
  const selected: Prompt[] = [];
  for (const list of [injections.repairs, injections.pretests, injections.warmups]) {
    for (const p of list) {
      if (selected.length < budget) selected.push(p);
    }
  }
  if (selected.length === 0) return { prompts: base, counts: { pretests: 0, warmups: 0, repairs: 0 } };

  const pretests = selected.filter((p) => p.meta?.pack === "PRE_TEST");
  const warmups = selected.filter((p) => p.meta?.pack === "WARMUP");
  const repairs = selected.filter((p) => p.meta?.pack === "CROSS_SESSION_REPAIR");
  const ordered = [...pretests, ...warmups, ...repairs];
  const remainder = Math.max(1, promptCount - ordered.length);
  return {
    prompts: [...ordered, ...base.slice(0, remainder)],
    counts: { pretests: pretests.length, warmups: warmups.length, repairs: repairs.length },
  };
}

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

  // Held to 1 to 60 here too: rows stored before the schema bound the count
  // could ask for any number of questions.
  const promptCount = clampPromptCount(targetOutcome?.prompt_count);

  const sessionParams = {
    objectives,
    target_outcome: targetOutcome ? { prompt_count: promptCount } : null,
    topic_scope: session.topicScope,
  };

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
      // once corrected, are remembered best), then newest. Scoped to this
      // session's course (matching the cross-session repair injection and
      // the recommendation trigger) so a Chemistry repair session never
      // surfaces Biology errors.
      const errorLogs = await prisma.sessionErrorLog.findMany({
        where: {
          userId,
          resolvedAt: null,
          run: {
            session: { courseName: session.courseName },
          },
        },
        orderBy: [
          { confidenceRating: { sort: "desc", nulls: "last" } },
          { createdAt: "desc" },
        ],
        take: count,
      });

      // Batch-fetch only the specific attempts we need (avoids loading all
      // attempts per parent run).
      const attemptKeys = errorLogs.map((log) => ({
        runId: log.runId,
        promptIndex: log.promptIndex,
      }));
      const relevantAttempts = attemptKeys.length > 0
        ? await prisma.sessionAttempt.findMany({
            where: { OR: attemptKeys },
            select: { runId: true, promptIndex: true, promptText: true },
          })
        : [];
      const attemptTextByKey = new Map(
        relevantAttempts.map((a) => [`${a.runId}:${a.promptIndex}`, a.promptText]),
      );

      const logsForRepair: ErrorLogForRepair[] = errorLogs.map((log) => ({
        id: log.id,
        prompt_index: log.promptIndex,
        error_type: log.errorType,
        correction_rule: log.correctionRule,
        variant_question: log.variantQuestion,
        prompt_text: attemptTextByKey.get(`${log.runId}:${log.promptIndex}`),
      }));

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
  // Skip for EXAM_SIM (fixed format), ERROR_REPAIR (already targeted), and
  // WORKED_EXAMPLES (structured fading sequences must not be interrupted).
  //
  // Injections are BUDGETED INTO the requested prompt count, not stacked on
  // top: a student who asks for 10 prompts gets 10, of which up to 3 are
  // review/diagnostic/repair items. Session length stays predictable.
  // Priority when the budget is tight: repairs (successive relearning on
  // known gaps) > pretests (prime the new material) > warm-ups (due review).
  if (mode !== "EXAM_SIM" && mode !== "ERROR_REPAIR" && mode !== "WORKED_EXAMPLES") {
    const budget = prependBudget(promptCount);
    if (budget > 0) {
      const [pretestPrompts, warmupPrompts, errorRepairPrompts] = await Promise.all([
        generatePretestPrompts(userId, session.courseName, objectives),
        generateWarmupPrompts(userId, session.courseName, objectives),
        generateCrossSessionRepairs(userId, session.courseName),
      ]);

      const deck = assembleDeck(
        prompts,
        { repairs: errorRepairPrompts, pretests: pretestPrompts, warmups: warmupPrompts },
        promptCount,
      );
      if (deck.prompts !== prompts) {
        prompts = deck.prompts;
        logger.info("run.warmup_budgeted", {
          user_id: userId,
          session_id: sessionId,
          budget,
          pretest_count: deck.counts.pretests,
          warmup_count: deck.counts.warmups,
          repair_count: deck.counts.repairs,
          total: prompts.length,
        });
      }
    }
  }

  const runId = generateSessionId();
  const breakState = initBreakState(breakProtocol);
  const metrics = emptyMetrics();
  const policies = policiesForMode(mode);
  const phase = initialPhaseForMode(mode);

  // Rows for the normalized SessionRunPrompt table, built up front so the
  // advisory-lock transaction below only issues a single batch insert
  // instead of one round-trip per prompt.
  const promptRowsToInsert = prompts.map((p, i) => {
    // Merge MCQ fields into meta JSON for storage
    const storedMeta: Record<string, unknown> = p.meta ? { ...p.meta } : {};
    if (p.format === "MCQ" && p.choices && p.correctIndex != null) {
      storedMeta.format = p.format;
      storedMeta.choices = p.choices;
      storedMeta.correctIndex = p.correctIndex;
    }
    return {
      runId,
      promptIndex: i,
      objectiveId: p.objective_id ?? null,
      text: p.text,
      difficulty: p.difficulty ?? 1,
      sourceType: p.meta?.source_error_log_id ? "ERROR_LOG" : "GENERATED",
      sourceRefId: p.meta?.source_error_log_id ?? null,
      meta: Object.keys(storedMeta).length > 0 ? (storedMeta as object) : undefined,
    };
  });

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

    // Write prompts to normalized table in a single batch insert
    await tx.sessionRunPrompt.createMany({ data: promptRowsToInsert });
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
