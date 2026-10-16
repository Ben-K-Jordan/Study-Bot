import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/http";
import { z } from "zod";
import { getUserId } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { addDays, dayKey } from "@/lib/timezone";
import { getActivityByDay, getGameState } from "@/services/gamification";

const querySchema = z.object({
  /** How many days back, today included. Defaults to a year. */
  days: z.coerce.number().int().min(1).max(400).default(371),
});

/**
 * GET /api/stats/activity: study activity per day in the student's time
 * zone, plus the streak and total XP (the same numbers Progress shows).
 *
 * activity[].count is what the day holds: sessions + card reviews. Each part
 * is also given on its own. Guides and chat earn no XP and aren't counted.
 */
export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return unauthorized();
  }

  const parsed = querySchema.safeParse({
    days: request.nextUrl.searchParams.get("days") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Choose a number of days from 1 to 400.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const game = await getGameState(userId);
    const todayKey = dayKey(new Date(), game.timeZone);
    const sinceKey = addDays(todayKey, -(parsed.data.days - 1));
    const days = await getActivityByDay(userId, game.timeZone, sinceKey);

    const activity = [...days.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, d]) => ({
        date,
        count: d.sessions + d.reviews,
        sessions: d.sessions,
        reviews: d.reviews,
        freeze_used: d.freezeUsed,
        xp: d.xp,
      }));

    return NextResponse.json({
      activity,
      streak: game.streak,
      total_xp: game.xpTotal,
      time_zone: game.timeZone,
    });
  } catch (err) {
    logger.error("stats.activity_failed", { userId, error: String(err) });
    return NextResponse.json({ error: "Activity didn't load. Retry." }, { status: 500 });
  }
}

