import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getGoogleClient, GoogleReconnectError } from "@/lib/google/calendar-client";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const integration = await prisma.googleIntegration.findUnique({
    where: { userId },
  });

  if (!integration || integration.status === "DISCONNECTED") {
    return NextResponse.json({ ok: false, reason: "Not connected" });
  }

  const startMs = Date.now();
  logger.info("google.integration.test.started", { user_id: userId });

  try {
    const client = getGoogleClient(userId);
    await client.listCalendars();

    await prisma.googleIntegration.update({
      where: { id: integration.id },
      data: {
        lastHealthyAt: new Date(),
        lastErrorCode: null,
        lastErrorMessage: null,
        status: "CONNECTED",
      },
    });

    logger.info("google.integration.test.completed", {
      user_id: userId,
      ok: true,
      duration_ms: Date.now() - startMs,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const isReconnect = err instanceof GoogleReconnectError;

    logger.info("google.integration.test.completed", {
      user_id: userId,
      ok: false,
      reason,
      duration_ms: Date.now() - startMs,
    });

    if (isReconnect) {
      return NextResponse.json({ ok: false, reason: "Reconnect required — please reconnect your Google account." });
    }

    return NextResponse.json({ ok: false, reason: "Connection test failed. Please try again." });
  }
}
