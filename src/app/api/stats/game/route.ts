import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/http";
import { getUserId } from "@/lib/auth";
import { getGameState } from "@/services/gamification";
import { logger } from "@/lib/logger";

/**
 * GET /api/stats/game: streak, XP, freezes and achievements. Read-only;
 * achievements are awarded when XP is earned, never here, so
 * `newAchievements` is always empty.
 */
export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return unauthorized();
  }

  try {
    const state = await getGameState(userId);
    return NextResponse.json(state);
  } catch (err) {
    logger.error("stats.game_failed", { userId, error: String(err) });
    return NextResponse.json({ error: "Progress didn't load. Retry." }, { status: 500 });
  }
}
