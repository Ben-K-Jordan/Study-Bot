import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { consumeStreakFreeze, type FreezeRefusal } from "@/services/gamification";
import { logger } from "@/lib/logger";

const REFUSALS: Record<FreezeRefusal, { status: number; error: string; code: string }> = {
  no_freezes: { status: 409, error: "You have no streak freezes left.", code: "NO_FREEZES" },
  already_used_today: {
    status: 409,
    error: "A freeze already covers today.",
    code: "FREEZE_ALREADY_USED_TODAY",
  },
  already_active: {
    status: 409,
    error: "You studied today, so your streak is safe without a freeze.",
    code: "ALREADY_STUDIED_TODAY",
  },
};

/**
 * POST /api/stats/streak-freeze: spend one freeze on today. No body.
 * 200 {success: true, freezesRemaining}; 409 {error, code, freezesRemaining}.
 */
export async function POST(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Your sign-in expired. Sign in again." }, { status: 401 });
  }

  try {
    const result = await consumeStreakFreeze(userId);
    if (!result.success) {
      const refusal = REFUSALS[result.reason];
      return NextResponse.json(
        { error: refusal.error, code: refusal.code, freezesRemaining: result.freezesRemaining },
        { status: refusal.status },
      );
    }
    return NextResponse.json({ success: true, freezesRemaining: result.freezesRemaining });
  } catch (err) {
    logger.error("stats.streak_freeze_failed", { userId, error: String(err) });
    return NextResponse.json({ error: "Freeze not used. Retry." }, { status: 500 });
  }
}
