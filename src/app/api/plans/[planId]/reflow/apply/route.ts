import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { computeReflow, ReflowItem, ReflowConfig, ReflowChange } from "@/services/reflow";
import { logger } from "@/lib/logger";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ planId: string }> },
) {
  const userId = req.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ error: "Missing X-User-Id header" }, { status: 401 });
  }

  const { planId } = await params;

  // Parse optional body
  let reason = "MANUAL";
  let republish = false;
  try {
    const body = await req.json();
    if (body.reason) reason = body.reason;
    if (body.republish === true) republish = true;
  } catch {
    // No body is fine
  }

  const plan = await prisma.studyPlan.findUnique({
    where: { planId },
    include: { items: { orderBy: [{ dayIndex: "asc" }, { startTime: "asc" }] } },
  });

  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  if (plan.userId !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Load sessions for mode info
  const sessionIds = plan.items.map((i) => i.sessionId);
  const sessions = await prisma.session.findMany({
    where: { sessionId: { in: sessionIds } },
  });
  const sessionMap = new Map(sessions.map((s) => [s.sessionId, s]));

  // Build reflow items
  const reflowItems: ReflowItem[] = plan.items.map((item) => {
    const session = sessionMap.get(item.sessionId);
    return {
      id: item.id,
      sessionId: item.sessionId,
      dayIndex: item.dayIndex,
      startTime: item.startTime,
      endTime: item.endTime,
      status: item.status,
      locked: item.locked,
      mode: session?.mode ?? "RETRIEVAL",
      plannedMinutes: session?.plannedMinutes ?? 60,
    };
  });

  const config = plan.config as Record<string, unknown>;
  const reflowConfig: ReflowConfig = {
    availability: (config.availability as { start: string; end: string }[]) ??
      Array.from({ length: 7 }, () => ({ start: "09:00", end: "17:00" })),
    daily_study_cap_minutes: (config.daily_study_cap_minutes as number) ?? 180,
  };

  const now = new Date();
  const result = computeReflow(reflowItems, reflowConfig, plan.startDate, now);

  // Apply changes in a transaction
  const movedChanges = result.changes.filter((c) => c.action === "MOVED");
  const droppedChanges = result.changes.filter((c) => c.action === "DROPPED");

  if (movedChanges.length === 0 && droppedChanges.length === 0) {
    return NextResponse.json({
      plan_id: planId,
      applied: false,
      message: "No changes needed",
      changes: result.changes,
      warnings: result.warnings,
    });
  }

  await prisma.$transaction(async (tx) => {
    // Apply MOVED items
    for (const change of movedChanges) {
      const item = plan.items.find((i) => i.id === change.itemId)!;
      await tx.studyPlanItem.update({
        where: { id: change.itemId },
        data: {
          dayIndex: change.after!.dayIndex,
          startTime: new Date(change.after!.startTime),
          endTime: new Date(change.after!.endTime),
          lastRescheduledAt: now,
          // Save original position if not already saved
          originalStartAt: item.originalStartAt ?? item.startTime,
          originalEndAt: item.originalEndAt ?? item.endTime,
        },
      });
    }

    // Mark DROPPED items as SKIPPED
    for (const change of droppedChanges) {
      const item = plan.items.find((i) => i.id === change.itemId)!;
      await tx.studyPlanItem.update({
        where: { id: change.itemId },
        data: {
          status: "SKIPPED",
          lastRescheduledAt: now,
          originalStartAt: item.originalStartAt ?? item.startTime,
          originalEndAt: item.originalEndAt ?? item.endTime,
        },
      });
    }

    // Create audit record
    await tx.planReflowAudit.create({
      data: {
        userId,
        planId,
        reason,
        algorithmVersion: result.algorithmVersion,
        inputSummary: {
          totalItems: plan.items.length,
          movableCount: reflowItems.filter((i) =>
            i.status === "SCHEDULED" && !i.locked && i.endTime.getTime() > now.getTime()
          ).length,
          fixedCount: reflowItems.length - movedChanges.length - droppedChanges.length,
        },
        changes: JSON.parse(JSON.stringify(result.changes)),
      },
    });
  });

  logger.info("reflow.applied", {
    user_id: userId,
    plan_id: planId,
    moved: movedChanges.length,
    dropped: droppedChanges.length,
    reason,
  });

  // Optionally trigger republish
  let republishResult = null;
  if (republish) {
    try {
      const { publishPlanToGoogle } = await import("@/services/publish");
      republishResult = await publishPlanToGoogle(userId, planId);
    } catch (err) {
      logger.error("reflow.republish_failed", { plan_id: planId, error: String(err) });
      republishResult = { error: String(err) };
    }
  }

  return NextResponse.json({
    plan_id: planId,
    applied: true,
    changes: result.changes,
    warnings: result.warnings,
    summary: {
      moved: movedChanges.length,
      kept: result.changes.filter((c) => c.action === "KEPT").length,
      dropped: droppedChanges.length,
    },
    republish: republishResult,
  });
}
