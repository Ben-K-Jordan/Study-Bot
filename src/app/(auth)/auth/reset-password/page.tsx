import type { Metadata } from "next";

import { ResetPasswordForm, type ResetLinkProblem } from "@/components/auth/reset-password-form";
import { firstParam, type SearchParams } from "@/components/auth/server";
import { inspectToken } from "@/lib/tokens";
import { logger } from "@/lib/logger";

export const metadata: Metadata = {
  title: "Choose a new password",
};

async function linkProblem(token: string): Promise<ResetLinkProblem | null> {
  if (!token) return "invalid";
  try {
    const state = await inspectToken(token, "PASSWORD_RESET");
    return state.status === "valid" ? null : state.status;
  } catch (err) {
    // Show the form; the API checks the link again when it's submitted.
    logger.error("password_reset.inspect_failed", { error: String(err) });
    return null;
  }
}

/**
 * /auth/reset-password?token=... (the URL in the reset email; keep it).
 * Open to signed-in visitors too: a reset link must work on a device that
 * is still signed in.
 */
export default async function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const token = firstParam((await searchParams).token) ?? "";
  const problem = await linkProblem(token);
  return <ResetPasswordForm key={token} token={token} initialProblem={problem} />;
}
