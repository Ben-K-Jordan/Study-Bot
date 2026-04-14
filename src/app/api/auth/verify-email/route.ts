import { NextRequest, NextResponse } from "next/server";
import { consumeToken } from "@/lib/tokens";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { authLimiter, getClientIp, tooManyRequests } from "@/lib/rate-limit";

/**
 * GET /api/auth/verify-email?token=xxx
 * Verifies the user's email address.
 */
export async function GET(request: NextRequest) {
  const rl = authLimiter.check(getClientIp(request));
  if (!rl.allowed) return tooManyRequests(rl.retryAfterMs);

  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const userId = await consumeToken(token, "EMAIL_VERIFY");
  if (!userId) {
    return NextResponse.json(
      { error: "Invalid or expired verification link" },
      { status: 400 },
    );
  }

  await prisma.user.update({
    where: { id: userId },
    data: { emailVerified: new Date() },
  });

  logger.info("email.verified", { userId });

  // Redirect to sign-in with a success message
  const url = new URL("/auth/signin?verified=true", request.url);
  return NextResponse.redirect(url);
}
