import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getGoogleClient } from "@/lib/google/calendar-client";

export async function GET(request: NextRequest) {
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

  try {
    const client = getGoogleClient(userId);
    const calendars = await client.listCalendars();
    return NextResponse.json({
      calendars,
      selected: integration.calendarIdSelected,
    });
  } catch (err) {
    console.error("List calendars failed:", err);
    return NextResponse.json({ error: "Failed to list calendars" }, { status: 500 });
  }
}
