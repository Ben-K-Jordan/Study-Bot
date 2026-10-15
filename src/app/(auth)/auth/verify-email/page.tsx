import type { Metadata } from "next";

import { firstParam, redirectIfSignedIn, type SearchParams } from "@/components/auth/server";
import { validateEmail } from "@/components/auth/validation";
import { VerifyEmailPanel, type VerifyEmailStatus } from "@/components/auth/verify-email-panel";

export const metadata: Metadata = {
  title: "Verify your email",
};

const LINK_STATUSES = new Set<VerifyEmailStatus>(["expired", "invalid", "busy", "failed"]);
const MAX_EMAIL_LENGTH = 254;

/**
 * /auth/verify-email?email=... after creating an account, or
 * /auth/verify-email?status=expired|invalid|busy|failed when a verification
 * link from the email didn't work (see /api/auth/verify-email).
 */
export default async function VerifyEmailPage({ searchParams }: { searchParams: SearchParams }) {
  await redirectIfSignedIn("/");
  const params = await searchParams;

  const rawStatus = firstParam(params.status) as VerifyEmailStatus | undefined;
  const status: VerifyEmailStatus = rawStatus && LINK_STATUSES.has(rawStatus) ? rawStatus : "sent";

  // Only echo something that looks like an email address back onto the page.
  const rawEmail = firstParam(params.email)?.trim() ?? "";
  const email = rawEmail.length <= MAX_EMAIL_LENGTH && !validateEmail(rawEmail) ? rawEmail : null;

  return <VerifyEmailPanel status={status} email={email} />;
}
