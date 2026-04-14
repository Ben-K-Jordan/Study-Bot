import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { TOTAL_BADGES, ALL_BADGES } from "@/lib/badge-data";

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
  const todayStr = new Date().toISOString().slice(0, 10);

  // Atomic conditional update: only decrement if freezes > 0 and not already used today
  const result = await prisma.userGameState.updateMany({
    where: { userId, streakFreezes: { gt: 0 }, streakFreezeUsedDate: { not: todayStr } },
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
 */
export async function computeStreak(
  userId: string,
  existingGameState?: { streakFreezeUsedDate: string | null; streakFreezes: number } | null,
): Promise<number> {
  const now = new Date();
  const ninetyDaysAgo = new Date(now);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  // Fetch event dates and completed plan items in parallel.
  // Use findMany + select (only createdAt) — groupBy on DateTime doesn't reduce rows.
  const [xpEvents, planItems] = await Promise.all([
    prisma.xpEvent.findMany({
      where: { userId, createdAt: { gte: ninetyDaysAgo } },
      select: { createdAt: true },
    }),
    prisma.studyPlanItem.findMany({
      where: { plan: { userId }, status: "DONE", completedAt: { gte: ninetyDaysAgo } },
      select: { completedAt: true, startTime: true },
    }),
  ]);

  // Dedupe into calendar dates
  const activeDays = new Set<string>();
  for (const e of xpEvents) activeDays.add(e.createdAt.toISOString().slice(0, 10));
  for (const item of planItems) {
    const d = item.completedAt || item.startTime;
    activeDays.add(d.toISOString().slice(0, 10));
  }

  const gameState = existingGameState ?? await prisma.userGameState.findUnique({ where: { userId } });
  if (gameState?.streakFreezeUsedDate) {
    activeDays.add(gameState.streakFreezeUsedDate);
  }

  if (activeDays.size === 0) return 0;

  const todayKey = now.toISOString().slice(0, 10);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = yesterday.toISOString().slice(0, 10);

  if (!activeDays.has(todayKey) && !activeDays.has(yesterdayKey)) return 0;

  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (!activeDays.has(todayKey)) d.setDate(d.getDate() - 1);

  let streak = 0;
  while (activeDays.has(d.toISOString().slice(0, 10))) {
    streak++;
    d.setDate(d.getDate() - 1);
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

  // Atomic conditional update: only increment if still under cap
  const result = await prisma.userGameState.updateMany({
    where: { userId, streakFreezes: { lt: 3 } },
    data: { streakFreezes: { increment: 1 } },
  });

  if (result.count > 0) {
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
