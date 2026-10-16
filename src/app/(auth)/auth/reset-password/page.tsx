import type { Metadata } from "next";
import { cache } from "react";

import { resetPasswordTitle, type ResetLinkProblem } from "@/components/auth/link-copy";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { firstParam, type SearchParams } from "@/components/auth/server";
import { inspectToken } from "@/lib/tokens";
import { logger } from "@/lib/logger";

/**
 * Why the link can't be used, or null to show the form. Cached for the
 * request, so the tab title and the page share one token lookup.
 */
const linkProblem = cache(async (token: string): Promise<ResetLinkProblem | null> => {
  if (!token) return "invalid";
  try {
    const state = await inspectToken(token, "PASSWORD_RESET");
    return state.status === "valid" ? null : state.status;
  } catch (err) {
    // Show the form; the API checks the link again when it's submitted.
    logger.error("password_reset.inspect_failed", { error: String(err) });
    return null;
  }
});

async function tokenFrom(searchParams: SearchParams): Promise<string> {
  return firstParam((await searchParams).token) ?? "";
}

/** The tab title names the screen the link opens: the form, or why the link doesn't work. */
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  return { title: resetPasswordTitle(await linkProblem(await tokenFrom(searchParams))) };
}

/**
 * /auth/reset-password?token=... (the URL in the reset email; keep it).
 * Open to signed-in visitors too: a reset link must work on a device that
 * is still signed in.
 */
export default async function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const token = await tokenFrom(searchParams);
  const problem = await linkProblem(token);
  return <ResetPasswordForm key={token} token={token} initialProblem={problem} />;
}
