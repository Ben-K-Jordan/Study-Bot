import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/onboarding — check if user has completed onboarding.
 */
export async function GET(request: NextRequest) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const state = await prisma.userGameState.findUnique({
    where: { userId },
    select: { onboardingComplete: true },
  });

  // If no state exists yet, user hasn't onboarded
  return NextResponse.json({
    complete: state?.onboardingComplete ?? false,
  });
}

/**
 * POST /api/onboarding — mark onboarding as complete.
 */
export async function POST(request: NextRequest) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.userGameState.upsert({
    where: { userId },
    create: { userId, onboardingComplete: true },
    update: { onboardingComplete: true },
  });

  return NextResponse.json({ complete: true });
}
