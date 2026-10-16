import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { forgetSessionCheck, hashPassword } from "@/lib/auth-options";
import { inspectToken, redeemToken, type TokenState } from "@/lib/tokens";
import { authTokenLimiter, getClientIp } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { REQUEST_FAILED } from "@/lib/auth-messages";
import { invalidFields, newPasswordField, rateLimited, readJson, unreadableBody } from "../_lib/responses";
import { accountKey, signInFailureLimiter } from "../_lib/limits";

const schema = z.object({
  token: z.string().catch(""),
  password: newPasswordField,
});

type LinkProblem = Exclude<TokenState["status"], "valid">;

/** Why a reset link didn't work, as a code the reset form turns into its own screen. */
const TOKEN_ERRORS: Record<LinkProblem, { code: string; error: string }> = {
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

function linkError(problem: LinkProblem): NextResponse {
  return NextResponse.json(TOKEN_ERRORS[problem], { status: 400 });
}

/**
 * POST /api/auth/reset-password
 * Sets a new password with a reset token from the email link.
 *
 * 400 bodies carry either `issues` (the password field) or a `code` of
 * TOKEN_EXPIRED, TOKEN_USED or TOKEN_INVALID. The link is used up only
 * when the new password is saved: a failure answers 500 and the same link
 * still works for a retry.
 */
export async function POST(request: NextRequest) {
  const rl = authTokenLimiter.check(getClientIp(request));
  if (!rl.allowed) return rateLimited(rl.retryAfterMs, "Too many attempts.");

  const body = await readJson(request);
  if (body === null) return unreadableBody();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return invalidFields(parsed.error);
  const { token, password } = parsed.data;

  try {
    // A read first, so a bad link costs no bcrypt work.
    const checked = await inspectToken(token, "PASSWORD_RESET");
    if (checked.status !== "valid") return linkError(checked.status);

    // Hash outside the transaction: bcrypt takes a moment, and a
    // transaction shouldn't hold a connection while it runs.
    const passwordHash = await hashPassword(password);

    // Claiming the link and saving the password commit together. If the
    // save fails, the claim rolls back and the link still works.
    const outcome = await prisma.$transaction(async (tx) => {
      const state = await redeemToken(token, "PASSWORD_RESET", tx);
      if (state.status !== "valid") return { state, email: null };
      const user = await tx.user.update({
        where: { id: state.userId },
        data: { passwordHash },
        select: { email: true },
      });
      return { state, email: user.email };
    });
    // Another request used the link between the check and the claim.
    if (outcome.state.status !== "valid") return linkError(outcome.state.status);
    const { userId } = outcome.state;

    // A new hash changes the session fingerprint (see auth-options), which
    // ends every session signed in with the old password, from its next
    // request on.
    forgetSessionCheck(userId);
    // Wrong passwords typed by someone else stop counting, so the student
    // can sign in with the new one at once.
    if (outcome.email) signInFailureLimiter.clear(accountKey(outcome.email));

    logger.info("password_reset.completed", { userId });
    return NextResponse.json({ message: "Password updated. Sign in with your new password." });
  } catch (err) {
    logger.error("password_reset.update_failed", { error: String(err) });
    return NextResponse.json({ error: REQUEST_FAILED.resetPassword }, { status: 500 });
  }
}
