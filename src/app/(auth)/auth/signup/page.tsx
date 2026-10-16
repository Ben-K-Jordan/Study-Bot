import type { Metadata } from "next";

import { safeCallbackUrl } from "@/components/auth/callback-url";
import { isEmailVerificationRequired, redirectIfSignedIn, type SearchParams } from "@/components/auth/server";
import { SignUpForm } from "@/components/auth/sign-up-form";

export const metadata: Metadata = {
  title: "Create account",
};

/** /auth/signup?callbackUrl=/plan */
export default async function SignUpPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const callbackUrl = safeCallbackUrl(params.callbackUrl);
  await redirectIfSignedIn(callbackUrl);

  // Read on the server, so the form knows where a new account goes without
  // a request to /api/config after the account is created.
  return <SignUpForm callbackUrl={callbackUrl} verificationRequired={isEmailVerificationRequired()} />;
}
