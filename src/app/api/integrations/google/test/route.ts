import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getGoogleClient, GoogleReconnectError } from "@/lib/google/calendar-client";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const userId = await getUserId(request);
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

    const durationMs = Date.now() - startMs;
    logger.info("google.integration.test.completed", {
      user_id: userId,
      ok: true,
      duration_ms: durationMs,
    });

    return NextResponse.json({ ok: true, duration_ms: durationMs });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const isReconnect = err instanceof GoogleReconnectError;
    const durationMs = Date.now() - startMs;

    logger.info("google.integration.test.completed", {
      user_id: userId,
      ok: false,
      reason,
      is_reconnect: isReconnect,
      duration_ms: durationMs,
    });

    if (isReconnect) {
      // Mark DISCONNECTED so user knows to reconnect
      await prisma.googleIntegration.update({
        where: { id: integration.id },
        data: {
          status: "DISCONNECTED",
          lastErrorCode: "GOOGLE_RECONNECT_REQUIRED",
          lastErrorMessage: "Token revoked or expired. Please reconnect.",
        },
      });

      return NextResponse.json(
        {
          ok: false,
          error: "GOOGLE_RECONNECT_REQUIRED",
          reason: "Token revoked or expired. Please reconnect your Google account.",
          duration_ms: durationMs,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      ok: false,
      reason: "Connection test failed. Please try again.",
      duration_ms: durationMs,
    });
  }
}
