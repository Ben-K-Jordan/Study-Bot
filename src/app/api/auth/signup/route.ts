import { after, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword, isEmailVerificationRequired } from "@/lib/auth-options";
import { signupLimiter, getClientIp } from "@/lib/rate-limit";
import { createEmailVerificationToken } from "@/lib/tokens";
import { emailProvider } from "@/lib/email/provider";
import { emailVerification } from "@/lib/email/templates";
import { logger } from "@/lib/logger";
import { getBaseUrl } from "@/lib/config";
import { REQUEST_FAILED } from "@/components/auth/messages";
import {
  emailField,
  invalidFields,
  logVerificationLinkHint,
  nameField,
  newPasswordField,
  rateLimited,
  readJson,
  unreadableBody,
} from "../_lib/responses";

const signupSchema = z.object({
  name: nameField,
  email: emailField,
  password: newPasswordField,
});

/** Create the token and send the email. Runs after the response is sent. */
async function sendVerificationLink(user: { id: string; email: string; name: string | null }): Promise<void> {
  try {
    const token = await createEmailVerificationToken(user.id);
    const verifyUrl = `${getBaseUrl()}/api/auth/verify-email?token=${token}`;
    const { subject, html } = emailVerification(user.name || "there", verifyUrl);
    await emailProvider.send(user.email, subject, html);
    logger.info("signup.verification_email_sent", { userId: user.id });
    logVerificationLinkHint();
  } catch (emailErr) {
    // A mail failure never breaks signup; the sign-in form offers a new link.
    logger.error("signup.verification_email_failed", {
      userId: user.id,
      error: String(emailErr),
    });
  }
}

/**
 * POST /api/auth/signup
 *
 * Always returns the same shaped response whether the email is new or taken,
 * to prevent email enumeration. When sign-in requires a verified email, a
 * new account gets a verification email after the response, so its token
 * write and send don't make a new email answer slower than a taken one.
 * Without that requirement the form signs the new account straight in, and
 * no email is sent (the sign-in form offers a link if the setting changes).
 *
 * 400 bodies carry `issues: [{ field, message }]` for the form's fields.
 */
export async function POST(request: Request) {
  const rl = signupLimiter.check(getClientIp(request));
  if (!rl.allowed) return rateLimited(rl.retryAfterMs, "Too many new accounts from this network.");

  const body = await readJson(request);
  if (body === null) return unreadableBody();
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) return invalidFields(parsed.error);
  const { email, password, name } = parsed.data;

  try {
    const normalizedEmail = email.toLowerCase();
    const passwordHash = await hashPassword(password);

    // Generic response, the same whether the account is new or already exists
    const genericResponse = NextResponse.json(
      { message: "Check your email to verify your account." },
      { status: 201 },
    );

    try {
      const user = await prisma.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: {
            email: normalizedEmail,
            name,
            passwordHash,
          },
        });

        await tx.userGameState.create({
          data: {
            userId: u.id,
            onboardingComplete: false,
          },
        });

        return u;
      });

      if (isEmailVerificationRequired()) after(() => sendVerificationLink(user));

      return genericResponse;
    } catch (err: unknown) {
      // Unique constraint violation (P2002): the email is already taken.
      // Return the same generic response to prevent email enumeration.
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code: string }).code === "P2002"
      ) {
        return genericResponse;
      }
      throw err;
    }
  } catch (err) {
    logger.error("signup.failed", { error: String(err) });
    return NextResponse.json({ error: REQUEST_FAILED.signup }, { status: 500 });
  }
}
