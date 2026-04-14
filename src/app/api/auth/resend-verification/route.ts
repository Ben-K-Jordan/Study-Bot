import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authLimiter, getClientIp, tooManyRequests } from "@/lib/rate-limit";
import { createEmailVerificationToken } from "@/lib/tokens";
import { emailProvider } from "@/lib/email/provider";
import { emailVerification } from "@/lib/email/templates";
import { logger } from "@/lib/logger";

/**
 * POST /api/auth/resend-verification
 * Resends the email verification link. Always returns 200 to prevent enumeration.
 */
export async function POST(request: Request) {
  const rl = authLimiter.check(getClientIp(request as any));
  if (!rl.allowed) return tooManyRequests(rl.retryAfterMs);

  try {
    const { email } = await request.json();
    if (!email || typeof email !== "string") {
      return NextResponse.json({ message: "If that email exists, we've sent a new link." });
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    // Always return success to prevent enumeration
    if (!user || user.emailVerified) {
      return NextResponse.json({ message: "If that email exists, we've sent a new link." });
    }

    const token = await createEmailVerificationToken(user.id);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const verifyUrl = `${appUrl}/api/auth/verify-email?token=${token}`;
    const { subject, html } = emailVerification(user.name || "there", verifyUrl);
    await emailProvider.send(user.email, subject, html);
    logger.info("resend_verification.sent", { userId: user.id });

    return NextResponse.json({ message: "If that email exists, we've sent a new link." });
  } catch (err) {
    logger.error("resend_verification.failed", { error: String(err) });
    return NextResponse.json({ message: "If that email exists, we've sent a new link." });
  }
}
