import type { Metadata } from "next";

import { parseVerifyEmailStatus, verifyEmailTitle } from "@/components/auth/link-copy";
import { firstParam, redirectIfSignedIn, type SearchParams } from "@/components/auth/server";
import { validateEmail } from "@/lib/auth-validation";
import { VerifyEmailPanel } from "@/components/auth/verify-email-panel";

const MAX_EMAIL_LENGTH = 254;

/** The tab title matches the panel's heading, so a broken link doesn't read "Verify your email". */
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const status = parseVerifyEmailStatus(firstParam((await searchParams).status));
  return { title: verifyEmailTitle(status) };
}

/**
 * /auth/verify-email?email=... after creating an account, or
 * /auth/verify-email?status=expired|invalid|busy|failed when a verification
 * link from the email didn't work (see /api/auth/verify-email).
 */
export default async function VerifyEmailPage({ searchParams }: { searchParams: SearchParams }) {
  await redirectIfSignedIn("/");
  const params = await searchParams;

  const status = parseVerifyEmailStatus(firstParam(params.status));

  // Only echo something that looks like an email address back onto the page.
  const rawEmail = firstParam(params.email)?.trim() ?? "";
  const email = rawEmail.length <= MAX_EMAIL_LENGTH && !validateEmail(rawEmail) ? rawEmail : null;

  return <VerifyEmailPanel status={status} email={email} />;
}
