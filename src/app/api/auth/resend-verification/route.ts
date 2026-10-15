import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authEmailLimiter, getClientIp } from "@/lib/rate-limit";
import { createEmailVerificationToken } from "@/lib/tokens";
import { emailProvider } from "@/lib/email/provider";
import { emailVerification } from "@/lib/email/templates";
import { logger } from "@/lib/logger";
import { getBaseUrl } from "@/lib/config";
import {
  emailField,
  invalidFields,
  logVerificationLinkHint,
  rateLimited,
  readJson,
  unreadableBody,
} from "../_lib/responses";

const schema = z.object({
  email: emailField,
});

const GENERIC_MESSAGE = "If that email has an account waiting for verification, a new link is on its way.";

/**
 * POST /api/auth/resend-verification
 * Resends the email verification link. Always returns 200 for a well-formed
 * email, whether or not an account needs it, to prevent enumeration.
 */
export async function POST(request: Request) {
  const rl = authEmailLimiter.check(getClientIp(request));
  if (!rl.allowed) return rateLimited(rl.retryAfterMs, "Too many link requests.");

  const body = await readJson(request);
  if (body === null) return unreadableBody();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return invalidFields(parsed.error);

  try {
    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email.toLowerCase() },
    });

    // Always return success to prevent enumeration
    if (!user || user.emailVerified) {
      return NextResponse.json({ message: GENERIC_MESSAGE });
    }

    const token = await createEmailVerificationToken(user.id);
    const verifyUrl = `${getBaseUrl()}/api/auth/verify-email?token=${token}`;
    const { subject, html } = emailVerification(user.name || "there", verifyUrl);
    await emailProvider.send(user.email, subject, html);
    logger.info("resend_verification.sent", { userId: user.id });
    logVerificationLinkHint();
  } catch (err) {
    logger.error("resend_verification.failed", { error: String(err) });
  }

  return NextResponse.json({ message: GENERIC_MESSAGE });
}
