import type { Metadata } from "next";

import { safeCallbackUrl } from "@/components/auth/callback-url";
import { signInErrorBanner } from "@/lib/auth-messages";
import { firstParam, redirectIfSignedIn, type SearchParams } from "@/components/auth/server";
import { SignInForm } from "@/components/auth/sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
};

/**
 * /auth/signin?callbackUrl=/plan&verified=true&error=CredentialsSignin
 * (?account=deleted after deleting an account in Settings)
 * callbackUrl is honoured only as a same-origin path; error codes from
 * next-auth are shown in plain words, never as the raw code.
 */
export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const callbackUrl = safeCallbackUrl(params.callbackUrl);
  await redirectIfSignedIn(callbackUrl);

  return (
    <SignInForm
      callbackUrl={callbackUrl}
      verified={firstParam(params.verified) === "true"}
      accountDeleted={firstParam(params.account) === "deleted"}
      initialError={signInErrorBanner(firstParam(params.error))}
    />
  );
}
