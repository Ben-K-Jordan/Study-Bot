import { after, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authEmailLimiter, getClientIp } from "@/lib/rate-limit";
import { createEmailVerificationToken } from "@/lib/tokens";
import { emailProvider } from "@/lib/email/provider";
import { emailVerification } from "@/lib/email/templates";
import { logger } from "@/lib/logger";
import { getBaseUrl } from "@/lib/config";
import { areEmailLinksAvailable } from "@/lib/email/delivery";
import { EMAIL_NOT_CONFIGURED_MESSAGES } from "@/lib/auth-messages";
import {
  emailField,
  emailNotConfigured,
  invalidFields,
  logVerificationLinkHint,
  rateLimited,
  readJson,
  unreadableBody,
} from "../_lib/responses";
import { accountKey, authEmailAddressLimiter } from "../_lib/limits";

const schema = z.object({
  email: emailField,
});

const GENERIC_MESSAGE = "If that email has an account waiting for verification, a new link is on its way.";

/** Create the token and send the email. Runs after the response is sent. */
async function sendVerificationLink(user: { id: string; email: string; name: string | null }): Promise<void> {
  try {
    const token = await createEmailVerificationToken(user.id);
    const verifyUrl = `${getBaseUrl()}/api/auth/verify-email?token=${token}`;
    const { subject, html } = emailVerification(user.name || "there", verifyUrl);
    await emailProvider.send(user.email, subject, html);
    logger.info("resend_verification.sent", { userId: user.id });
    logVerificationLinkHint();
  } catch (err) {
    logger.error("resend_verification.failed", { userId: user.id, error: String(err) });
  }
}

/**
 * POST /api/auth/resend-verification
 * Resends the email verification link. Always returns 200 for a well-formed
 * email, whether or not an account needs it, to prevent enumeration. The
 * token write and the email happen after the response, so the answer takes
 * the same time either way. A production server that can't send email
 * answers 503 EMAIL_NOT_CONFIGURED for every address.
 */
export async function POST(request: Request) {
  // Production without SMTP: the link would go nowhere (see areEmailLinksAvailable).
  if (!areEmailLinksAvailable()) return emailNotConfigured(EMAIL_NOT_CONFIGURED_MESSAGES.verificationLink);

  const rl = authEmailLimiter.check(getClientIp(request));
  if (!rl.allowed) return rateLimited(rl.retryAfterMs, "Too many link requests.");

  const body = await readJson(request);
  if (body === null) return unreadableBody();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return invalidFields(parsed.error);

  const email = accountKey(parsed.data.email);
  const perAddress = authEmailAddressLimiter.check(email);
  if (!perAddress.allowed) return rateLimited(perAddress.retryAfterMs, "Too many link requests.");

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, emailVerified: true },
    });
    if (user && !user.emailVerified) after(() => sendVerificationLink(user));
  } catch (err) {
    logger.error("resend_verification.failed", { error: String(err) });
  }

  return NextResponse.json({ message: GENERIC_MESSAGE });
}
