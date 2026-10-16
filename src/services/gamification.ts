import { after } from "next/server";

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { badgesReached, type BadgeProgressValues } from "@/lib/badge-data";
import { addDays, dayKey, resolveTimeZone, zonedTimeToUtc } from "@/lib/timezone";

/**
 * XP per action. Only practice earns XP: finished sessions and card reviews
 * (plus the perfect-deck bonus). Generating a guide or asking in chat is not
 * practice, so it earns nothing and doesn't count toward a streak.
 */
export const XP_AMOUNTS: Record<string, number> = {
  FLASHCARD_REVIEW: 2,
  SESSION_COMPLETED: 10,
  PERFECT_DECK: 3,
  STREAK_MILESTONE: 0,
};

/** Zero-XP bookkeeping events. Neither one is study activity. */
const FREEZE_AWARD = "STREAK_FREEZE_AWARD";
const FREEZE_USED = "STREAK_FREEZE_USED";

/** Most streak freezes a student can hold. */
export const MAX_STREAK_FREEZES = 3;

// ---------------------------------------------------------------------------
// The student's day
// ---------------------------------------------------------------------------

/**
 * The time zone that decides what "today" is for this student, everywhere:
 * streaks, XP today, the activity heatmap and today's sessions. It lives in
 * `@/lib/timezone` (Settings, then the newest plan's zone, then UTC) and is
 * re-exported here for existing callers.
 */
export { resolveTimeZone };

/** The instant today starts in `timeZone`. */
export function startOfDay(now: Date, timeZone: string): Date {
  return zonedTimeToUtc(dayKey(now, timeZone), "00:00", timeZone);
}

/**
 * Consecutive active days ending today, or ending yesterday when today has no
 * activity yet (the streak is still alive until today ends). Pure calendar
 * arithmetic on YYYY-MM-DD keys, so daylight saving never skips a day.
 */
