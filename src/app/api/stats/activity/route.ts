import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/stats/activity
 * Returns daily study activity for the past year (for heatmap),
 * current streak, and total XP.
 * Merges data from completed plan items + XP events.
 */
export async function GET(request: NextRequest) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const oneYearAgo = new Date(now);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  oneYearAgo.setHours(0, 0, 0, 0);

  // Get completed plan items + XP events in parallel
  const [completedItems, xpEvents, xpTotal] = await Promise.all([
    prisma.studyPlanItem.findMany({
      where: {
        plan: { userId },
        status: "DONE",
        completedAt: { gte: oneYearAgo },
      },
      select: { completedAt: true, startTime: true },
      orderBy: { completedAt: "asc" },
    }),
    prisma.xpEvent.findMany({
      where: { userId, createdAt: { gte: oneYearAgo } },
      select: { createdAt: true },
    }),
    prisma.xpEvent.aggregate({
      where: { userId },
      _sum: { xpAmount: true },
    }),
  ]);

  // Build daily counts map (merge both sources)
  const dailyCounts = new Map<string, number>();
  for (const item of completedItems) {
    const d = item.completedAt || item.startTime;
    const key = d.toISOString().slice(0, 10);
    dailyCounts.set(key, (dailyCounts.get(key) || 0) + 1);
  }
  for (const event of xpEvents) {
    const key = event.createdAt.toISOString().slice(0, 10);
    if (!dailyCounts.has(key)) {
      dailyCounts.set(key, 1);
    }
  }

  const activity = Array.from(dailyCounts.entries()).map(([date, count]) => ({
    date,
    count,
  }));

  // Compute streak
  const todayKey = now.toISOString().slice(0, 10);
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayKey = yesterdayDate.toISOString().slice(0, 10);

  let streak = 0;
  const check = new Date(now);
  check.setHours(0, 0, 0, 0);

  if (!dailyCounts.has(todayKey)) {
    if (!dailyCounts.has(yesterdayKey)) {
      streak = 0;
    } else {
      check.setDate(check.getDate() - 1);
    }
  }

  if (streak === 0 && (dailyCounts.has(todayKey) || dailyCounts.has(yesterdayKey))) {
    const d = new Date(check);
    while (dailyCounts.has(d.toISOString().slice(0, 10))) {
      streak++;
      d.setDate(d.getDate() - 1);
    }
  }

  // Total XP from XP events; fallback to completed item count for legacy data
  const xpFromEvents = xpTotal._sum.xpAmount || 0;
  const totalXp = xpFromEvents > 0
    ? xpFromEvents
    : await prisma.studyPlanItem.count({
        where: { plan: { userId }, status: "DONE" },
      });

  return NextResponse.json({
    activity,
    streak,
    total_xp: totalXp,
    today_count: dailyCounts.get(todayKey) || 0,
  });
}
