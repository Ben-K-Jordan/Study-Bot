/**
 * Finishing a run and its side effects (mastery, XP, follow-ups, flashcards,
 * plan items), and ending a break early.
 */
import { prisma } from "@/lib/db";
import { dateColumnValue } from "@/lib/plan-dates";
import { dayKey, getUserTimezone } from "@/lib/timezone";
import { followupsFromDueDates, computeFollowups } from "@/lib/spacing";
import { endBreakEarly, type BreakState } from "@/lib/breaks";
import { updateMastery } from "@/lib/mastery";
import { logger } from "@/lib/logger";
import { createFlashcardsFromErrors } from "@/lib/auto-flashcards";
import { awardXp } from "@/services/gamification";
import type { RunMetrics } from "./shared";

// ---- Post-completion side effects ----

/**
 * Shared post-completion work: mastery update, flashcard generation,
 * plan item completion. Called from all three completion paths
 * (handleImmediateScoring, handleExamScore, completeRun) to ensure
 * consistency.
 */
export async function runPostCompletionEffects(
  userId: string,
  runId: string,
  sessionId: string,
  finalMetrics?: RunMetrics,
): Promise<void> {
  try {
    const s = await prisma.session.findUnique({
      where: { sessionId },
      select: { courseName: true },
    });
    if (!s) return;

    await updateObjectiveMastery(userId, runId, s.courseName);

    // Sessions are the app's highest-value activity — they must move the
    // daily XP goal (previously only flashcard reviews did, nudging users
    // toward card grinding over retrieval practice). Deduped per run.
    try {
      const already = await prisma.xpEvent.findFirst({
        where: { userId, action: "SESSION_COMPLETED", sourceId: runId },
        select: { id: true },
      });
      if (!already) {
        await awardXp(userId, "SESSION_COMPLETED", undefined, runId);
      }
    } catch (xpErr) {
      logger.warn("xp.session_award_failed", { user_id: userId, run_id: runId, error: String(xpErr) });
    }

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
        // Callers that just computed the final metrics pass them in; only
        // fall back to a re-read when they weren't provided.
        let m: RunMetrics | undefined = finalMetrics;
        if (!m) {
          const runRow = await prisma.sessionRun.findUnique({
            where: { runId },
            select: { metrics: true },
          });
          if (runRow) m = runRow.metrics as unknown as RunMetrics;
        }
        if (m) {
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

// ---- Mastery Update ----

/**
 * Compute per-objective accuracy from attempts and update SM-2 mastery records.
 * Fire-and-forget: errors are logged but never thrown.
 */
async function updateObjectiveMastery(userId: string, runId: string, courseName: string) {
  try {
    // Fetch all scored attempts with their objective IDs and confidence ratings
    // An exam today still counts: compare the stored day with today in the
    // student's zone, not with the current UTC instant (plan-dates.ts).
    const todayKey = dayKey(new Date(), await getUserTimezone(userId));
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
        where: { userId, courseName, examDate: { gte: dateColumnValue(todayKey) } },
        orderBy: { examDate: "asc" },
        select: { examDate: true },
      }),
    ]);

    const examDate = plan?.examDate ?? undefined;

    // Build objective -> scores map (with confidence data).
    // Pretest attempts are diagnostic — expected pre-study errors must not
    // depress mastery (Richland et al. 2009).
    const objectiveScores = new Map<string, { correct: number; total: number; confidenceSum: number; confidenceCount: number }>();
    const rowByIndex = new Map(promptRows.map((p) => [p.promptIndex, p]));
    for (const attempt of attempts) {
      const promptRow = rowByIndex.get(attempt.promptIndex);
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

  await runPostCompletionEffects(userId, runId, run.sessionId, txResult.metrics);

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

// ---- End break early ----

export async function endBreak(userId: string, runId: string) {
  const run = await prisma.sessionRun.findUnique({ where: { runId } });
  if (!run) return { error: "not_found" as const };
  if (run.userId !== userId) return { error: "forbidden" as const };

  const breakState = run.breakState as unknown as BreakState;
  if (!breakState.on_break) return { error: "not_on_break" as const };

  const newState = endBreakEarly(breakState);

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
      // Moved sessions (RESCHEDULED) are still to do, and a missed or skipped
      // session the student does anyway is done, so finishing any of them
      // marks it done.
      status: { in: ["SCHEDULED", "IN_PROGRESS", "RESCHEDULED", "MISSED", "SKIPPED"] },
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
