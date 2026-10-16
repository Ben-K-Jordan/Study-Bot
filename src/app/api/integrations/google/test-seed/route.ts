/**
 * Test-only endpoint to seed a GoogleIntegration record.
 * Only available with GOOGLE_PROVIDER=fake and test auth enabled
 * (see lib/test-auth); otherwise it answers 404.
 *
 * The folder name must not start with an underscore: the App Router treats
 * _folders as private and never routes them.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isTestAuthEnabled } from "@/lib/test-auth";
import { unauthorized } from "@/lib/http";

function available(): boolean {
  return process.env.GOOGLE_PROVIDER === "fake" && isTestAuthEnabled();
}

export async function POST(request: NextRequest) {
  if (!available()) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  const userId = await getUserId(request);
  if (!userId) return unauthorized();

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // Use defaults
  }

  // Upsert integration record
  const integration = await prisma.googleIntegration.upsert({
    where: { userId },
    create: {
      userId,
      status: (body.status as string) || "CONNECTED",
      connectedEmail: (body.connected_email as string) || "test@example.com",
      refreshTokenEncrypted: "fake-encrypted-token",
      tokenExpiryMs: BigInt(Date.now() + 3600000),
      scopeString: "https://www.googleapis.com/auth/calendar",
      calendarIdSelected: (body.default_calendar_id as string) || "primary",
      busyCalendarIds: (body.busy_calendar_ids as string) || "primary",
      timezone: (body.timezone as string) || "America/New_York",
    },
    update: {
      status: (body.status as string) || "CONNECTED",
      connectedEmail: (body.connected_email as string) || "test@example.com",
      lastErrorCode: null,
      lastErrorMessage: null,
    },
  });

  return NextResponse.json({ seeded: true, id: integration.id, userId });
}

export async function DELETE(request: NextRequest) {
  if (!available()) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  const userId = await getUserId(request);
  if (!userId) return unauthorized();

  await prisma.googleIntegration.deleteMany({ where: { userId } });
  return NextResponse.json({ deleted: true });
}
