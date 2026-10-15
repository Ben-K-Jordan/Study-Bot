/**
 * Where to send someone after they sign in. Only same-origin relative paths
 * are honoured, so a crafted link can't bounce a fresh session to another
 * site; anything else, and any auth or API path, falls back to Home.
 */

export const DEFAULT_DESTINATION = "/";

// Resolving against a placeholder origin turns tricks such as "//evil.com",
// "/\evil.com" and "https:evil.com" into a different origin we can reject.
const PLACEHOLDER_ORIGIN = "http://callback.invalid";
const MAX_LENGTH = 2048;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function safeCallbackUrl(raw: unknown): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_LENGTH) {
    return DEFAULT_DESTINATION;
  }
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return DEFAULT_DESTINATION;
  }
  if (CONTROL_CHARACTERS.test(value)) return DEFAULT_DESTINATION;

  let url: URL;
  try {
    url = new URL(value, PLACEHOLDER_ORIGIN);
  } catch {
    return DEFAULT_DESTINATION;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return DEFAULT_DESTINATION;

  const { pathname } = url;
  if (pathname === "/auth" || pathname.startsWith("/auth/") || pathname === "/api" || pathname.startsWith("/api/")) {
    return DEFAULT_DESTINATION;
  }
  return `${pathname}${url.search}${url.hash}`;
}

/** Carry a callback URL between the auth screens; Home is the default, so it's left off. */
export function withCallbackUrl(href: string, callbackUrl: string): string {
  if (callbackUrl === DEFAULT_DESTINATION) return href;
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}callbackUrl=${encodeURIComponent(callbackUrl)}`;
}
