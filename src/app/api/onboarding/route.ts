import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/onboarding — check if user has completed onboarding.
 */
export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const state = await prisma.userGameState.findUnique({
      where: { userId },
      select: { onboardingComplete: true },
    });

    return NextResponse.json({
      complete: state?.onboardingComplete ?? false,
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/onboarding — mark onboarding as complete.
 */
export async function POST(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await prisma.userGameState.upsert({
      where: { userId },
      create: { userId, onboardingComplete: true },
      update: { onboardingComplete: true },
    });

    return NextResponse.json({ complete: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
