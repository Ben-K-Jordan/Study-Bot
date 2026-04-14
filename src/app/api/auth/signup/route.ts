import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { signupLimiter, getClientIp, tooManyRequests } from "@/lib/rate-limit";
import { createEmailVerificationToken } from "@/lib/tokens";
import { emailProvider } from "@/lib/email/provider";
import { emailVerification } from "@/lib/email/templates";
import { logger } from "@/lib/logger";

const signupSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1, "Name is required").max(50),
});

/**
 * POST /api/auth/signup
 *
 * Always returns the same shaped response whether the email is new or taken,
 * to prevent email enumeration. A verification email is sent if the account
 * is newly created.
 */
export async function POST(request: Request) {
  const rl = signupLimiter.check(getClientIp(request as any));
  if (!rl.allowed) return tooManyRequests(rl.retryAfterMs);

  try {
    const body = await request.json();
    const { email, password, name } = signupSchema.parse(body);

    const normalizedEmail = email.toLowerCase().trim();
    const passwordHash = await bcrypt.hash(password, 12);

    // Generic response — same whether account is new or already exists
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

        await tx.notificationPreference.create({
          data: { userId: u.id },
        });

        await tx.userGameState.create({
          data: {
            userId: u.id,
            displayName: name,
            onboardingComplete: false,
          },
        });

        return u;
      });

      // Send verification email (non-blocking — don't let email failures break signup)
      try {
        const token = await createEmailVerificationToken(user.id);
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        const verifyUrl = `${appUrl}/api/auth/verify-email?token=${token}`;
        const { subject, html } = emailVerification(user.name || "there", verifyUrl);
        await emailProvider.send(user.email, subject, html);
        logger.info("signup.verification_email_sent", { userId: user.id });
      } catch (emailErr) {
        logger.error("signup.verification_email_failed", {
          userId: user.id,
          error: String(emailErr),
        });
      }

      return genericResponse;
    } catch (err: unknown) {
      // Unique constraint violation (P2002) — email already taken.
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
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0].message },
        { status: 400 },
      );
    }
    logger.error("signup.failed", { error: String(err) });
    return NextResponse.json(
      { error: "Failed to create account" },
      { status: 500 },
    );
  }
}
