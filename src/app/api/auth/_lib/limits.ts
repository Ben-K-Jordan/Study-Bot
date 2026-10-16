import { createRateLimiter } from "@/lib/rate-limit";

/**
 * Per-account limits for the auth routes. The per-IP limiters in
 * src/lib/rate-limit.ts stop one network; these stop many networks (or a
 * spoofed X-Forwarded-For) aimed at one account: password guessing against
 * one email, or a flood of reset and verification emails to one inbox.
 * Keys are the normalized email as typed, whether or not an account uses it,
 * so a 429 here says nothing about which accounts exist.
 */

// A development server sees every browser and test run as one client, so
// the limits there are loose enough not to lock the developer out.
const isProduction = process.env.NODE_ENV === "production";

const SIGN_IN_WINDOW_MS = 15 * 60 * 1000;

export type FailureAttempt = { allowed: true; stamp: number } | { allowed: false; retryAfterMs: number };

/**
 * A sliding-window counter of failed attempts per key. An attempt counts
 * from the moment it starts, so a burst of parallel guesses can't all slip
 * in before the first one fails; `forgive` takes it back when it turns out
 * not to be a failure (right password, unverified email, bad CSRF token).
 * Successful sign-ins therefore never use up the allowance.
 */
export function createFailureLimiter({ maxFailures, windowMs }: { maxFailures: number; windowMs: number }) {
  const failures = new Map<string, number[]>();
  let lastSweep = 0;

  function recent(key: string, now: number): number[] {
    const stamps = (failures.get(key) ?? []).filter((t) => t > now - windowMs);
    if (stamps.length > 0) failures.set(key, stamps);
    else failures.delete(key);
    return stamps;
  }

  // Keys are attacker-chosen, so drop the expired ones once per window.
  function sweep(now: number): void {
    if (now - lastSweep < windowMs) return;
    lastSweep = now;
    for (const key of [...failures.keys()]) recent(key, now);
  }

  return {
    start(key: string, now: number = Date.now()): FailureAttempt {
      sweep(now);
      const stamps = recent(key, now);
      if (stamps.length >= maxFailures) {
        return { allowed: false, retryAfterMs: Math.max(stamps[0] + windowMs - now, 0) };
      }
      stamps.push(now);
      failures.set(key, stamps);
      return { allowed: true, stamp: now };
    },

    forgive(key: string, stamp: number): void {
      const stamps = failures.get(key);
      if (!stamps) return;
      const index = stamps.indexOf(stamp);
      if (index >= 0) stamps.splice(index, 1);
      if (stamps.length === 0) failures.delete(key);
    },

    /** Forget every failure for one key (the account's password just changed). */
    clear(key: string): void {
      failures.delete(key);
    },

    /** Clear every key (tests). */
    reset(): void {
      failures.clear();
      lastSweep = 0;
    },
  };
}

/**
 * Failed sign-ins per account, from any network: 30 per 15 minutes. Three
 * times the per-IP cap, so guessing stays slow. Only wrong passwords count.
 * A browser that has signed in to the account before skips this limit (see
 * known-device.ts), so a stranger who trips it can't lock the student out of
 * their own devices; a password reset clears it.
 */
export const signInFailureLimiter = createFailureLimiter({
  maxFailures: isProduction ? 30 : 300,
  windowMs: SIGN_IN_WINDOW_MS,
});

/** Reset and verification emails per address: 5 per hour, from any network. */
export const authEmailAddressLimiter = createRateLimiter("auth-email-address", {
  maxRequests: isProduction ? 5 : 50,
  windowMs: 60 * 60 * 1000,
});

/** Longest address RFC 5321 allows; longer input can't be an account. */
const MAX_EMAIL_LENGTH = 254;

/** The limiter key for an email: trimmed, lowercased, length-capped. */
export function accountKey(email: string): string {
  return email.trim().toLowerCase().slice(0, MAX_EMAIL_LENGTH);
}

/**
 * The email from a credentials sign-in POST, read the way next-auth reads
 * it (form-encoded or JSON; the last `email` wins in a form body, as in
 * next-auth's Object.fromEntries), without consuming the body next-auth
 * reads next. Reading it any other way would let a request name one email
 * for the limiter and another for the password check.
 */
export async function readSignInEmail(request: Request): Promise<string | null> {
  const contentType = request.headers.get("content-type") ?? "";
  let email: unknown;
  try {
    if (contentType.includes("application/json")) {
      const body: unknown = await request.clone().json();
      email = (body as { email?: unknown } | null)?.email;
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      email = Object.fromEntries(new URLSearchParams(await request.clone().text())).email;
    }
  } catch {
    // An unreadable body has no email to limit; next-auth rejects it.
    return null;
  }
  return typeof email === "string" ? accountKey(email) || null : null;
}

/** next-auth's code for a wrong email or password. */
export const CREDENTIALS_SIGNIN = "CredentialsSignin";

/**
 * The `error` code a next-auth sign-in response carries, from its redirect
 * (a form post) or its JSON `url` (json=true), or null when it has none.
 */
export async function signInErrorCode(response: Response): Promise<string | null> {
  let target = response.headers.get("location");
  if (!target && (response.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      const body: unknown = await response.clone().json();
      const url = (body as { url?: unknown } | null)?.url;
      target = typeof url === "string" ? url : null;
    } catch {
      target = null;
    }
  }
  if (!target) return null;
  try {
    return new URL(target, "http://localhost").searchParams.get("error");
  } catch {
    return null;
  }
}
