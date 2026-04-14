import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getPlan } from "@/services/plan";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { planId } = await params;

  try {
    const result = await getPlan(userId, planId);

    if ("error" in result) {
      if (result.error === "not_found") {
        return NextResponse.json({ error: "Plan not found" }, { status: 404 });
      }
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json(result.data);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { planId } = await params;

  try {
    const plan = await prisma.studyPlan.findUnique({
      where: { planId },
      select: { userId: true },
    });

    if (!plan || plan.userId !== userId) {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    // Delete in correct order to respect FK constraints
    await prisma.$transaction([
      prisma.planItemExternalEvent.deleteMany({ where: { planId } }),
      prisma.planCalendarPublication.deleteMany({ where: { planId } }),
      prisma.planReflowAudit.deleteMany({ where: { planId } }),
      prisma.studyPlanItem.deleteMany({ where: { planId } }),
      prisma.studyPlan.delete({ where: { planId } }),
    ]);

    logger.info("plan.deleted", { user_id: userId, plan_id: planId });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
