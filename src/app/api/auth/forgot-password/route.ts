import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createPasswordResetToken } from "@/lib/tokens";
import { emailProvider } from "@/lib/email/provider";
import { passwordReset } from "@/lib/email/templates";
import { authEmailLimiter, getClientIp } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { getBaseUrl } from "@/lib/config";
import { areEmailLinksAvailable } from "@/lib/email/delivery";
import { EMAIL_NOT_CONFIGURED_MESSAGES } from "@/lib/auth-messages";
import {
  emailField,
  emailNotConfigured,
  invalidFields,
  rateLimited,
  readJson,
  unreadableBody,
} from "../_lib/responses";
import { accountKey, authEmailAddressLimiter } from "../_lib/limits";

const schema = z.object({
  email: emailField,
});

/** Create the token and send the email. Runs after the response is sent. */
async function sendResetLink(user: { id: string; email: string; name: string | null }): Promise<void> {
  try {
    const token = await createPasswordResetToken(user.id);
    const resetUrl = `${getBaseUrl()}/auth/reset-password?token=${token}`;
    const { subject, html } = passwordReset(user.name || "there", resetUrl);
    await emailProvider.send(user.email, subject, html);
    logger.info("password_reset.sent", { userId: user.id });
  } catch (err) {
    logger.error("password_reset.failed", { userId: user.id, error: String(err) });
  }
}

/**
 * POST /api/auth/forgot-password
 * Sends a password reset email. Always returns 200 for a well-formed email,
 * whether or not an account uses it, to prevent email enumeration. The
 * token write and the email happen after the response, so the answer takes
 * the same time either way. A production server that can't send email
 * answers 503 EMAIL_NOT_CONFIGURED for every address instead of promising
 * a link that never arrives.
 */
export async function POST(request: NextRequest) {
  // Production without SMTP: the link would go nowhere (see areEmailLinksAvailable).
  if (!areEmailLinksAvailable()) return emailNotConfigured(EMAIL_NOT_CONFIGURED_MESSAGES.resetLink);

  const rl = authEmailLimiter.check(getClientIp(request));
  if (!rl.allowed) return rateLimited(rl.retryAfterMs, "Too many reset requests.");

  const body = await readJson(request);
  if (body === null) return unreadableBody();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return invalidFields(parsed.error);

  const email = accountKey(parsed.data.email);
  const perAddress = authEmailAddressLimiter.check(email);
  if (!perAddress.allowed) return rateLimited(perAddress.retryAfterMs, "Too many reset requests.");

  // The same answer whether or not the email exists, to prevent enumeration
  const genericResponse = NextResponse.json({
    message: "If an account uses that email, a password reset link is on its way.",
  });

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true },
    });
    if (user) after(() => sendResetLink(user));
  } catch (err) {
    logger.error("password_reset.failed", { error: String(err) });
  }

  return genericResponse;
}
