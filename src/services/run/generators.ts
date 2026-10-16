/**
 * The questions a run adds in front of its deck: pretests for new topics,
 * spaced reviews of due topics and repairs of errors from earlier sessions.
 */
import { prisma } from "@/lib/db";
import { inSentence, type Prompt } from "@/lib/prompts";
import { getDueObjectives } from "@/lib/mastery";
import { logger } from "@/lib/logger";
import { daysAgoPhrase, humanizeObjectiveKey } from "./shared";

// ---- Pre-test Prompt Generator ----

/** A pretest question for a topic the student hasn't studied yet. */
export function pretestQuestionText(topic: string): string {
  return `Pretest: what do you already know about ${inSentence(topic)}? Explain as much as you can from memory.`;
}

/**
 * A cross-session repair question. The student's own similar question is
 * the retest when there is one; otherwise the question answered incorrectly
 * comes back with a request for the correction rule. Keeps "From memory"
 * (repair templates share it across modes).
 */
export function crossSessionRepairText(params: {
  daysSince: number;
  variantQuestion?: string | null;
  originalText?: string | null;
}): string {
  const variant = params.variantQuestion?.trim();
  const original = params.originalText?.trim();
  const when = params.daysSince <= 0 ? "earlier today" : daysAgoPhrase(params.daysSince);
  // The question to answer comes first (the screen shows it largest); the
  // instruction follows as its own paragraph.
  if (variant) {
    return `${variant}\n\nFrom memory: answer this similar question you wrote ${when}, then state the correction rule.`;
  }
  if (original) {
    return `${original}\n\nYou answered this incorrectly ${when}. From memory: state the correction rule, say why the error happens, and give a new example where the rule applies.`;
  }
  return "From memory: state the correction rule for an error you made earlier, say why the error happens, and give a new example where the rule applies.";
}

/** A spaced review question for a due topic. */
export function reviewQuestionText(topic: string, daysSince: number | null): string {
  const last = daysSince === null ? "" : ` You last studied it ${daysSince === 0 ? "earlier today" : daysAgoPhrase(daysSince)}.`;
  return `From memory: explain ${inSentence(topic)} and what matters most to remember about it.${last}`;
}

/**
 * Generate diagnostic pre-test questions for objectives the student has never studied.
 * Research (Richland et al. 2009): testing BEFORE studying enhances subsequent learning
 * by 10-20%, even when students get pre-test questions wrong.
 *
 * Returns up to 2 pre-test prompts for never-seen objectives.
 */
export async function generatePretestPrompts(
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
        text: pretestQuestionText(obj.title),
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
export async function generateCrossSessionRepairs(
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
      const originalText = attemptMap.get(`${err.runId}:${err.promptIndex}`)?.trim() || undefined;
      const daysSince = Math.floor(
        (Date.now() - err.createdAt.getTime()) / (1000 * 60 * 60 * 24),
      );

      const text = crossSessionRepairText({
        daysSince,
        variantQuestion: err.variantQuestion,
        originalText,
      });

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
export async function generateWarmupPrompts(
  userId: string,
  courseName: string,
  objectives: { id: string; title: string }[] | null,
): Promise<Prompt[]> {
  try {
    const dueObjectives = await getDueObjectives(userId, courseName, 5);
    if (dueObjectives.length === 0) return [];

    const maxWarmups = Math.min(3, dueObjectives.length);
    const due = dueObjectives.slice(0, maxWarmups);

    // Topic names: this session's objectives first, then any earlier session
    // in the course that listed the key, and only then the key made readable.
    // Never the raw snake_case key.
    const titles = new Map((objectives || []).map((o) => [o.id, o.title]));
    if (due.some((d) => !titles.has(d.objectiveKey))) {
      const earlier = await prisma.session.findMany({
        where: { userId, courseName },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { objectives: true },
      });
      for (const s of earlier) {
        for (const o of (s.objectives as { id?: unknown; title?: unknown }[] | null) ?? []) {
          if (typeof o?.id === "string" && typeof o.title === "string" && !titles.has(o.id)) {
            titles.set(o.id, o.title);
          }
        }
      }
    }

    const warmups: Prompt[] = [];
    for (let i = 0; i < due.length; i++) {
      const item = due[i];
      const title = titles.get(item.objectiveKey) ?? humanizeObjectiveKey(item.objectiveKey);
      const daysSince = item.lastStudiedAt
        ? Math.floor((Date.now() - item.lastStudiedAt.getTime()) / (1000 * 60 * 60 * 24))
        : null;

      warmups.push({
        id: `warmup_${i}`,
        objective_id: item.objectiveKey,
        text: reviewQuestionText(title, daysSince),
        difficulty: Math.min(item.repetitions + 1, 3), // easier for less-practiced items
        meta: { pack: "WARMUP" },
      });
    }

    return warmups;
  } catch (err) {
    logger.error("warmup.generation_failed", { user_id: userId, error: String(err) });
    return [];
  }
}
