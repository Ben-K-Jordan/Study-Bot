/**
 * Test-only authentication: the e2e suite identifies users with an
 * X-User-Id header instead of signing in.
 *
 * The header is trusted only when ALLOW_TEST_AUTH=true, never in a
 * production build unless CI=true (CI runs the e2e suite against
 * `next start`), and only while the app's own address (NEXTAUTH_URL) is on
 * this machine. A deployment always has a public NEXTAUTH_URL, so a stray
 * ALLOW_TEST_AUTH there can't open it to anyone who sends the header.
 * Anywhere else the header is ignored.
 *
 * Servers started with test auth should also listen on loopback only
 * (`next dev -H 127.0.0.1`), since the header carries no secret.
 */

/** localhost, *.localhost, 127.0.0.0/8 and ::1 (URL.hostname keeps IPv6 brackets). */
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}

/**
 * True when NEXTAUTH_URL names this machine. Without one, only a development
 * server qualifies: next-auth then uses the request's own host, and a
 * production build needs the variable anyway.
 */
function appUrlIsLocal(): boolean {
  const raw = process.env.NEXTAUTH_URL;
  if (!raw) return process.env.NODE_ENV !== "production";
  try {
    return isLoopbackHost(new URL(raw).hostname);
  } catch {
    return false;
  }
}

export function isTestAuthEnabled(): boolean {
  if (process.env.ALLOW_TEST_AUTH !== "true") return false;
  if (process.env.NODE_ENV === "production" && process.env.CI !== "true") return false;
  return appUrlIsLocal();
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
