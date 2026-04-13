/**
 * Gamification Service
 *
 * Manages XP awards, achievements, streak tracking, and streak freezes.
 */

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

// XP amounts per action
export const XP_AMOUNTS: Record<string, number> = {
  FLASHCARD_REVIEW: 2,
  GUIDE_GENERATED: 5,
  CHAT_QUESTION: 1,
  SESSION_COMPLETED: 10,
  PERFECT_DECK: 3,
  STREAK_MILESTONE: 0, // Just a marker, XP varies
};

// Achievement definitions
export const ACHIEVEMENTS = {
  // Streak milestones
  STREAK_3:   { label: "Getting Started",   description: "3-day study streak",     icon: "🔥", threshold: 3 },
  STREAK_7:   { label: "Week Warrior",       description: "7-day study streak",     icon: "⚡", threshold: 7 },
  STREAK_14:  { label: "Two-Week Titan",     description: "14-day study streak",    icon: "💪", threshold: 14 },
  STREAK_30:  { label: "Monthly Master",     description: "30-day study streak",    icon: "🏆", threshold: 30 },
  STREAK_60:  { label: "Dedicated Scholar",  description: "60-day study streak",    icon: "🎓", threshold: 60 },
  STREAK_100: { label: "Century Club",       description: "100-day study streak",   icon: "💎", threshold: 100 },
  // Activity milestones
  FIRST_REVIEW:   { label: "First Steps",       description: "Review your first flashcard",  icon: "📖", threshold: 1 },
  REVIEWS_100:    { label: "Card Shark",         description: "Review 100 flashcards",        icon: "🃏", threshold: 100 },
  REVIEWS_500:    { label: "Flashcard Fiend",    description: "Review 500 flashcards",        icon: "🧠", threshold: 500 },
  FIRST_PERFECT:  { label: "Perfect Score",      description: "Complete a deck perfectly",    icon: "⭐", threshold: 1 },
  XP_100:         { label: "XP Centurion",       description: "Earn 100 total XP",            icon: "💯", threshold: 100 },
  XP_1000:        { label: "XP Master",          description: "Earn 1,000 total XP",          icon: "🌟", threshold: 1000 },
} as const;

export type BadgeType = keyof typeof ACHIEVEMENTS;

/**
 * Award XP for an action. Returns the XP event created.
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
  return { id: event.id, xpAmount: amount };
}

/**
 * Get full game state for a user: XP today, XP total, daily goal, streak, freezes, achievements.
 */
export async function getGameState(userId: string): Promise<{
  xpToday: number;
  xpTotal: number;
  dailyXpGoal: number;
  streak: number;
  streakFreezes: number;
  achievements: { badgeType: string; earnedAt: string }[];
  newAchievements: string[]; // badges just earned this call
}> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Fetch data in parallel
  const [xpTodayResult, xpTotalResult, gameState, achievements, streak] = await Promise.all([
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
    computeStreak(userId),
  ]);

  // Check for new achievements
  const existingBadges = new Set(achievements.map((a) => a.badgeType));
  const newAchievements = await checkAndAwardAchievements(userId, existingBadges, streak, xpTotalResult._sum.xpAmount || 0);

  // Fetch updated achievements if new ones were awarded
  const allAchievements = newAchievements.length > 0
    ? await prisma.achievement.findMany({ where: { userId }, orderBy: { earnedAt: "desc" } })
    : achievements;

  return {
    xpToday: xpTodayResult._sum.xpAmount || 0,
    xpTotal: xpTotalResult._sum.xpAmount || 0,
    dailyXpGoal: gameState.dailyXpGoal,
    streak,
    streakFreezes: gameState.streakFreezes,
    achievements: allAchievements.map((a) => ({
      badgeType: a.badgeType,
      earnedAt: a.earnedAt.toISOString(),
    })),
    newAchievements,
  };
}

/**
 * Update daily XP goal.
 */
export async function setDailyXpGoal(userId: string, goal: number): Promise<void> {
  const clamped = Math.max(10, Math.min(500, goal));
  await getOrCreateGameState(userId);
  await prisma.userGameState.update({
    where: { userId },
    data: { dailyXpGoal: clamped },
  });
}

/**
 * Use a streak freeze. Returns true if successful.
 */
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
 * Compute current streak from XP events (days with any XP activity).
 * A streak freeze date counts as an active day.
 */
