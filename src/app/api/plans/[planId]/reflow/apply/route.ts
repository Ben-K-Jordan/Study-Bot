import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { computeReflow, ReflowItem, ReflowConfig } from "@/services/reflow";
import { z } from "zod/v4";
import { getGoogleClient, GoogleReconnectError, type BusyInterval } from "@/lib/google/calendar-client";
import { type TimeInterval } from "@/lib/google/free-slots";
import { logger } from "@/lib/logger";

const applySchema = z.object({
  reason: z.string().optional().default("MANUAL"),
  from_time: z.string().optional(),
  only_future: z.boolean().optional().default(true),
  respect_google_busy: z.boolean().optional().default(true),
  calendar_ids: z.array(z.string()).optional(),
  buffer_minutes: z.number().min(0).max(60).optional().default(10),
  calendar_update: z.enum(["NONE", "REPUBLISH"]).optional().default("REPUBLISH"),
  // Legacy compat
  republish: z.boolean().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ planId: string }> },
) {
  const userId = await getUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { planId } = await params;

  // Parse body
  let body: z.infer<typeof applySchema>;
  try {
    const raw = await req.json().catch(() => ({}));
    body = applySchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Validation error", details: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Resolve calendar_update from legacy `republish` boolean
  const shouldRepublish =
    body.calendar_update === "REPUBLISH" || body.republish === true;

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

  const now = body.from_time ? new Date(body.from_time) : new Date();

  // Optionally fetch Google Calendar busy blocks
  let busyIntervals: TimeInterval[] = [];
  if (body.respect_google_busy) {
    try {
      const integration = await prisma.googleIntegration.findUnique({
        where: { userId },
      });

      if (integration && integration.status === "CONNECTED") {
        const client = getGoogleClient(userId);
        const calendarIds = body.calendar_ids?.length
          ? body.calendar_ids
          : integration.busyCalendarIds.split(",").filter(Boolean);

        const planEndDate = new Date(plan.startDate);
        planEndDate.setDate(planEndDate.getDate() + reflowConfig.availability.length);

        const busy: BusyInterval[] = await client.freebusyQuery({
          timeMin: now.toISOString(),
          timeMax: planEndDate.toISOString(),
          calendarIds,
        });

        busyIntervals = busy.map((b) => ({
          start: new Date(b.start).getTime(),
          end: new Date(b.end).getTime(),
        }));

        if (body.buffer_minutes > 0) {
          const bufferMs = body.buffer_minutes * 60 * 1000;
          busyIntervals = busyIntervals.map((b) => ({
            start: b.start - bufferMs,
            end: b.end + bufferMs,
          }));
        }
      }
    } catch (err) {
      if (err instanceof GoogleReconnectError) {
        return NextResponse.json(
          { error: "GOOGLE_RECONNECT_REQUIRED", message: "Please reconnect your Google account." },
          { status: 409 },
        );
      }
      logger.warn("reflow.apply.busy_fetch_failed", { plan_id: planId, error: String(err) });
    }
  }

  const result = computeReflow(reflowItems, reflowConfig, plan.startDate, now, busyIntervals);

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

  let auditId: string | null = null;

  await prisma.$transaction(async (tx: any) => {
    // Apply MOVED items
    for (const change of movedChanges) {
      const item = plan.items.find((i) => i.id === change.itemId)!;
      await tx.studyPlanItem.update({
        where: { id: change.itemId },
        data: {
          dayIndex: change.after!.dayIndex,
          startTime: new Date(change.after!.startTime),
          endTime: new Date(change.after!.endTime),
          status: "RESCHEDULED",
          lastRescheduledAt: now,
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
    const audit = await tx.planReflowAudit.create({
      data: {
        userId,
        planId,
        reason: body.reason,
        algorithmVersion: result.algorithmVersion,
        inputSummary: {
          totalItems: plan.items.length,
          movableCount: reflowItems.filter((i) =>
            i.status === "SCHEDULED" && !i.locked && i.endTime.getTime() > now.getTime()
          ).length,
          fixedCount: reflowItems.length - movedChanges.length - droppedChanges.length,
          respect_google_busy: body.respect_google_busy,
          busy_intervals_count: busyIntervals.length,
        },
        changes: JSON.parse(JSON.stringify(result.changes)),
      },
    });
    auditId = audit.id;
  });

  logger.info("reflow.applied", {
    user_id: userId,
    plan_id: planId,
    audit_id: auditId,
    moved: movedChanges.length,
    dropped: droppedChanges.length,
    reason: body.reason,
  });

  // Post-commit: optionally trigger Google republish
  let calendarResult = null;
  if (shouldRepublish) {
    try {
      const { publishPlanToGoogle } = await import("@/services/publish");
      const pubResult = await publishPlanToGoogle(userId, planId);
      if ("data" in pubResult) {
        calendarResult = {
          status: pubResult.data.status,
          summary: pubResult.data.summary,
          duration_ms: pubResult.data.duration_ms,
        };
      } else {
        calendarResult = { error: pubResult.error };
      }
    } catch (err) {
      logger.error("reflow.republish_failed", { plan_id: planId, error: String(err) });
      calendarResult = { error: String(err) };
    }
  }

  return NextResponse.json({
    plan_id: planId,
    applied: true,
    audit_id: auditId,
    changes: result.changes,
    warnings: result.warnings,
    summary: {
      moved: movedChanges.length,
      kept: result.changes.filter((c) => c.action === "KEPT").length,
      dropped: droppedChanges.length,
    },
    calendar: calendarResult,
  });
}
