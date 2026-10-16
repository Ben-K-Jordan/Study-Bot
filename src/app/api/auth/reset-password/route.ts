import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { forgetSessionCheck, hashPassword } from "@/lib/auth-options";
import { redeemToken, type TokenState } from "@/lib/tokens";
import { authTokenLimiter, getClientIp } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { REQUEST_FAILED } from "@/components/auth/messages";
import { invalidFields, newPasswordField, rateLimited, readJson, unreadableBody } from "../_lib/responses";

const schema = z.object({
  token: z.string().catch(""),
  password: newPasswordField,
});

/** Why a reset link didn't work, as a code the reset form turns into its own screen. */
const TOKEN_ERRORS: Record<Exclude<TokenState["status"], "valid">, { code: string; error: string }> = {
  expired: {
    code: "TOKEN_EXPIRED",
    error: "This reset link expired. Request a new link to reset your password.",
  },
  used: {
    code: "TOKEN_USED",
    error: "This reset link was already used. Request a new link to reset your password.",
  },
  invalid: {
    code: "TOKEN_INVALID",
    error: "This reset link doesn't work. Request a new link to reset your password.",
  },
};

/**
 * POST /api/auth/reset-password
 * Sets a new password with a reset token from the email link.
 *
 * 400 bodies carry either `issues` (the password field) or a `code` of
 * TOKEN_EXPIRED, TOKEN_USED or TOKEN_INVALID.
 */
export async function POST(request: NextRequest) {
  const rl = authTokenLimiter.check(getClientIp(request));
  if (!rl.allowed) return rateLimited(rl.retryAfterMs, "Too many attempts.");

  const body = await readJson(request);
  if (body === null) return unreadableBody();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return invalidFields(parsed.error);

  try {
    const state = await redeemToken(parsed.data.token, "PASSWORD_RESET");
    if (state.status !== "valid") {
      return NextResponse.json(TOKEN_ERRORS[state.status], { status: 400 });
    }

    // A new hash changes the session fingerprint (see auth-options), which
    // ends every session signed in with the old password, from its next
    // request on.
    const passwordHash = await hashPassword(parsed.data.password);
    await prisma.user.update({
      where: { id: state.userId },
      data: { passwordHash },
    });
    forgetSessionCheck(state.userId);

    logger.info("password_reset.completed", { userId: state.userId });
    return NextResponse.json({ message: "Password updated. Sign in with your new password." });
  } catch (err) {
    logger.error("password_reset.update_failed", { error: String(err) });
    return NextResponse.json({ error: REQUEST_FAILED.resetPassword }, { status: 500 });
  }
}