export async function computeStreak(userId: string): Promise<number> {
  const now = new Date();
  const oneYearAgo = new Date(now);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  // Get all XP events grouped by day
  const events = await prisma.xpEvent.findMany({
    where: { userId, createdAt: { gte: oneYearAgo } },
    select: { createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const activeDays = new Set<string>();
  for (const e of events) {
    activeDays.add(e.createdAt.toISOString().slice(0, 10));
  }

  // Also count streak freeze dates
  const gameState = await prisma.userGameState.findUnique({ where: { userId } });
  if (gameState?.streakFreezeUsedDate) {
    activeDays.add(gameState.streakFreezeUsedDate);
  }

  // Also consider legacy: completed plan items (for users who had activity before XP system)
  const completedItems = await prisma.studyPlanItem.findMany({
    where: { plan: { userId }, status: "DONE", completedAt: { gte: oneYearAgo } },
    select: { completedAt: true, startTime: true },
  });
  for (const item of completedItems) {
    const d = item.completedAt || item.startTime;
    activeDays.add(d.toISOString().slice(0, 10));
  }

  if (activeDays.size === 0) return 0;

  const todayKey = now.toISOString().slice(0, 10);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = yesterday.toISOString().slice(0, 10);

  let streak = 0;
  const check = new Date(now);
  check.setHours(0, 0, 0, 0);

  // Start from today or yesterday
  if (!activeDays.has(todayKey)) {
    if (!activeDays.has(yesterdayKey)) return 0;
    check.setDate(check.getDate() - 1);
  }

  const d = new Date(check);
  while (activeDays.has(d.toISOString().slice(0, 10))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }

  // Award streak freeze every 7 days
  if (streak > 0 && streak % 7 === 0 && gameState) {
    const maxFreezes = 3;
    if (gameState.streakFreezes < maxFreezes) {
      await prisma.userGameState.update({
        where: { userId },
        data: { streakFreezes: { increment: 1 } },
      });
      logger.info("streak.freeze_earned", { user_id: userId, streak });
    }
  }

  return streak;
}

/**
 * Check and award any new achievements based on current state.
 */
async function checkAndAwardAchievements(
  userId: string,
  existingBadges: Set<string>,
  streak: number,
  totalXp: number,
): Promise<string[]> {
  const newBadges: string[] = [];

  // Streak achievements
  const streakBadges: [BadgeType, number][] = [
    ["STREAK_3", 3], ["STREAK_7", 7], ["STREAK_14", 14],
    ["STREAK_30", 30], ["STREAK_60", 60], ["STREAK_100", 100],
  ];
  for (const [badge, threshold] of streakBadges) {
    if (streak >= threshold && !existingBadges.has(badge)) {
      newBadges.push(badge);
    }
  }

  // XP achievements
  if (totalXp >= 100 && !existingBadges.has("XP_100")) newBadges.push("XP_100");
  if (totalXp >= 1000 && !existingBadges.has("XP_1000")) newBadges.push("XP_1000");

  // Review count achievements
  const reviewCount = await prisma.cardReview.count({ where: { userId } });
  if (reviewCount >= 1 && !existingBadges.has("FIRST_REVIEW")) newBadges.push("FIRST_REVIEW");
  if (reviewCount >= 100 && !existingBadges.has("REVIEWS_100")) newBadges.push("REVIEWS_100");
  if (reviewCount >= 500 && !existingBadges.has("REVIEWS_500")) newBadges.push("REVIEWS_500");

  // Perfect deck achievement
  const perfectDeckXp = await prisma.xpEvent.count({
    where: { userId, action: "PERFECT_DECK" },
  });
  if (perfectDeckXp >= 1 && !existingBadges.has("FIRST_PERFECT")) newBadges.push("FIRST_PERFECT");

  // Persist new achievements
  if (newBadges.length > 0) {
    await prisma.achievement.createMany({
      data: newBadges.map((badge) => ({ userId, badgeType: badge })),
      skipDuplicates: true,
    });
    logger.info("achievements.awarded", { user_id: userId, badges: newBadges });
  }

  return newBadges;
}

/**
 * Get or create user game state.
 */
async function getOrCreateGameState(userId: string) {
  let state = await prisma.userGameState.findUnique({ where: { userId } });
  if (!state) {
    state = await prisma.userGameState.create({
      data: { userId },
    });
  }
  return state;
}
