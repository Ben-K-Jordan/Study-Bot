import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { computeReflow, type ReflowConfig, type ReflowItem, type ReflowResult } from "@/services/reflow";
import { addDays, zonedTimeToUtc } from "@/lib/timezone";
import { dateColumnKey } from "@/lib/plan-dates";
import { getGoogleClient, GoogleReconnectError, type BusyInterval } from "@/lib/google/calendar-client";
import { type TimeInterval } from "@/lib/google/free-slots";
import { logger } from "@/lib/logger";

/** Fields shared by the reflow preview and apply requests. */
export const reflowRequestSchema = z.object({
  reason: z.string().max(64).optional().default("MANUAL"),
  from_time: z.string().optional(),
  only_future: z.boolean().optional().default(true),
  respect_google_busy: z.boolean().optional().default(true),
  calendar_ids: z.array(z.string()).optional(),
  buffer_minutes: z.number().min(0).max(60).optional().default(10),
  /**
   * The Plan screen's "Reschedule sessions": also move missed sessions, and
   * keep every session before the exam day (the ones that don't fit are
   * skipped). Off by default so existing API callers keep the old behavior.
   */
  include_missed: z.boolean().optional().default(false),
});

export type ReflowRequest = z.infer<typeof reflowRequestSchema>;

type PlanWithItems = NonNullable<Awaited<ReturnType<typeof findPlan>>>;

function findPlan(planId: string) {
  return prisma.studyPlan.findUnique({
    where: { planId },
    include: { items: { orderBy: [{ dayIndex: "asc" }, { startTime: "asc" }] } },
  });
}

export function jsonError(status: number, error: string, code: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, code, ...extra }, { status });
}

/** Parse a reflow request body; returns a 400 response when it is invalid. */
export async function parseReflowBody<T extends z.ZodTypeAny>(
  req: Request,
  schema: T,
): Promise<{ body: z.infer<T> } | { response: NextResponse }> {
  let raw: unknown = {};
  try {
    const text = await req.text();
    raw = text ? JSON.parse(text) : {};
  } catch {
    return { response: jsonError(400, "The request wasn't valid JSON.", "invalid_json") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      response: jsonError(400, "The reschedule options weren't valid.", "validation_failed", {
        details: parsed.error.issues,
      }),
    };
  }
  return { body: parsed.data };
}

export interface PreparedReflow {
  plan: PlanWithItems;
  reflowItems: ReflowItem[];
  result: ReflowResult;
  now: Date;
  busyIntervals: TimeInterval[];
}

/**
 * Load a plan the user owns, gather Google busy time when asked, and compute
 * the reflow. Returns an error response for a missing plan, another
 * account's plan, a bad from_time, or a Google sign-in that expired.
 */
export async function prepareReflow(
  userId: string,
  planId: string,
  body: ReflowRequest,
  logPrefix: string,
): Promise<PreparedReflow | { response: NextResponse }> {
  const plan = await findPlan(planId);

  if (!plan) {
    return { response: jsonError(404, "This plan doesn't exist anymore.", "not_found") };
  }
  if (plan.userId !== userId) {
    return { response: jsonError(403, "This plan belongs to another account.", "forbidden") };
  }

  // Load sessions for mode info
  const sessionIds = plan.items.map((i) => i.sessionId);
  const sessions = await prisma.session.findMany({
    where: { sessionId: { in: sessionIds } },
    select: { sessionId: true, mode: true, plannedMinutes: true },
  });
  const sessionMap = new Map(sessions.map((s) => [s.sessionId, s]));

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

  const config = (plan.config ?? {}) as Record<string, unknown>;
  const reflowConfig: ReflowConfig = {
    availability:
      (config.availability as { start: string; end: string }[] | undefined) ??
      Array.from({ length: 7 }, () => ({ start: "09:00", end: "17:00" })),
    daily_study_cap_minutes: (config.daily_study_cap_minutes as number | undefined) ?? 180,
  };

  const now = body.from_time ? new Date(body.from_time) : new Date();
  if (isNaN(now.getTime())) {
    return {
      response: jsonError(400, "from_time must be a valid date string.", "invalid_from_time"),
    };
  }

  // The plan's first day is a DATE column; noon of that day in the plan's
  // timezone is an instant that falls on it however far the zone is from UTC.
  const startKey = dateColumnKey(plan.startDate);
  const planStart = zonedTimeToUtc(startKey, "12:00", plan.timezone);
  const examKey = dateColumnKey(plan.examDate);
  const lastDay = body.include_missed ? addDays(examKey, -1) : undefined;

  // Optionally fetch Google Calendar busy blocks (a read; nothing is written)
  let busyIntervals: TimeInterval[] = [];
  if (body.respect_google_busy) {
    try {
      const integration = await prisma.googleIntegration.findUnique({ where: { userId } });

      if (integration && integration.status === "CONNECTED") {
        const client = getGoogleClient(userId);
        const calendarIds = body.calendar_ids?.length
          ? body.calendar_ids
          : integration.busyCalendarIds.split(",").filter(Boolean);

        // Midnight after the last day sessions can land on
        const lastItemDay = plan.items.reduce(
          (max, item) => Math.max(max, item.dayIndex),
          reflowConfig.availability.length - 1,
        );
        const horizonEnd = lastDay ?? addDays(startKey, lastItemDay);
        const timeMax = zonedTimeToUtc(addDays(horizonEnd, 1), "00:00", plan.timezone);

        if (timeMax.getTime() > now.getTime()) {
          const busy: BusyInterval[] = await client.freebusyQuery({
            timeMin: now.toISOString(),
            timeMax: timeMax.toISOString(),
            calendarIds,
          });

          busyIntervals = busy.map((b) => ({
            start: new Date(b.start).getTime(),
            end: new Date(b.end).getTime(),
          }));

          // Expand each busy block by buffer_minutes on each side
          if (body.buffer_minutes > 0) {
            const bufferMs = body.buffer_minutes * 60 * 1000;
            busyIntervals = busyIntervals.map((b) => ({
              start: b.start - bufferMs,
              end: b.end + bufferMs,
            }));
          }
        }
      }
      // Not connected: schedule without busy data
    } catch (err) {
      if (err instanceof GoogleReconnectError) {
        return {
          response: jsonError(409, "Google Calendar needs you to sign in again.", "GOOGLE_RECONNECT_REQUIRED", {
            message: "Google Calendar needs you to sign in again.",
          }),
        };
      }
      // Non-fatal: log and continue without busy data
      logger.warn(`${logPrefix}.busy_fetch_failed`, { plan_id: planId, error: String(err) });
    }
  }

  const result = computeReflow(
    reflowItems,
    reflowConfig,
    planStart,
    now,
    busyIntervals,
    plan.timezone,
    { includeMissed: body.include_missed, lastDay },
  );

  return { plan, reflowItems, result, now, busyIntervals };
}

/** Counts for the response summary. */
export function summarize(result: ReflowResult, totalItems: number) {
  return {
    total_items: totalItems,
    moved: result.changes.filter((c) => c.action === "MOVED").length,
    kept: result.changes.filter((c) => c.action === "KEPT").length,
    dropped: result.changes.filter((c) => c.action === "DROPPED").length,
  };
}
