import { getCsrfToken } from "next-auth/react";

import {
  parseRetryAfter,
  signInFailureFromCode,
  type SignInOutcome,
} from "@/components/auth/messages";

/**
 * Credentials sign-in through next-auth's REST endpoints.
 *
 * next-auth's own signIn() throws when the callback answers without a `url`
 * (our 429 rate limit does) and never exposes the status, so a rate-limited
 * or offline attempt left the button spinning. This makes the same two
 * requests (GET /api/auth/csrf, POST /api/auth/callback/credentials with
 * json=true) and turns every answer into an outcome the form can show.
 */

/** Read the callback response. Pure, so it can be tested without a browser. */
export function interpretSignInResponse(
  httpStatus: number,
  retryAfterHeader: string | null,
  body: unknown,
): SignInOutcome {
  if (httpStatus === 429) {
    return { status: "rate-limited", retryAfterSeconds: parseRetryAfter(retryAfterHeader) };
  }

  const url = (body as { url?: unknown } | null)?.url;
  if (typeof url !== "string" || url.length === 0) return { status: "unavailable" };

  let params: URLSearchParams;
  try {
    params = new URL(url, "http://localhost").searchParams;
  } catch {
    return { status: "unavailable" };
  }
  const error = params.get("error");
  if (error) return signInFailureFromCode(error);
  // A CSRF mismatch (stale cookie, server restarted mid-request) answers
  // with the sign-in page and csrf=true but no error. Nothing was signed in.
  if (params.has("csrf")) return { status: "unavailable" };
  return httpStatus < 400 ? { status: "ok" } : { status: "unavailable" };
}

export async function signInWithCredentials({
  email,
  password,
  callbackUrl,
}: {
  email: string;
  password: string;
  callbackUrl: string;
}): Promise<SignInOutcome> {
  let csrfToken: string | undefined;
  try {
    csrfToken = await getCsrfToken();
  } catch {
    csrfToken = undefined;
  }
  if (!csrfToken) return { status: "unavailable" };

  let response: Response;
  try {
    response = await fetch("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email, password, csrfToken, callbackUrl, json: "true" }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { status: "unavailable" };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return interpretSignInResponse(response.status, response.headers.get("Retry-After"), body);
}
