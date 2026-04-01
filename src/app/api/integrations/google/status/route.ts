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
    select: {
      calendarIdSelected: true,
      scopeString: true,
      tokenExpiryMs: true,
    },
  });

  if (!integration) {
    return NextResponse.json({
      connected: false,
      selected_calendar_id: null,
      scopes: [],
      token_expiry: null,
    });
  }

  return NextResponse.json({
    connected: true,
    selected_calendar_id: integration.calendarIdSelected,
    scopes: integration.scopeString.split(" ").filter(Boolean),
    token_expiry: Number(integration.tokenExpiryMs),
  });
}
