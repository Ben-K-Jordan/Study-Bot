/**
 * SM-2-like spaced repetition mastery engine.
 *
 * Updates objective mastery records based on student accuracy.
 * Algorithm inspired by SuperMemo SM-2 with simplified quality mapping.
 */
import { prisma } from "./db";

// ---------------------------------------------------------------------------
// SM-2 core algorithm
// ---------------------------------------------------------------------------

export interface SM2State {
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
}

export interface SM2Update extends SM2State {
  nextDueAt: Date;
}

/**
 * Map accuracy (0–1) to SM-2 quality (0–5).
 * >= 0.9 → 5, >= 0.8 → 4, >= 0.7 → 3, >= 0.5 → 2, >= 0.3 → 1, else → 0
 */
export function accuracyToQuality(accuracy: number): number {
  if (accuracy >= 0.9) return 5;
  if (accuracy >= 0.8) return 4;
  if (accuracy >= 0.7) return 3;
  if (accuracy >= 0.5) return 2;
  if (accuracy >= 0.3) return 1;
  return 0;
}

/**
 * Compute the next SM-2 state given current state and a quality score (0–5).
 */
export function sm2Next(
  current: SM2State,
  quality: number,
  now: Date = new Date(),
): SM2Update {
  let { easeFactor, intervalDays, repetitions } = current;

  if (quality < 3) {
    // Failed: reset repetitions and interval
    repetitions = 0;
    intervalDays = 1;
  } else {
    // Passed: advance
    if (repetitions === 0) {
      intervalDays = 1;
    } else if (repetitions === 1) {
      intervalDays = 6;
    } else {
      intervalDays = Math.round(intervalDays * easeFactor);
    }
    repetitions++;
  }

  // Update ease factor (minimum 1.3)
  easeFactor = Math.max(
    1.3,
    easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
  );

  const nextDueAt = new Date(now);
  nextDueAt.setDate(nextDueAt.getDate() + intervalDays);

  return { easeFactor, intervalDays, repetitions, nextDueAt };
}

// ---------------------------------------------------------------------------
// Database operations
// ---------------------------------------------------------------------------

/**
 * Update mastery for a single objective after a study session.
 * Creates the record if it doesn't exist (upsert).
 */
export async function updateMastery(
  userId: string,
  courseName: string,
  objectiveKey: string,
  accuracy: number,
  now: Date = new Date(),
): Promise<SM2Update> {
  const existing = await prisma.objectiveMastery.findUnique({
    where: {
      userId_courseName_objectiveKey: {
        userId,
        courseName,
        objectiveKey,
      },
    },
  });

  const current: SM2State = existing
    ? {
        easeFactor: existing.easeFactor,
        intervalDays: existing.intervalDays,
        repetitions: existing.repetitions,
      }
    : { easeFactor: 2.5, intervalDays: 0, repetitions: 0 };

  const quality = accuracyToQuality(accuracy);
  const update = sm2Next(current, quality, now);

  await prisma.objectiveMastery.upsert({
    where: {
      userId_courseName_objectiveKey: {
        userId,
        courseName,
        objectiveKey,
      },
    },
    create: {
      userId,
      courseName,
      objectiveKey,
      easeFactor: update.easeFactor,
      intervalDays: update.intervalDays,
      repetitions: update.repetitions,
      lastAccuracy: accuracy,
      lastStudiedAt: now,
      nextDueAt: update.nextDueAt,
    },
    update: {
      easeFactor: update.easeFactor,
      intervalDays: update.intervalDays,
      repetitions: update.repetitions,
      lastAccuracy: accuracy,
      lastStudiedAt: now,
      nextDueAt: update.nextDueAt,
    },
  });

  return update;
}

/**
 * Get overdue objectives for a user+course, ordered by due date ascending.
 */
export async function getDueObjectives(
  userId: string,
  courseName: string,
  limit: number = 20,
  now: Date = new Date(),
) {
  return prisma.objectiveMastery.findMany({
    where: {
      userId,
      courseName,
      nextDueAt: { lte: now },
    },
    orderBy: { nextDueAt: "asc" },
    take: limit,
  });
}

/**
 * Get mastery summary for a user+course.
 */
export async function getMasterySummary(userId: string, courseName: string) {
  const objectives = await prisma.objectiveMastery.findMany({
    where: { userId, courseName },
    orderBy: { objectiveKey: "asc" },
  });

  const now = new Date();
  const total = objectives.length;
  const due = objectives.filter((o) => o.nextDueAt && o.nextDueAt <= now).length;
  const mastered = objectives.filter((o) => o.repetitions >= 3 && o.easeFactor >= 2.0).length;

  return {
    total,
    due,
    mastered,
    objectives: objectives.map((o) => ({
      objective_key: o.objectiveKey,
      ease_factor: o.easeFactor,
      interval_days: o.intervalDays,
      repetitions: o.repetitions,
      last_accuracy: o.lastAccuracy,
      last_studied_at: o.lastStudiedAt?.toISOString() ?? null,
      next_due_at: o.nextDueAt?.toISOString() ?? null,
      is_due: o.nextDueAt ? o.nextDueAt <= now : false,
    })),
  };
}
