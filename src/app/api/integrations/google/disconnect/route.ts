import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/http";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decryptToken } from "@/lib/crypto/token-vault";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return unauthorized();
  }

  const integration = await prisma.googleIntegration.findUnique({
    where: { userId },
  });

  if (!integration) {
    return NextResponse.json({ disconnected: true, status: "DISCONNECTED" });
  }

  // Best-effort revoke at Google. Prefer the refresh token: revoking it ends
  // the whole grant, while the stored access token has usually expired (it
  // lasts about an hour) and Google rejects revoking it.
  try {
    const encrypted = integration.refreshTokenEncrypted ?? integration.accessTokenEncrypted;
    if (encrypted) {
      const token = decryptToken(encrypted);
      // Send the token in the POST body, never in the URL, where it would
      // leak into proxy/APM logs
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
        signal: AbortSignal.timeout(5_000),
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
