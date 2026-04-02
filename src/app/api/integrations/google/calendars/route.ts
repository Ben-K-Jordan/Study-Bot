import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getGoogleClient, GoogleReconnectError } from "@/lib/google/calendar-client";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
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
        { error: "GOOGLE_RECONNECT_REQUIRED", message: "Please reconnect your Google account." },
        { status: 409 },
      );
    }
    logger.error("google_list_calendars_failed", { error: String(err) });
    return NextResponse.json({ error: "Failed to list calendars" }, { status: 500 });
  }
}
