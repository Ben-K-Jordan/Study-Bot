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

  // Award streak freeze as an explicit write (not a side-effect of reads)
  await maybeAwardStreakFreeze(userId, streak);

  const existingBadges = new Set(achievements.map((a) => a.badgeType));
  const totalXp = xpTotalResult._sum.xpAmount || 0;
  const newAchievements = await checkAndAwardAchievements(userId, existingBadges, streak, totalXp, reviewCount);

  // Merge newly awarded badges inline instead of re-fetching
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
    streakFreezes: gameState.streakFreezes,
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
  const state = await getOrCreateGameState(userId);
  if (state.streakFreezes <= 0) {
    return { success: false, freezesRemaining: 0 };
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  if (state.streakFreezeUsedDate === todayStr) {
    return { success: false, freezesRemaining: state.streakFreezes };
  }

  const updated = await prisma.userGameState.update({
    where: { userId },
    data: {
      streakFreezes: { decrement: 1 },
      streakFreezeUsedDate: todayStr,
    },
  });

  logger.info("streak.freeze_used", { user_id: userId, remaining: updated.streakFreezes });
  return { success: true, freezesRemaining: updated.streakFreezes };
}

/**
 * Compute current streak using groupBy for dates instead of fetching all rows.
 * Accepts pre-fetched gameState to avoid redundant DB read.
 */
export async function computeStreak(
  userId: string,
  existingGameState?: { streakFreezeUsedDate: string | null; streakFreezes: number } | null,
): Promise<number> {
  const now = new Date();
  const ninetyDaysAgo = new Date(now);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  // Use groupBy to get distinct active dates instead of fetching all rows
  const [xpDays, planDays] = await Promise.all([
    prisma.xpEvent.groupBy({
      by: ["createdAt"],
      where: { userId, createdAt: { gte: ninetyDaysAgo } },
      _min: { createdAt: true },
    }).then((rows) => {
      // groupBy on createdAt gives per-event rows; use raw dates and dedupe
      const dates = new Set<string>();
      for (const r of rows) dates.add(r.createdAt.toISOString().slice(0, 10));
      return dates;
    }),
    prisma.studyPlanItem.findMany({
      where: { plan: { userId }, status: "DONE", completedAt: { gte: ninetyDaysAgo } },
      select: { completedAt: true, startTime: true },
      distinct: ["completedAt"],
    }),
  ]);

  const activeDays = new Set(xpDays);
  for (const item of planDays) {
    const d = item.completedAt || item.startTime;
    activeDays.add(d.toISOString().slice(0, 10));
  }

  // Include streak freeze date
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
 * Award streak freeze (called separately, not as read side-effect).
 */
export async function maybeAwardStreakFreeze(userId: string, streak: number): Promise<void> {
  if (streak <= 0 || streak % 7 !== 0) return;
  const state = await prisma.userGameState.findUnique({
    where: { userId },
    select: { streakFreezes: true },
  });
  if (!state || state.streakFreezes >= 3) return;
  await prisma.userGameState.update({
    where: { userId },
    data: { streakFreezes: { increment: 1 } },
  });
  logger.info("streak.freeze_earned", { user_id: userId, streak });
}

async function checkAndAwardAchievements(
  userId: string,
  existingBadges: Set<string>,
  streak: number,
  totalXp: number,
  reviewCount: number,
): Promise<string[]> {
  // Short-circuit: all badges already earned
  if (existingBadges.size >= TOTAL_BADGES) return [];

  const newBadges: string[] = [];

  // Derive streak thresholds from shared badge data
  for (const badge of ALL_BADGES) {
    if (existingBadges.has(badge.key)) continue;
    if (badge.category === "streak" && streak >= badge.threshold) {
      newBadges.push(badge.key);
    }
  }

  // XP achievements
  if (totalXp >= 100 && !existingBadges.has("XP_100")) newBadges.push("XP_100");
  if (totalXp >= 1000 && !existingBadges.has("XP_1000")) newBadges.push("XP_1000");

  // Review count achievements (reviewCount already fetched in getGameState)
  if (reviewCount >= 1 && !existingBadges.has("FIRST_REVIEW")) newBadges.push("FIRST_REVIEW");
  if (reviewCount >= 100 && !existingBadges.has("REVIEWS_100")) newBadges.push("REVIEWS_100");
  if (reviewCount >= 500 && !existingBadges.has("REVIEWS_500")) newBadges.push("REVIEWS_500");

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
