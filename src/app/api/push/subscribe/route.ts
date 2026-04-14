import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

/**
 * POST /api/push/subscribe — register a push subscription for the current user.
 */
export async function POST(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = subscribeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid subscription", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { endpoint, keys } = parsed.data;

  await prisma.pushSubscription.upsert({
    where: { userId_endpoint: { userId, endpoint } },
    update: { p256dh: keys.p256dh, auth: keys.auth },
    create: { userId, endpoint, p256dh: keys.p256dh, auth: keys.auth },
  });

  logger.info("Push subscription registered", { userId, endpoint });

  return NextResponse.json({ ok: true }, { status: 201 });
}
