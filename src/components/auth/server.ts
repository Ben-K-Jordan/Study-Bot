import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth-options";

/** Server-side helpers for the auth pages. Import only from Server Components. */

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Someone already signed in has nothing to do on sign-in or create account:
 * send them on to where they were going. The (auth) group has no
 * loading.tsx on purpose: a Suspense boundary above the page would start
 * streaming a 200 before this runs, and the redirect would become a
 * client-side refresh instead of a 307.
 */
export async function redirectIfSignedIn(destination: string): Promise<void> {
  let signedIn = false;
  try {
    const session = await getServerSession(authOptions);
    signedIn = Boolean(session?.user);
  } catch {
    // A broken or stale session cookie means signed out for these pages.
    signedIn = false;
  }
  if (signedIn) redirect(destination);
}

export function isEmailVerificationRequired(): boolean {
  return process.env.REQUIRE_EMAIL_VERIFICATION === "true";
}
