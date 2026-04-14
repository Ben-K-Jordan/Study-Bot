import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { computeReflow, ReflowItem, ReflowConfig } from "@/services/reflow";
import { z } from "zod/v4";
import { getGoogleClient, GoogleReconnectError, type BusyInterval } from "@/lib/google/calendar-client";
import { type TimeInterval } from "@/lib/google/free-slots";
import { logger } from "@/lib/logger";

const previewSchema = z.object({
  reason: z.string().optional().default("MANUAL"),
  from_time: z.string().optional(),
  only_future: z.boolean().optional().default(true),
  respect_google_busy: z.boolean().optional().default(true),
  calendar_ids: z.array(z.string()).optional(),
  buffer_minutes: z.number().min(0).max(60).optional().default(10),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ planId: string }> },
) {
  const userId = getUserId(req.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { planId } = await params;

  // Parse body
  let body: z.infer<typeof previewSchema>;
  try {
    const raw = await req.json().catch(() => ({}));
    body = previewSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Validation error", details: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
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

        // Query busy for the plan's date range
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

        // Apply buffer: expand each busy block by buffer_minutes on each side
        if (body.buffer_minutes > 0) {
          const bufferMs = body.buffer_minutes * 60 * 1000;
          busyIntervals = busyIntervals.map((b) => ({
            start: b.start - bufferMs,
            end: b.end + bufferMs,
          }));
        }
      }
      // If not connected, just skip busy — don't error on preview
    } catch (err) {
      if (err instanceof GoogleReconnectError) {
        return NextResponse.json(
          { error: "GOOGLE_RECONNECT_REQUIRED", message: "Please reconnect your Google account." },
          { status: 409 },
        );
      }
      // Non-fatal: log and continue without busy data
      logger.warn("reflow.preview.busy_fetch_failed", { plan_id: planId, error: String(err) });
    }
  }

  const result = computeReflow(reflowItems, reflowConfig, plan.startDate, now, busyIntervals);

  return NextResponse.json({
    plan_id: planId,
    reason: body.reason,
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
