import { createHmac, timingSafeEqual } from "crypto";

import { SECURE_COOKIES, SESSION_COOKIE_NAME } from "@/lib/auth-options";

/**
 * Known-device cookies (OWASP's "device cookies" against lockout attacks).
 *
 * The per-account sign-in limit keeps password guessing slow across many
 * networks, but anyone who knows a student's email could keep that limit
 * tripped and lock the student out, even on their own laptop. A browser
 * that has signed in to the account before carries a signed cookie naming
 * the account, and its sign-ins skip the per-account limit. The per-network
 * limit still applies, and strangers never hold the cookie, so they stay
 * capped.
 *
 * The value is `v1.<issued at, unix seconds>.<HMAC-SHA256>` over the
 * account key and the issue time, keyed with NEXTAUTH_SECRET, so it can't
 * be forged or moved to another account, and it stops counting after 90
 * days even if the browser keeps it. One cookie per browser: signing in to
 * another account replaces it. No database row, so no schema change.
 */
export const KNOWN_DEVICE_COOKIE = "sb_kd";

const VERSION = "v1";

/** 90 days. Every successful sign-in starts it again. */
export const KNOWN_DEVICE_MAX_AGE_S = 90 * 24 * 60 * 60;

// Only the sign-in endpoints read it, so no page or other API ever sees it.
const COOKIE_PATH = "/api/auth";

// A cookie issued a little "in the future" by a server whose clock moved back.
const CLOCK_SKEW_S = 5 * 60;

function signingKey(): string | null {
  return process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || null;
}

function signature(key: string, account: string, issuedAt: number): Buffer {
  return createHmac("sha256", key)
    .update(`study-bot:known-device:${VERSION}\n${account}\n${issuedAt}`)
    .digest();
}

/** The cookie value for an account key (see accountKey), or null without a secret. */
export function knownDeviceValue(account: string, now: number = Date.now()): string | null {
  const key = signingKey();
  if (!key || !account) return null;
  const issuedAt = Math.floor(now / 1000);
  return `${VERSION}.${issuedAt}.${signature(key, account, issuedAt).toString("base64url")}`;
}

/** True when `value` is an unexpired cookie this server issued for `account`. */
export function isKnownDevice(value: string | undefined, account: string, now: number = Date.now()): boolean {
  const key = signingKey();
  if (!key || !value || !account) return false;

  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [version, issued, mac] = parts;
  if (version !== VERSION || !/^\d{1,12}$/.test(issued)) return false;

  const issuedAt = Number(issued);
  const age = Math.floor(now / 1000) - issuedAt;
  if (age < -CLOCK_SKEW_S || age > KNOWN_DEVICE_MAX_AGE_S) return false;

  const expected = signature(key, account, issuedAt);
  const given = Buffer.from(mac, "base64url");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The Set-Cookie header that marks this browser as known for `account`, or null without a secret. */
export function knownDeviceCookie(account: string, now: number = Date.now()): string | null {
  const value = knownDeviceValue(account, now);
  if (!value) return null;
  return [
    `${KNOWN_DEVICE_COOKIE}=${value}`,
    `Path=${COOKIE_PATH}`,
    `Max-Age=${KNOWN_DEVICE_MAX_AGE_S}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(SECURE_COOKIES ? ["Secure"] : []),
  ].join("; ");
}

/**
 * True when a sign-in response starts a session: next-auth sets the session
 * cookie (possibly in chunks) only after the password matched.
 */
export function startsSession(response: Response): boolean {
  return response.headers.getSetCookie().some((header) => {
    const pair = header.split(";", 1)[0];
    const eq = pair.indexOf("=");
    if (eq < 0) return false;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const isSession = name === SESSION_COOKIE_NAME || name.startsWith(`${SESSION_COOKIE_NAME}.`);
    return isSession && value.length > 0;
  });
}

/** The same response with the known-device cookie added. */
export function withKnownDevice(response: Response, account: string): Response {
  const cookie = knownDeviceCookie(account);
  if (!cookie) return response;
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", cookie);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
