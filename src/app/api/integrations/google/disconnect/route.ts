import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
      const token = decrypt(integration.accessTokenEncrypted);
      await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
    }
  } catch {
    // Best-effort — ignore revoke failures
  }

  // Mark DISCONNECTED and clear tokens (leave row for reconnect)
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

  logger.info("google.integration.disconnected", { user_id: userId });

  return NextResponse.json({ disconnected: true, status: "DISCONNECTED" });
}
