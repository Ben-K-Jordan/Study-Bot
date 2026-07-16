import { getServerSession } from "next-auth";
import { authOptions } from "./auth-options";
import { logger } from "./logger";

// One-time flag: warn loudly if the test-auth header path is exercised in a
// production build (ALLOW_TEST_AUTH=true) so it can't be silently left on.
let warnedTestAuthInProduction = false;

/**
 * Get the authenticated user ID from the NextAuth session.
 * Falls back to the X-User-Id header for backward compatibility / testing.
 */
export async function getUserId(request: Request): Promise<string | null> {
  // Try NextAuth session first (reads cookie automatically)
  try {
    const session = await getServerSession(authOptions);
    if (session?.user?.id) return session.user.id;
  } catch {
    // getServerSession can fail in certain contexts; fall through to header
  }

  // Fallback: X-User-Id header — ONLY in non-production or explicit test mode
  if (process.env.ALLOW_TEST_AUTH === "true") {
    const raw = request.headers.get("x-user-id");
    if (!raw) return null;
    if (
      process.env.NODE_ENV === "production" &&
      process.env.ALLOW_TEST_AUTH === "true" &&
      !warnedTestAuthInProduction
    ) {
      warnedTestAuthInProduction = true;
      logger.warn("auth.test_auth_active_in_production", {
        message:
          "X-User-Id header is being trusted as identity because ALLOW_TEST_AUTH=true. This must never be enabled in a real deployment.",
      });
    }
    // Handle duplicate header values (e.g. "user, user" from Playwright + client fetch)
    const first = raw.split(",")[0].trim();
    return first || null;
  }

  return null;
}
