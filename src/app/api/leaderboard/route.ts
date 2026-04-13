import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/leaderboard
 * Returns weekly XP leaderboard — top users by XP earned this week.
 * Query param: period=week|month|all (default: week)
 */
export async function GET(request: NextRequest) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") || "week";

  // Compute start date based on period
  const now = new Date();
  let since: Date;
  if (period === "month") {
    since = new Date(now);
    since.setDate(since.getDate() - 30);
    since.setHours(0, 0, 0, 0);
  } else if (period === "all") {
    since = new Date(0); // epoch
  } else {
    // week — start from last Monday
    since = new Date(now);
    const dayOfWeek = since.getDay();
    const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    since.setDate(since.getDate() - daysSinceMonday);
    since.setHours(0, 0, 0, 0);
  }

  // Aggregate XP by user for the period
  const xpByUser = await prisma.xpEvent.groupBy({
    by: ["userId"],
    where: { createdAt: { gte: since } },
    _sum: { xpAmount: true },
    orderBy: { _sum: { xpAmount: "desc" } },
    take: 20,
  });

  if (xpByUser.length === 0) {
    return NextResponse.json({ leaderboard: [], period, userRank: null });
  }

  // Fetch display names for these users
  const userIds = xpByUser.map((u) => u.userId);
  const gameStates = await prisma.userGameState.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, displayName: true },
  });
  const nameMap = new Map(gameStates.map((g) => [g.userId, g.displayName]));

  const leaderboard = xpByUser.map((entry, i) => ({
    rank: i + 1,
    userId: entry.userId,
    displayName: nameMap.get(entry.userId) || anonymizeName(entry.userId),
    xp: entry._sum.xpAmount || 0,
    isCurrentUser: entry.userId === userId,
  }));

  // Find current user's rank if not in top 20
  let userRank = leaderboard.find((e) => e.isCurrentUser)?.rank ?? null;
  if (userRank === null) {
    const userXp = await prisma.xpEvent.aggregate({
      where: { userId, createdAt: { gte: since } },
      _sum: { xpAmount: true },
    });
    const userTotal = userXp._sum.xpAmount || 0;
    if (userTotal > 0) {
      const countAbove = await prisma.xpEvent.groupBy({
        by: ["userId"],
        where: { createdAt: { gte: since } },
        _sum: { xpAmount: true },
        having: { xpAmount: { _sum: { gt: userTotal } } },
      });
      userRank = countAbove.length + 1;
    }
  }

  return NextResponse.json({ leaderboard, period, userRank });
}

/**
 * Generate an anonymous display name from userId.
 */
function anonymizeName(userId: string): string {
  const adjectives = ["Eager", "Bright", "Swift", "Keen", "Bold", "Sharp", "Calm", "Wise"];
  const nouns = ["Scholar", "Learner", "Student", "Thinker", "Reader", "Writer", "Seeker", "Explorer"];
  // Simple hash from userId
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  }
  const adj = adjectives[Math.abs(hash) % adjectives.length];
  const noun = nouns[Math.abs(hash >> 8) % nouns.length];
  return `${adj} ${noun}`;
}
