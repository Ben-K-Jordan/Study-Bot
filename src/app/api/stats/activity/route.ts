import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const oneYearAgo = new Date(now);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  oneYearAgo.setHours(0, 0, 0, 0);

  const [completedItems, xpEvents, xpTotal] = await Promise.all([
    prisma.studyPlanItem.findMany({
      where: {
        plan: { userId },
        status: "DONE",
        completedAt: { gte: oneYearAgo },
      },
      select: { completedAt: true, startTime: true },
    }),
    // Use groupBy on createdAt to get distinct active dates with counts
    prisma.xpEvent.groupBy({
      by: ["createdAt"],
      where: { userId, createdAt: { gte: oneYearAgo } },
      _count: { id: true },
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
    // XP events contribute at least 1 to the count for that day
    if (!dailyCounts.has(key)) {
      dailyCounts.set(key, 1);
    }
  }

  const activity = Array.from(dailyCounts.entries()).map(([date, count]) => ({
    date,
    count,
  }));

  // Compute streak from daily counts
  const todayKey = now.toISOString().slice(0, 10);
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayKey = yesterdayDate.toISOString().slice(0, 10);

  let streak = 0;
  const check = new Date(now);
  check.setHours(0, 0, 0, 0);

  if (dailyCounts.has(todayKey) || dailyCounts.has(yesterdayKey)) {
    if (!dailyCounts.has(todayKey)) check.setDate(check.getDate() - 1);
    const d = new Date(check);
    while (dailyCounts.has(d.toISOString().slice(0, 10))) {
      streak++;
      d.setDate(d.getDate() - 1);
    }
  }

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
  });
}
