import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";

export async function POST(request: NextRequest) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const integration = await prisma.googleIntegration.findUnique({
    where: { userId },
  });

  if (!integration) {
    return NextResponse.json({ disconnected: true });
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

  await prisma.googleIntegration.delete({ where: { id: integration.id } });

  return NextResponse.json({ disconnected: true });
}
