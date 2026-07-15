import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { prisma } from "@/lib/db";
import { createPasswordResetToken } from "@/lib/tokens";
import { emailProvider } from "@/lib/email/provider";
import { passwordReset } from "@/lib/email/templates";
import { authLimiter, getClientIp, tooManyRequests } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

const schema = z.object({
  email: z.string().email(),
});

/**
 * POST /api/auth/forgot-password
 * Sends a password reset email. Always returns 200 to prevent email enumeration.
 */
export async function POST(request: NextRequest) {
  const rl = authLimiter.check(getClientIp(request));
  if (!rl.allowed) return tooManyRequests(rl.retryAfterMs);

  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  // Always return 200 regardless of whether the email exists — prevents enumeration
  const genericResponse = NextResponse.json({
    message: "If an account with that email exists, we've sent a password reset link.",
  });

  try {
    const user = await prisma.user.findUnique({
      where: { email: body.email.toLowerCase().trim() },
    });

    if (!user) return genericResponse;

    const token = await createPasswordResetToken(user.id);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const resetUrl = `${appUrl}/auth/reset-password?token=${token}`;
    const { subject, html } = passwordReset(user.name || "there", resetUrl);

    await emailProvider.send(user.email, subject, html);
    logger.info("password_reset.sent", { userId: user.id });
  } catch (err) {
    logger.error("password_reset.failed", { error: String(err) });
  }

  return genericResponse;
}
