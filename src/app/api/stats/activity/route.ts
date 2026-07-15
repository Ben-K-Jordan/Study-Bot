import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
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
      // Fetch XP event dates — dedupe to calendar days in JS
      prisma.xpEvent.findMany({
        where: { userId, createdAt: { gte: oneYearAgo } },
        select: { createdAt: true },
      }),
      prisma.xpEvent.aggregate({
        where: { userId },
        _sum: { xpAmount: true },
      }),
    ]);

    const dailyCounts = new Map<string, number>();
    for (const item of completedItems) {
      const d = item.completedAt || item.startTime;
      const key = d.toISOString().slice(0, 10);
      dailyCounts.set(key, (dailyCounts.get(key) || 0) + 1);
    }
    // Each XP event marks that day as active
    for (const event of xpEvents) {
      const key = event.createdAt.toISOString().slice(0, 10);
      dailyCounts.set(key, (dailyCounts.get(key) || 0) + 1);
    }

    const activity = Array.from(dailyCounts.entries()).map(([date, count]) => ({
      date,
      count,
    }));

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

    return NextResponse.json({ activity, streak, total_xp: totalXp });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
