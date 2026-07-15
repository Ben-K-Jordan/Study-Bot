import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * GET /api/settings — fetch user preferences (synced to backend).
 */
export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let state = await prisma.userGameState.findUnique({ where: { userId } });
  if (!state) {
    state = await prisma.userGameState.create({ data: { userId } });
  }

  return NextResponse.json({
    displayName: state.displayName,
    studyStart: state.studyStartTime,
    studyEnd: state.studyEndTime,
    dailyCap: state.dailyStudyCap,
    dailyXpGoal: state.dailyXpGoal,
    leaderboardVisible: state.leaderboardVisible,
  });
}

const updateSchema = z.object({
  displayName: z.string().max(50).optional(),
  studyStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  studyEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  dailyCap: z.number().int().min(30).max(480).optional(),
  dailyXpGoal: z.number().int().min(10).max(500).optional(),
  leaderboardVisible: z.boolean().optional(),
});

/**
 * PUT /api/settings — update user preferences.
 */
export async function PUT(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const updateData: Record<string, unknown> = {};
  if (data.displayName !== undefined) updateData.displayName = data.displayName || null;
  if (data.studyStart !== undefined) updateData.studyStartTime = data.studyStart;
  if (data.studyEnd !== undefined) updateData.studyEndTime = data.studyEnd;
  if (data.dailyCap !== undefined) updateData.dailyStudyCap = data.dailyCap;
  if (data.dailyXpGoal !== undefined) updateData.dailyXpGoal = data.dailyXpGoal;
  if (data.leaderboardVisible !== undefined) updateData.leaderboardVisible = data.leaderboardVisible;

  try {
    const state = await prisma.userGameState.upsert({
      where: { userId },
      update: updateData,
      create: {
        userId,
        ...updateData,
      },
    });

    logger.info("settings.updated", { user_id: userId, fields: Object.keys(updateData) });

    return NextResponse.json({
      displayName: state.displayName,
      studyStart: state.studyStartTime,
      studyEnd: state.studyEndTime,
      dailyCap: state.dailyStudyCap,
      dailyXpGoal: state.dailyXpGoal,
      leaderboardVisible: state.leaderboardVisible,
    });
  } catch (err) {
    logger.error("settings.update_failed", { userId, error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
