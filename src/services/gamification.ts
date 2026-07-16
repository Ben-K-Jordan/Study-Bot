import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { TOTAL_BADGES, ALL_BADGES } from "@/lib/badge-data";
import { dayKey, getUserTimezone } from "@/lib/timezone";

export const XP_AMOUNTS: Record<string, number> = {
  FLASHCARD_REVIEW: 2,
  GUIDE_GENERATED: 5,
  CHAT_QUESTION: 1,
  SESSION_COMPLETED: 10,
  PERFECT_DECK: 3,
  STREAK_MILESTONE: 0,
};

export type BadgeType = string;

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
  return { id: event.id, xpAmount: amount };
}

export async function getGameState(userId: string): Promise<{
  xpToday: number;
  xpTotal: number;
  dailyXpGoal: number;
  streak: number;
  streakFreezes: number;
  reviewCount: number;
  achievements: { badgeType: string; earnedAt: string }[];
  newAchievements: string[];
}> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [xpTodayResult, xpTotalResult, gameState, achievements, reviewCount] = await Promise.all([
    prisma.xpEvent.aggregate({
      where: { userId, createdAt: { gte: today } },
      _sum: { xpAmount: true },
    }),
    prisma.xpEvent.aggregate({
      where: { userId },
      _sum: { xpAmount: true },
    }),
    getOrCreateGameState(userId),
    prisma.achievement.findMany({
      where: { userId },
      orderBy: { earnedAt: "desc" },
    }),
    prisma.cardReview.count({ where: { userId } }),
  ]);

  const streak = await computeStreak(userId, gameState);

  // Award streak freeze atomically — returns updated freeze count
  const updatedFreezes = await maybeAwardStreakFreeze(userId, streak, gameState.streakFreezes);

  const existingBadges = new Set(achievements.map((a) => a.badgeType));
  const totalXp = xpTotalResult._sum.xpAmount || 0;
  const newAchievements = await checkAndAwardAchievements(userId, existingBadges, streak, totalXp, reviewCount);

  const allAchievements = newAchievements.length > 0
    ? [
        ...achievements.map((a) => ({ badgeType: a.badgeType, earnedAt: a.earnedAt.toISOString() })),
        ...newAchievements.map((b) => ({ badgeType: b, earnedAt: new Date().toISOString() })),
      ]
    : achievements.map((a) => ({ badgeType: a.badgeType, earnedAt: a.earnedAt.toISOString() }));

  return {
    xpToday: xpTodayResult._sum.xpAmount || 0,
    xpTotal: totalXp,
    dailyXpGoal: gameState.dailyXpGoal,
    streak,
    streakFreezes: updatedFreezes,
    reviewCount,
    achievements: allAchievements,
    newAchievements,
  };
}

export async function setDailyXpGoal(userId: string, goal: number): Promise<void> {
  const clamped = Math.max(10, Math.min(500, goal));
  await prisma.userGameState.upsert({
    where: { userId },
    create: { userId, dailyXpGoal: clamped },
    update: { dailyXpGoal: clamped },
  });
}

