import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createPasswordResetToken } from "@/lib/tokens";
import { emailProvider } from "@/lib/email/provider";
import { passwordReset } from "@/lib/email/templates";
import { authEmailLimiter, getClientIp } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { getBaseUrl } from "@/lib/config";
import { emailField, invalidFields, rateLimited, readJson, unreadableBody } from "../_lib/responses";

const schema = z.object({
  email: emailField,
});

/**
 * POST /api/auth/forgot-password
 * Sends a password reset email. Always returns 200 for a well-formed email,
 * whether or not an account uses it, to prevent email enumeration.
 */
export async function POST(request: NextRequest) {
  const rl = authEmailLimiter.check(getClientIp(request));
  if (!rl.allowed) return rateLimited(rl.retryAfterMs, "Too many reset requests.");

  const body = await readJson(request);
  if (body === null) return unreadableBody();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return invalidFields(parsed.error);

  // The same answer whether or not the email exists, to prevent enumeration
  const genericResponse = NextResponse.json({
    message: "If an account uses that email, a password reset link is on its way.",
  });

  try {
    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email.toLowerCase() },
    });

    if (!user) return genericResponse;

    const token = await createPasswordResetToken(user.id);
    const resetUrl = `${getBaseUrl()}/auth/reset-password?token=${token}`;
    const { subject, html } = passwordReset(user.name || "there", resetUrl);

    await emailProvider.send(user.email, subject, html);
    logger.info("password_reset.sent", { userId: user.id });
  } catch (err) {
    logger.error("password_reset.failed", { error: String(err) });
  }

  return genericResponse;
}
