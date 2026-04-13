import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/stats/activity
 * Returns daily study activity for the past year (for heatmap),
 * current streak, and total XP (1 XP per completed session).
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

  // Get all completed plan items in the past year
  const completedItems = await prisma.studyPlanItem.findMany({
    where: {
      plan: { userId },
      status: "DONE",
      completedAt: { gte: oneYearAgo },
    },
    select: {
      completedAt: true,
      startTime: true,
    },
    orderBy: { completedAt: "asc" },
  });

  // Build daily counts map
  const dailyCounts = new Map<string, number>();
  for (const item of completedItems) {
    const d = item.completedAt || item.startTime;
    const key = d.toISOString().slice(0, 10); // YYYY-MM-DD
    dailyCounts.set(key, (dailyCounts.get(key) || 0) + 1);
  }

  // Convert to array
  const activity = Array.from(dailyCounts.entries()).map(([date, count]) => ({
    date,
    count,
  }));

  // Compute streak (consecutive days ending today or yesterday)
  const todayKey = now.toISOString().slice(0, 10);
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayKey = yesterdayDate.toISOString().slice(0, 10);

  let streak = 0;
  const check = new Date(now);
  check.setHours(0, 0, 0, 0);

  // If no activity today, start checking from yesterday
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

  // Total XP = total completed sessions all time
  const totalXp = await prisma.studyPlanItem.count({
    where: {
      plan: { userId },
      status: "DONE",
    },
  });

  return NextResponse.json({
    activity,
    streak,
    total_xp: totalXp,
    today_count: dailyCounts.get(todayKey) || 0,
  });
}
