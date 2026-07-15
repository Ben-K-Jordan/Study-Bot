import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { pushLimiter, tooManyRequests } from "@/lib/rate-limit";

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(500),
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

  const rl = pushLimiter.check(userId);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterMs);

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

  const existingCount = await prisma.pushSubscription.count({ where: { userId } });
  if (existingCount >= 10) {
    return NextResponse.json(
      { error: "Maximum of 10 push subscriptions per account" },
      { status: 400 },
    );
  }

  await prisma.pushSubscription.upsert({
    where: { userId_endpoint: { userId, endpoint } },
    update: { p256dh: keys.p256dh, auth: keys.auth },
    create: { userId, endpoint, p256dh: keys.p256dh, auth: keys.auth },
  });

  logger.info("Push subscription registered", { userId, endpoint });

  return NextResponse.json({ ok: true }, { status: 201 });
}
