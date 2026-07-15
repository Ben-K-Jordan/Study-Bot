import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getGameState } from "@/services/gamification";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const state = await getGameState(userId);
    return NextResponse.json(state);
  } catch (err) {
    logger.error("stats.game_failed", { userId, error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
