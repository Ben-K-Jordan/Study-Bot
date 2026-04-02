import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { computeReflow, ReflowItem, ReflowConfig } from "@/services/reflow";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ planId: string }> },
) {
  const userId = req.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ error: "Missing X-User-Id header" }, { status: 401 });
  }

  const { planId } = await params;

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

  // Parse optional reason from body
  let reason = "MANUAL";
  try {
    const body = await req.json();
    if (body.reason) reason = body.reason;
  } catch {
    // No body is fine
  }

  const result = computeReflow(reflowItems, reflowConfig, plan.startDate, new Date());

  return NextResponse.json({
    plan_id: planId,
    reason,
    algorithm_version: result.algorithmVersion,
    changes: result.changes,
    warnings: result.warnings,
    summary: {
      total_items: plan.items.length,
      moved: result.changes.filter((c) => c.action === "MOVED").length,
      kept: result.changes.filter((c) => c.action === "KEPT").length,
      dropped: result.changes.filter((c) => c.action === "DROPPED").length,
    },
  });
}
