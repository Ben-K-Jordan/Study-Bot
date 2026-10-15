import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getGoogleClient, GoogleReconnectError } from "@/lib/google/calendar-client";
import { GOOGLE_COPY } from "@/lib/google/messages";
import { logger } from "@/lib/logger";

/**
 * GET /api/integrations/google/calendars: the student's Google calendars.
 * Errors carry a sentence in `error` and a machine `code`:
 * 400 GOOGLE_NOT_CONNECTED, 409 GOOGLE_RECONNECT_REQUIRED, 502 GOOGLE_UNAVAILABLE.
 */
export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Your sign-in expired. Sign in again." }, { status: 401 });
  }

  const integration = await prisma.googleIntegration.findUnique({
    where: { userId },
  });
  if (!integration || integration.status !== "CONNECTED") {
    return NextResponse.json(
      { error: GOOGLE_COPY.notConnected, code: "GOOGLE_NOT_CONNECTED" },
      { status: 400 },
    );
  }

  try {
    const client = getGoogleClient(userId);
    const calendars = await client.listCalendars();
    return NextResponse.json({
      calendars: calendars.map((c) => ({
        id: c.id,
        summary: c.summary,
        primary: c.primary,
        accessRole: c.accessRole,
        timeZone: c.timeZone,
      })),
      selected: integration.calendarIdSelected,
    });
  } catch (err) {
    if (err instanceof GoogleReconnectError) {
      return NextResponse.json(
        { error: GOOGLE_COPY.reconnect, code: "GOOGLE_RECONNECT_REQUIRED" },
        { status: 409 },
      );
    }
    logger.error("google_list_calendars_failed", { user_id: userId, error: String(err) });
    return NextResponse.json(
      { error: "Calendars didn't load. Retry.", code: "GOOGLE_UNAVAILABLE" },
      { status: 502 },
    );
  }
}
