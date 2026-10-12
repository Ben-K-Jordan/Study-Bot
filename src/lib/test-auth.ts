/**
 * Test-only authentication: the e2e suite identifies users with an
 * X-User-Id header instead of signing in.
 *
 * The header is trusted only when ALLOW_TEST_AUTH=true, and never in a
 * production build unless CI=true (CI runs the e2e suite against
 * `next start`). Anywhere else the header is ignored.
 */

export function isTestAuthEnabled(): boolean {
  if (process.env.ALLOW_TEST_AUTH !== "true") return false;
  return process.env.NODE_ENV !== "production" || process.env.CI === "true";
}

/** The user named by the X-User-Id header, when test auth is enabled. */
export function testAuthUserId(headers: Headers): string | null {
  if (!isTestAuthEnabled()) return null;
  const raw = headers.get("x-user-id");
  if (!raw) return null;
  // Duplicate header values arrive joined ("user, user") when both
  // Playwright and the page set the header.
  return raw.split(",")[0].trim() || null;
}
