import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getGoogleClient, type BusyInterval } from "@/lib/google/calendar-client";
import { mergeBusy, type TimeInterval } from "@/lib/google/free-slots";
import { z } from "zod/v4";
import { logger } from "@/lib/logger";

const freebusySchema = z.object({
  timeMin: z.string().min(1),
  timeMax: z.string().min(1),
  calendarIds: z.array(z.string()).optional(),
});

export async function POST(request: NextRequest) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const integration = await prisma.googleIntegration.findUnique({
    where: { userId },
  });
  if (!integration) {
    return NextResponse.json({ error: "Google Calendar not connected" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let parsed;
  try {
    parsed = freebusySchema.parse(body);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    throw err;
  }

  const calendarIds = parsed.calendarIds?.length
    ? parsed.calendarIds
    : [integration.calendarIdSelected || "primary"];

  try {
    const ftsStart = Date.now();
    const client = getGoogleClient(userId);
    const busy: BusyInterval[] = await client.freebusyQuery({
      timeMin: parsed.timeMin,
      timeMax: parsed.timeMax,
      calendarIds,
    });
    const ftsMs = Date.now() - ftsStart;

    // Group by calendar
    const calendarMap = new Map<string, { start: string; end: string }[]>();
    for (const b of busy) {
      if (!calendarMap.has(b.calendarId)) calendarMap.set(b.calendarId, []);
      calendarMap.get(b.calendarId)!.push({ start: b.start, end: b.end });
    }

    const calendars = Array.from(calendarMap.entries()).map(([calId, intervals]) => ({
      calendarId: calId,
      busy: intervals,
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

    logger.info("freebusy.queried", {
      user_id: userId,
      calendar_count: calendarIds.length,
      busy_count: busy.length,
      fts_ms: ftsMs,
    });

    return NextResponse.json({
      calendars,
      merged_busy: mergedBusy,
    });
  } catch (err) {
    console.error("Freebusy query failed:", err);
    return NextResponse.json({ error: "Failed to query Google Calendar" }, { status: 500 });
  }
}
