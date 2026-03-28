/**
 * Stub auth helper. Replace with real auth (NextAuth, Clerk, etc.) later.
 * In dev, reads from X-User-Id header or falls back to a default user.
 */
export function getUserId(headers: Headers): string | null {
  return headers.get("x-user-id") || null;
}