export async function consumeStreakFreeze(userId: string): Promise<{ success: boolean; freezesRemaining: number }> {
  // "Today" follows the user's clock (null timezone = UTC, the old behavior)
  const timezone = await getUserTimezone(userId);
  const todayStr = dayKey(new Date(), timezone);

  // Atomic conditional update: only decrement if freezes > 0 and not already used today.
  // streakFreezeUsedDate is NULL until the first use, and Prisma's scalar `not:`
  // filter excludes NULL rows — so NULL must be matched explicitly.
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
    // Either no freezes left or already used today — fetch current state for response
    const state = await prisma.userGameState.findUnique({
      where: { userId },
      select: { streakFreezes: true },
    });
    return { success: false, freezesRemaining: state?.streakFreezes ?? 0 };
  }

  // Record the bridged day durably — streakFreezeUsedDate only holds the most
  // recent use, so a second freeze would otherwise erase the day the first
  // freeze bridged and retroactively collapse the streak.
  await prisma.xpEvent.create({
    data: {
      userId,
      action: "STREAK_FREEZE_USED",
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

/**
 * Compute current streak from active days (dates with any XP or completed plan items).
 * Accepts pre-fetched gameState to avoid redundant DB read.
 *
 * Day boundaries follow the user's timezone (UserGameState.timezone); a null
 * timezone means UTC day keys — identical to the historical behavior.
 */
export async function computeStreak(
  userId: string,
  existingGameState?: {
    streakFreezeUsedDate: string | null;
    streakFreezes: number;
    timezone?: string | null;
  } | null,
): Promise<number> {
  const now = new Date();
  const ninetyDaysAgo = new Date(now);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  // Fetch event dates, completed plan items, and (when not pre-fetched) the
  // game state row in parallel.
  // Use findMany + select (only createdAt) — groupBy on DateTime doesn't reduce rows.
  const [xpEvents, planItems, gameState] = await Promise.all([
    prisma.xpEvent.findMany({
      where: { userId, createdAt: { gte: ninetyDaysAgo } },
      select: { createdAt: true, action: true, sourceId: true },
    }),
    prisma.studyPlanItem.findMany({
      where: { plan: { userId }, status: "DONE", completedAt: { gte: ninetyDaysAgo } },
      select: { completedAt: true, startTime: true },
    }),
    existingGameState ?? prisma.userGameState.findUnique({ where: { userId } }),
  ]);

  const tz = gameState?.timezone ?? null;

  // Dedupe into calendar dates (day keys in the user's timezone; UTC when null)
  const activeDays = new Set<string>();
  for (const e of xpEvents) {
    // Zero-XP bookkeeping events: a freeze award is not study activity, but a
    // consumed freeze bridges the day it was used (sourceId = bridged date).
    if (e.action === "STREAK_FREEZE_AWARD") continue;
    if (e.action === "STREAK_FREEZE_USED") {
      activeDays.add(e.sourceId ?? dayKey(e.createdAt, tz));
      continue;
    }
    activeDays.add(dayKey(e.createdAt, tz));
  }
  for (const item of planItems) {
    const d = item.completedAt || item.startTime;
    activeDays.add(dayKey(d, tz));
  }

  // Legacy single-date field — kept for rows that predate STREAK_FREEZE_USED events
  if (gameState?.streakFreezeUsedDate) {
    activeDays.add(gameState.streakFreezeUsedDate);
  }

  if (activeDays.size === 0) return 0;

  // Walk backward day-by-day using the SAME day keys as activeDays: subtract
  // 24h from a timestamp and re-key with dayKey. Local-midnight arithmetic
  // would start the walk on the wrong day on servers with a non-zero UTC
  // offset, dropping today's activity.
  const DAY_MS = 86_400_000;
  const todayKey = dayKey(now, tz);
  const [year, month, day] = todayKey.split("-").map(Number);
  // Anchor the cursor mid-day (12:00 UTC of today's key) so 24h steps never
  // skip or repeat a key across DST transitions. For extreme offsets
  // (UTC+13/+14) 12:00 UTC already keys to tomorrow — step back once.
  let cursor = Date.UTC(year, month - 1, day, 12);
  if (dayKey(new Date(cursor), tz) !== todayKey) cursor -= DAY_MS / 2;
  const yesterdayKey = dayKey(new Date(cursor - DAY_MS), tz);

  if (!activeDays.has(todayKey) && !activeDays.has(yesterdayKey)) return 0;

  if (!activeDays.has(todayKey)) cursor -= DAY_MS;

  let streak = 0;
  while (activeDays.has(dayKey(new Date(cursor), tz))) {
    streak++;
    cursor -= DAY_MS;
  }

  return streak;
}

/**
 * Atomically award a streak freeze at 7-day milestones, max 3.
 * Uses updateMany with a condition to prevent race conditions and double awards.
 * Returns the current freeze count after the operation.
 */
async function maybeAwardStreakFreeze(
  userId: string,
  streak: number,
  currentFreezes: number,
): Promise<number> {
  if (streak <= 0 || streak % 7 !== 0 || currentFreezes >= 3) return currentFreezes;

  // Dedupe: getGameState runs this check on every call, so a milestone day
  // would otherwise award once per page load. A zero-XP marker event records
  // that this milestone already granted its freeze.
  const existingAward = await prisma.xpEvent.findFirst({
    where: { userId, action: "STREAK_FREEZE_AWARD", sourceId: String(streak) },
    select: { id: true },
  });
  if (existingAward) return currentFreezes;

  // Atomic conditional update: only increment if still under cap
  const result = await prisma.userGameState.updateMany({
    where: { userId, streakFreezes: { lt: 3 } },
    data: { streakFreezes: { increment: 1 } },
  });

  if (result.count > 0) {
    // Marker event (0 XP) so this milestone can't award again. Created directly
    // rather than via awardXp, which skips zero-amount events.
    await prisma.xpEvent.create({
      data: {
        userId,
        action: "STREAK_FREEZE_AWARD",
        xpAmount: 0,
        sourceId: String(streak),
      },
    });
    logger.info("streak.freeze_earned", { user_id: userId, streak });
    return currentFreezes + 1;
  }
  return currentFreezes;
}

async function checkAndAwardAchievements(
  userId: string,
  existingBadges: Set<string>,
  streak: number,
  totalXp: number,
  reviewCount: number,
): Promise<string[]> {
  if (existingBadges.size >= TOTAL_BADGES) return [];

  const newBadges: string[] = [];

  // Drive all badge checks from the shared ALL_BADGES definitions
  for (const badge of ALL_BADGES) {
    if (existingBadges.has(badge.key)) continue;

    if (badge.category === "streak" && streak >= badge.threshold) {
      newBadges.push(badge.key);
    } else if (badge.category === "xp" && totalXp >= badge.threshold) {
      newBadges.push(badge.key);
    } else if (badge.category === "review") {
      // FIRST_PERFECT requires a separate check (not review count)
      if (badge.key === "FIRST_PERFECT") continue;
      if (reviewCount >= badge.threshold) {
        newBadges.push(badge.key);
      }
    }
  }

  // Perfect deck — only query if badge not yet earned
  if (!existingBadges.has("FIRST_PERFECT")) {
    const hasPerfect = await prisma.xpEvent.count({
      where: { userId, action: "PERFECT_DECK" },
    });
    if (hasPerfect >= 1) newBadges.push("FIRST_PERFECT");
  }

  if (newBadges.length > 0) {
    await prisma.achievement.createMany({
      data: newBadges.map((badge) => ({ userId, badgeType: badge })),
      skipDuplicates: true,
    });
    logger.info("achievements.awarded", { user_id: userId, badges: newBadges });
  }

  return newBadges;
}

async function getOrCreateGameState(userId: string) {
  return prisma.userGameState.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}
