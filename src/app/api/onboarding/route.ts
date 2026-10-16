import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * GET /api/onboarding: whether the student finished onboarding.
 *
 * Home no longer opens an onboarding dialog: a student with no plan and no
 * materials sees the first-run panel instead. The flag stays for API clients.
 */
export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Your sign-in expired. Sign in again." }, { status: 401 });
  }

  try {
    const state = await prisma.userGameState.findUnique({
      where: { userId },
      select: { onboardingComplete: true },
    });

    return NextResponse.json({
      complete: state?.onboardingComplete ?? false,
    });
  } catch (err) {
    logger.error("onboarding.read_failed", { userId, error: String(err) });
    return NextResponse.json({ error: "Onboarding status didn't load. Retry." }, { status: 500 });
  }
}

/**
 * POST /api/onboarding: mark onboarding as finished. No body.
 */
export async function POST(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Your sign-in expired. Sign in again." }, { status: 401 });
  }

  try {
    await prisma.userGameState.upsert({
      where: { userId },
      create: { userId, onboardingComplete: true },
      update: { onboardingComplete: true },
    });

    return NextResponse.json({ complete: true });
  } catch (err) {
    logger.error("onboarding.write_failed", { userId, error: String(err) });
    return NextResponse.json({ error: "Onboarding status not saved. Retry." }, { status: 500 });
  }
}
