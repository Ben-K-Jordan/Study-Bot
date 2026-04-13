import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { consumeStreakFreeze } from "@/services/gamification";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await consumeStreakFreeze(userId);
    if (!result.success) {
      return NextResponse.json(
        { error: "No streak freezes available", freezesRemaining: result.freezesRemaining },
        { status: 400 },
      );
    }
    return NextResponse.json({ success: true, freezesRemaining: result.freezesRemaining });
  } catch (err) {
    logger.error("stats.streak_freeze_failed", { userId, error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