export function streakFromDays(activeDays: ReadonlySet<string>, todayKey: string): number {
  let cursor = activeDays.has(todayKey) ? todayKey : addDays(todayKey, -1);
  let streak = 0;
  while (activeDays.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

interface ActivityEvent {
  createdAt: Date;
  action: string;
  sourceId: string | null;
}

/**
 * The days that count toward a streak: any XP event (sessions and card
 * reviews), any completed plan item, and any day a freeze bridged. Freeze
 * awards are bookkeeping, not study.
 */
export function collectActiveDays(
  events: readonly ActivityEvent[],
  completedItems: readonly { completedAt: Date | null; startTime: Date }[],
  legacyFreezeDate: string | null,
  timeZone: string | null,
): Set<string> {
  const days = new Set<string>();
  for (const e of events) {
    if (e.action === FREEZE_AWARD) continue;
    if (e.action === FREEZE_USED) {
      days.add(e.sourceId ?? dayKey(e.createdAt, timeZone));
      continue;
    }
    days.add(dayKey(e.createdAt, timeZone));
  }
  for (const item of completedItems) {
    days.add(dayKey(item.completedAt ?? item.startTime, timeZone));
  }
  // Rows from before STREAK_FREEZE_USED events existed kept one date here.
  if (legacyFreezeDate) days.add(legacyFreezeDate);
  return days;
}

interface StreakState {
  streakFreezeUsedDate: string | null;
  streakFreezes: number;
  timezone?: string | null;
}

/**
 * How far back active days are read: a short window first, and the long one
 * only when the streak runs past the short one. Most streaks are short, and
 * every card review adds an event, so reading 400 days each time grows with use.
 */
const ACTIVE_DAY_WINDOWS = [40, 400] as const;

async function loadActiveDaysSince(
  userId: string,
  timeZone: string | null,
  legacyFreezeDate: string | null,
  since: Date,
): Promise<Set<string>> {
  const [events, items] = await Promise.all([
    prisma.xpEvent.findMany({
      where: { userId, createdAt: { gte: since } },
      select: { createdAt: true, action: true, sourceId: true },
    }),
    prisma.studyPlanItem.findMany({
      where: { plan: { userId }, status: "DONE", completedAt: { gte: since } },
      select: { completedAt: true, startTime: true },
    }),
  ]);
  return collectActiveDays(events, items, legacyFreezeDate, timeZone);
}

/**
 * Active days, enough of them to count the current streak exactly (up to
 * the last 400 days). Days older than the streak may be missing.
 */
async function loadActiveDays(
  userId: string,
  timeZone: string | null,
  legacyFreezeDate: string | null,
  now: Date,
): Promise<Set<string>> {
  const todayKey = dayKey(now, timeZone);
  let days = new Set<string>();
  for (const windowDays of ACTIVE_DAY_WINDOWS) {
    days = await loadActiveDaysSince(
      userId,
      timeZone,
      legacyFreezeDate,
      new Date(now.getTime() - windowDays * 86_400_000),
    );
    // The window's first day may be partial, so a streak that reaches the
    // day after it might run further back.
    if (streakFromDays(days, todayKey) < windowDays - 2) break;
  }
  return days;
}

/**
 * Current streak in days. Day boundaries follow `existingGameState.timezone`
 * when given, else the game state row's zone (UTC when unset). Callers that
 * resolved the student's zone pass it in.
 */
export async function computeStreak(
  userId: string,
  existingGameState?: StreakState | null,
): Promise<number> {
  const state =
    existingGameState ?? (await prisma.userGameState.findUnique({ where: { userId } }));
  const timeZone = state?.timezone ?? null;
  const now = new Date();
  const days = await loadActiveDays(userId, timeZone, state?.streakFreezeUsedDate ?? null, now);
  return streakFromDays(days, dayKey(now, timeZone));
}

/**
 * The streak Home and Progress show, with days in the student's zone
 * (resolveTimeZone). Other screens read it here so every screen agrees.
 */
export async function getStreak(userId: string): Promise<number> {
  const state = await prisma.userGameState.findUnique({
    where: { userId },
    select: { timezone: true, streakFreezeUsedDate: true, streakFreezes: true },
  });
  const timeZone = await resolveTimeZone(userId, state?.timezone ?? null);
  return computeStreak(userId, {
    streakFreezeUsedDate: state?.streakFreezeUsedDate ?? null,
    streakFreezes: state?.streakFreezes ?? 0,
    timezone: timeZone,
  });
}

// ---------------------------------------------------------------------------
// Reading progress (no writes)
// ---------------------------------------------------------------------------

export interface GameState {
  /** The zone every "today" below was computed in. */
  timeZone: string;
  xpToday: number;
  xpTotal: number;
  dailyXpGoal: number;
  streak: number;
  /** Whether today already counts toward the streak. */
  activeToday: boolean;
  streakFreezes: number;
  /** A freeze already covers today. */
  freezeUsedToday: boolean;
  reviewCount: number;
  perfectDeckCount: number;
  achievements: { badgeType: string; earnedAt: string }[];
  /**
   * Always empty. Reading progress never awards anything: achievements and
   * freezes are awarded when XP is earned (see syncProgress). Kept so older
   * callers still type-check.
   */
  newAchievements: string[];
}

const DEFAULT_DAILY_XP_GOAL = 50;

/**
 * The student's streak, XP, freezes and achievements. Read-only: safe to call
 * from any page, any number of times.
 */
export async function getGameState(userId: string): Promise<GameState> {
  const now = new Date();
  const [state, xpTotalResult, achievements, reviewCount, perfectDeckCount] = await Promise.all([
    prisma.userGameState.findUnique({ where: { userId } }),
    prisma.xpEvent.aggregate({ where: { userId }, _sum: { xpAmount: true } }),
    prisma.achievement.findMany({ where: { userId }, orderBy: { earnedAt: "desc" } }),
    prisma.cardReview.count({ where: { userId } }),
    prisma.xpEvent.count({ where: { userId, action: "PERFECT_DECK" } }),
  ]);

  const timeZone = await resolveTimeZone(userId, state?.timezone ?? null);
  const todayKey = dayKey(now, timeZone);
  const legacyFreezeDate = state?.streakFreezeUsedDate ?? null;

  const [xpTodayResult, activeDays] = await Promise.all([
    prisma.xpEvent.aggregate({
      where: { userId, createdAt: { gte: startOfDay(now, timeZone) } },
      _sum: { xpAmount: true },
    }),
    loadActiveDays(userId, timeZone, legacyFreezeDate, now),
  ]);

  return {
    timeZone,
    xpToday: xpTodayResult._sum.xpAmount || 0,
    xpTotal: xpTotalResult._sum.xpAmount || 0,
    dailyXpGoal: state?.dailyXpGoal ?? DEFAULT_DAILY_XP_GOAL,
    streak: streakFromDays(activeDays, todayKey),
    activeToday: activeDays.has(todayKey),
    streakFreezes: state?.streakFreezes ?? 0,
    freezeUsedToday: legacyFreezeDate === todayKey,
    reviewCount,
    perfectDeckCount,
    achievements: achievements.map((a) => ({
      badgeType: a.badgeType,
      earnedAt: a.earnedAt.toISOString(),
    })),
    newAchievements: [],
  };
}

// ---------------------------------------------------------------------------
// Activity by day (heatmap)
// ---------------------------------------------------------------------------

export interface DayActivity {
  /** Sessions finished that day. */
  sessions: number;
  /** Flashcard reviews. */
  reviews: number;
  /** A streak freeze covered the day. */
  freezeUsed: boolean;
  /** XP earned that day. */
  xp: number;
}

function emptyDay(): DayActivity {
  return { sessions: 0, reviews: 0, freezeUsed: false, xp: 0 };
}

/**
 * Pure: bucket XP events and completed plan items into the student's days.
 * A plan item finished through a session already has a SESSION_COMPLETED
 * event for its run, so it is only counted when no such event exists.
 */
export function bucketActivity(
  events: readonly (ActivityEvent & { xpAmount: number })[],
  completedItems: readonly { completedAt: Date | null; startTime: Date; completedRunId: string | null }[],
  timeZone: string,
): Map<string, DayActivity> {
  const days = new Map<string, DayActivity>();
  const day = (key: string) => {
    let entry = days.get(key);
    if (!entry) {
      entry = emptyDay();
      days.set(key, entry);
    }
    return entry;
  };
  const runsWithEvent = new Set<string>();

  for (const e of events) {
    if (e.action === FREEZE_AWARD) continue;
    if (e.action === FREEZE_USED) {
      day(e.sourceId ?? dayKey(e.createdAt, timeZone)).freezeUsed = true;
      continue;
    }
    const entry = day(dayKey(e.createdAt, timeZone));
    entry.xp += e.xpAmount;
    if (e.action === "SESSION_COMPLETED") {
      entry.sessions += 1;
      if (e.sourceId) runsWithEvent.add(e.sourceId);
    } else if (e.action === "FLASHCARD_REVIEW") {
      entry.reviews += 1;
    }
  }
  for (const item of completedItems) {
    if (item.completedRunId && runsWithEvent.has(item.completedRunId)) continue;
    day(dayKey(item.completedAt ?? item.startTime, timeZone)).sessions += 1;
  }
  return days;
}

/** Activity per day since `sinceKey` (inclusive), in the student's zone. */
export async function getActivityByDay(
  userId: string,
  timeZone: string,
  sinceKey: string,
): Promise<Map<string, DayActivity>> {
  // A day before the key in UTC covers every zone's start of that day.
  const since = new Date(Date.parse(`${addDays(sinceKey, -1)}T00:00:00Z`));
  const [events, items] = await Promise.all([
    prisma.xpEvent.findMany({
      where: { userId, createdAt: { gte: since } },
      select: { createdAt: true, action: true, sourceId: true, xpAmount: true },
    }),
    prisma.studyPlanItem.findMany({
      where: { plan: { userId }, status: "DONE", completedAt: { gte: since } },
      select: { completedAt: true, startTime: true, completedRunId: true },
    }),
  ]);
  const days = bucketActivity(events, items, timeZone);
  for (const key of days.keys()) {
    if (key < sinceKey) days.delete(key);
  }
  return days;
}

// ---------------------------------------------------------------------------
// Earning progress (writes)
// ---------------------------------------------------------------------------

/**
 * Record XP for an action, then award any freeze or achievement it unlocks.
 *
 * Inside a Next request the awarding runs after the response is sent, so the
 * student never waits for it (the app runs as one long-lived Node server, so
 * the work finishes). Elsewhere, such as scripts and tests, it runs before
 * this returns. Awarding never fails the action that earned the XP.
 */
export async function awardXp(
  userId: string,
  action: string,
  xpAmount?: number,
  sourceId?: string,
): Promise<{ id: string; xpAmount: number }> {
  const amount = xpAmount ?? XP_AMOUNTS[action] ?? 0;
  if (amount <= 0) return { id: "", xpAmount: 0 };

  const event = await prisma.xpEvent.create({
    data: {
      userId,
      action,
      xpAmount: amount,
      sourceId: sourceId ?? null,
    },
  });

  logger.info("xp.awarded", { user_id: userId, action, xp: amount, source_id: sourceId });

  const earned = { createdAt: event.createdAt };
  await afterResponse(async () => {
    try {
      await syncProgress(userId, earned);
    } catch (err) {
      logger.error("progress.sync_failed", { user_id: userId, error: String(err) });
    }
  });

  return { id: event.id, xpAmount: amount };
}

/** Runs `task` once the response is sent when called inside a Next request, else right away. */
async function afterResponse(task: () => Promise<void>): Promise<void> {
  try {
    after(task);
    return;
  } catch {
    // Outside a request scope (scripts, tests, jobs) there is nothing to wait for.
  }
  await task();
}

/**
 * Whether the XP event created at `at` is the student's first study of their
 * day. Only then can the streak change: a later event lands on a day that
 * already counts. A freeze used earlier today doesn't count as study here,
 * so studying after it still checks the streak milestones.
 */
async function isFirstStudyOfDay(userId: string, at: Date, timeZone: string): Promise<boolean> {
  const earlier = await prisma.xpEvent.findFirst({
    where: {
      userId,
      createdAt: { gte: startOfDay(at, timeZone), lt: at },
      action: { notIn: [FREEZE_AWARD, FREEZE_USED] },
    },
    select: { id: true },
  });
  return !earlier;
}

/**
 * The write path for progress: awards a streak freeze at each 7-day
 * milestone and any achievement the student has reached. Idempotent, so
 * running it twice awards nothing new.
 *
 * Pass `earned` (the XP event that triggered it) to skip the streak work
 * when that event wasn't the first study of the day: the streak, its freeze
 * milestones and the streak achievements can't have changed since the first
 * one ran. `streak` is then null.
 */
export async function syncProgress(
  userId: string,
  earned?: { createdAt: Date },
): Promise<{ newAchievements: string[]; streakFreezes: number; streak: number | null }> {
  const state = await prisma.userGameState.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
  const timeZone = await resolveTimeZone(userId, state.timezone ?? null);
  const streakMayChange = !earned || (await isFirstStudyOfDay(userId, earned.createdAt, timeZone));

  const [streak, xpTotalResult, achievements, reviewCount, perfectDeckCount] = await Promise.all([
    streakMayChange ? computeStreak(userId, { ...state, timezone: timeZone }) : null,
    prisma.xpEvent.aggregate({ where: { userId }, _sum: { xpAmount: true } }),
    prisma.achievement.findMany({ where: { userId }, select: { badgeType: true } }),
    prisma.cardReview.count({ where: { userId } }),
    prisma.xpEvent.count({ where: { userId, action: "PERFECT_DECK" } }),
  ]);

  const streakFreezes =
    streak === null ? state.streakFreezes : await maybeAwardStreakFreeze(userId, streak, state.streakFreezes);

  const values: BadgeProgressValues = {
    // Unchanged streaks were already checked for achievements by the day's first event.
    streak: streak ?? 0,
    xp: xpTotalResult._sum.xpAmount || 0,
    reviews: reviewCount,
    perfectDecks: perfectDeckCount,
  };
  const newAchievements = badgesReached(values, new Set(achievements.map((a) => a.badgeType)));
  if (newAchievements.length > 0) {
    await prisma.achievement.createMany({
      data: newAchievements.map((badgeType) => ({ userId, badgeType })),
      skipDuplicates: true,
    });
    logger.info("achievements.awarded", { user_id: userId, badges: newAchievements });
  }

  return { newAchievements, streakFreezes, streak };
}

/**
 * Atomically award a streak freeze at 7-day milestones, up to the cap.
 * A zero-XP marker event per milestone stops a second award.
 * Returns the freeze count after the operation.
 */
async function maybeAwardStreakFreeze(
  userId: string,
  streak: number,
  currentFreezes: number,
): Promise<number> {
  if (streak <= 0 || streak % 7 !== 0 || currentFreezes >= MAX_STREAK_FREEZES) return currentFreezes;

  const existingAward = await prisma.xpEvent.findFirst({
    where: { userId, action: FREEZE_AWARD, sourceId: String(streak) },
    select: { id: true },
  });
  if (existingAward) return currentFreezes;

  const result = await prisma.userGameState.updateMany({
    where: { userId, streakFreezes: { lt: MAX_STREAK_FREEZES } },
    data: { streakFreezes: { increment: 1 } },
  });

  if (result.count > 0) {
    // Created directly: awardXp skips zero-amount events.
    await prisma.xpEvent.create({
      data: {
        userId,
        action: FREEZE_AWARD,
        xpAmount: 0,
        sourceId: String(streak),
      },
    });
    logger.info("streak.freeze_earned", { user_id: userId, streak });
    return currentFreezes + 1;
  }
  return currentFreezes;
}

export type FreezeRefusal = "no_freezes" | "already_used_today" | "already_active";

/**
 * Spend a streak freeze on today, so a day without study keeps the streak.
 * Refused when none are left, when one already covers today, or when the
 * student already studied today (the streak is safe without it).
 */
export async function consumeStreakFreeze(
  userId: string,
): Promise<
  | { success: true; freezesRemaining: number }
  | { success: false; freezesRemaining: number; reason: FreezeRefusal }
> {
  const state = await prisma.userGameState.findUnique({ where: { userId } });
  const timeZone = await resolveTimeZone(userId, state?.timezone ?? null);
  const now = new Date();
  const todayStr = dayKey(now, timeZone);
  const freezes = state?.streakFreezes ?? 0;

  if (!state || freezes <= 0) {
    return { success: false, freezesRemaining: freezes, reason: "no_freezes" };
  }
  if (state.streakFreezeUsedDate === todayStr) {
    return { success: false, freezesRemaining: freezes, reason: "already_used_today" };
  }
  const activeDays = await loadActiveDays(userId, timeZone, state.streakFreezeUsedDate, now);
  if (activeDays.has(todayStr)) {
    return { success: false, freezesRemaining: freezes, reason: "already_active" };
  }

  // Conditional update: only decrement if freezes remain and today isn't
  // already covered. streakFreezeUsedDate is NULL until the first use, and
  // Prisma's scalar `not:` filter excludes NULL rows, so match NULL explicitly.
  const result = await prisma.userGameState.updateMany({
    where: {
      userId,
      streakFreezes: { gt: 0 },
      OR: [{ streakFreezeUsedDate: null }, { streakFreezeUsedDate: { not: todayStr } }],
    },
    data: {
      streakFreezes: { decrement: 1 },
      streakFreezeUsedDate: todayStr,
    },
  });

  if (result.count === 0) {
    const fresh = await prisma.userGameState.findUnique({
      where: { userId },
      select: { streakFreezes: true, streakFreezeUsedDate: true },
    });
    const remaining = fresh?.streakFreezes ?? 0;
    return {
      success: false,
      freezesRemaining: remaining,
      reason: remaining > 0 ? "already_used_today" : "no_freezes",
    };
  }

  // Record the bridged day durably: streakFreezeUsedDate only holds the most
  // recent use, so a second freeze would otherwise erase the first one's day.
  await prisma.xpEvent.create({
    data: {
      userId,
      action: FREEZE_USED,
      xpAmount: 0,
      sourceId: todayStr,
    },
  });

  const updated = await prisma.userGameState.findUnique({
    where: { userId },
    select: { streakFreezes: true },
  });

  logger.info("streak.freeze_used", { user_id: userId, remaining: updated?.streakFreezes });
  return { success: true, freezesRemaining: updated?.streakFreezes ?? 0 };
}
