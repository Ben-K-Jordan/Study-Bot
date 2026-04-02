import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const integration = await prisma.googleIntegration.findUnique({
    where: { userId },
  });

  if (!integration || integration.status === "DISCONNECTED") {
    return NextResponse.json({
      status: "DISCONNECTED",
      connected: false,
      scopes: [],
      default_calendar_id: "primary",
      busy_calendar_ids: ["primary"],
    });
  }

  return NextResponse.json({
    status: integration.status,
    connected: integration.status === "CONNECTED",
    connected_email: integration.connectedEmail,
    scopes: integration.scopeString.split(" ").filter(Boolean),
    default_calendar_id: integration.calendarIdSelected,
    busy_calendar_ids: integration.busyCalendarIds.split(",").filter(Boolean),
    timezone: integration.timezone,
    last_healthy_at: integration.lastHealthyAt?.toISOString() ?? null,
    last_error: integration.lastErrorCode
      ? { code: integration.lastErrorCode, message: integration.lastErrorMessage }
      : null,
    // Legacy fields for backward compat
    selected_calendar_id: integration.calendarIdSelected,
    token_expiry: Number(integration.tokenExpiryMs),
  });
}
