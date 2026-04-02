/**
 * Test-only endpoint to seed a GoogleIntegration record.
 * Only available when GOOGLE_PROVIDER=fake.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(request: NextRequest) {
  if (process.env.GOOGLE_PROVIDER !== "fake") {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
  if (process.env.GOOGLE_PROVIDER !== "fake") {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.googleIntegration.deleteMany({ where: { userId } });
  return NextResponse.json({ deleted: true });
}
