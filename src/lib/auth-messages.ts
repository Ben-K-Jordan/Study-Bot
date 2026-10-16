import { retryAfterText } from "@/lib/format";

/**
 * Status and error copy shared by the auth screens and their API routes.
 * Every message says what didn't happen and what to do next (VOICE.md).
 */

/** "Retry in 30 seconds." / "Retry in 12 minutes." from a Retry-After value. */
export { retryAfterText };

/** Seconds from a Retry-After header, which is either delta-seconds or an HTTP date. */
export function parseRetryAfter(header: string | null | undefined, now: number = Date.now()): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.ceil((date - now) / 1000));
}

export type SignInFailure =
  | { status: "invalid" }
  | { status: "unverified" }
  | { status: "rate-limited"; retryAfterSeconds: number | null }
  | { status: "unavailable" };

export type SignInOutcome = { status: "ok" } | SignInFailure;

export const SIGN_IN_MESSAGES = {
  invalid:
    "That email and password don't match an account. Check both, or reset your password.",
  unverified:
    "Verify your email before you sign in. Open the link in your verification email, or send a new one.",
  unavailable: "Sign-in didn't go through. Check your connection and retry.",
  notAvailable: "Sign-in isn't available right now. Retry in a few minutes.",
} as const;

export function signInFailureMessage(failure: SignInFailure): string {
  switch (failure.status) {
    case "invalid":
      return SIGN_IN_MESSAGES.invalid;
    case "unverified":
      return SIGN_IN_MESSAGES.unverified;
    case "rate-limited":
      return `Too many sign-in attempts. ${retryAfterText(failure.retryAfterSeconds)}`;
    case "unavailable":
      return SIGN_IN_MESSAGES.unavailable;
  }
}

/** The thrown-error message auth-options uses for an unverified account. */
export const EMAIL_NOT_VERIFIED = "EmailNotVerified";

/**
 * Map a next-auth error code (from the callback response or the ?error=
 * query param it redirects with) to a failure. Unknown codes never reach the
 * screen as text; they read as "not available right now".
 */
export function signInFailureFromCode(code: string): SignInFailure {
  if (code === "CredentialsSignin") return { status: "invalid" };
  if (code === EMAIL_NOT_VERIFIED) return { status: "unverified" };
  return { status: "unavailable" };
}

/** Banner text for a ?error= code the sign-in page was opened with, or null to show nothing. */
export function signInErrorBanner(code: string | undefined): string | null {
  if (!code) return null;
  if (code === "CredentialsSignin") return SIGN_IN_MESSAGES.invalid;
  if (code === EMAIL_NOT_VERIFIED) return SIGN_IN_MESSAGES.unverified;
  if (code === "SessionRequired") return null;
  return SIGN_IN_MESSAGES.notAvailable;
}

export const REQUEST_FAILED = {
  signup: "Account not created. Check your connection and retry.",
  resetLink: "Reset link not sent. Check your connection and retry.",
  resetPassword: "Password not changed. Check your connection and retry.",
  verificationLink: "New link not sent. Check your connection and retry.",
} as const;

/**
 * The 503 code from the reset and verification link routes when this
 * server can't deliver email, the same for every address.
 */
export const EMAIL_NOT_CONFIGURED = "EMAIL_NOT_CONFIGURED";

export const EMAIL_NOT_CONFIGURED_MESSAGES = {
  resetLink: "Reset link not sent. Email isn't set up on this Study Bot server. Ask whoever runs the server to turn on email.",
  verificationLink: "New link not sent. Email isn't set up on this Study Bot server. Ask whoever runs the server to turn on email.",
} as const;

export function tooManyRequestsText(subject: string, seconds: number | null | undefined): string {
  return `${subject} ${retryAfterText(seconds)}`;
}
