import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decryptToken } from "@/lib/crypto/token-vault";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Your sign-in expired. Sign in again." }, { status: 401 });
  }

  const integration = await prisma.googleIntegration.findUnique({
    where: { userId },
  });

  if (!integration) {
    return NextResponse.json({ disconnected: true, status: "DISCONNECTED" });
  }

  // Best-effort revoke token at Google
  try {
    if (integration.accessTokenEncrypted) {
      const token = decryptToken(integration.accessTokenEncrypted);
      // Send the token in the POST body — never in the URL, where it would
      // leak into proxy/APM logs
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      });
    }
  } catch {
    // Best-effort — ignore revoke failures
  }

  // Mark DISCONNECTED and clear tokens (leave row for reconnect)
  try {
    await prisma.googleIntegration.update({
      where: { id: integration.id },
      data: {
        status: "DISCONNECTED",
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
        tokenExpiryMs: BigInt(0),
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
  } catch (err) {
    logger.error("google.integration.disconnect_failed", { user_id: userId, error: String(err) });
    return NextResponse.json(
      { error: "Google Calendar not disconnected. Check your connection and retry." },
      { status: 500 },
    );
  }

  logger.info("google.integration.disconnected", { user_id: userId });

  return NextResponse.json({ disconnected: true, status: "DISCONNECTED" });
}
