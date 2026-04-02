import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getGoogleClient, GoogleReconnectError, type BusyInterval } from "@/lib/google/calendar-client";
import { mergeBusy, type TimeInterval } from "@/lib/google/free-slots";
import { z } from "zod/v4";
import { logger } from "@/lib/logger";

const freebusySchema = z.object({
  calendar_ids: z.array(z.string()).optional(),
  time_min: z.string().min(1),
  time_max: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const integration = await prisma.googleIntegration.findUnique({
    where: { userId },
  });
  if (!integration || integration.status !== "CONNECTED") {
    return NextResponse.json({ error: "Google Calendar not connected" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = freebusySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 });
  }

  // Default to user's busy calendar preferences
  const calendarIds = parsed.data.calendar_ids?.length
    ? parsed.data.calendar_ids
    : integration.busyCalendarIds.split(",").filter(Boolean);

  const startMs = Date.now();
  logger.info("google.freebusy.started", { user_id: userId, calendar_count: calendarIds.length });

  try {
    const client = getGoogleClient(userId);
    const busy: BusyInterval[] = await client.freebusyQuery({
      timeMin: parsed.data.time_min,
      timeMax: parsed.data.time_max,
      calendarIds,
    });

    const durationMs = Date.now() - startMs;

    // Flatten to {start,end,calendar_id} per spec
    const busyFlat = busy.map((b) => ({
      start: b.start,
      end: b.end,
      calendar_id: b.calendarId,
    }));

    // Merged busy (across all calendars)
    const allIntervals: TimeInterval[] = busy.map((b) => ({
      start: new Date(b.start).getTime(),
      end: new Date(b.end).getTime(),
    }));
    const merged = mergeBusy(allIntervals);
    const mergedBusy = merged.map((m) => ({
      start: new Date(m.start).toISOString(),
      end: new Date(m.end).toISOString(),
    }));

    logger.info("google.freebusy.completed", {
      user_id: userId,
      calendar_count: calendarIds.length,
      busy_count: busy.length,
      duration_ms: durationMs,
    });

    return NextResponse.json({
      busy: busyFlat,
      tz: integration.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      // Legacy fields
      calendars: Array.from(
        busy.reduce((map, b) => {
          if (!map.has(b.calendarId)) map.set(b.calendarId, []);
          map.get(b.calendarId)!.push({ start: b.start, end: b.end });
          return map;
        }, new Map<string, { start: string; end: string }[]>()).entries(),
      ).map(([calId, intervals]) => ({ calendarId: calId, busy: intervals })),
      merged_busy: mergedBusy,
    });
  } catch (err) {
    if (err instanceof GoogleReconnectError) {
      return NextResponse.json(
        { error: "GOOGLE_RECONNECT_REQUIRED", message: "Please reconnect your Google account." },
        { status: 409 },
      );
    }
    logger.error("google_freebusy_query_failed", { error: String(err) });
    return NextResponse.json({ error: "Failed to query Google Calendar" }, { status: 500 });
  }
}
