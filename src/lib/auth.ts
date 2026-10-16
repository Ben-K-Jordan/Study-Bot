import { getServerSession } from "next-auth";
import { headers } from "next/headers";
import { authOptions } from "./auth-options";
import { logger } from "./logger";
import { testAuthUserId } from "./test-auth";

// One-time flag: warn loudly if the test-auth header is trusted in a
// production build (only possible with CI=true) so it can't go unnoticed.
let warnedTestAuthInProduction = false;

async function sessionUserId(): Promise<string | null> {
  try {
    const session = await getServerSession(authOptions);
    return session?.user?.id ?? null;
  } catch {
    // getServerSession can fail in certain contexts; fall through to header
    return null;
  }
}

function headerUserId(requestHeaders: Headers): string | null {
  const userId = testAuthUserId(requestHeaders);
  if (userId && process.env.NODE_ENV === "production" && !warnedTestAuthInProduction) {
    warnedTestAuthInProduction = true;
    logger.warn("auth.test_auth_active_in_production", {
      message:
        "X-User-Id header is being trusted as identity because ALLOW_TEST_AUTH=true and CI=true. This must never be enabled in a real deployment.",
    });
  }
  return userId;
}

/**
 * Get the authenticated user ID for an API request: the NextAuth session,
 * or the X-User-Id header when test auth is enabled (see lib/test-auth).
 */
export async function getUserId(request: Request): Promise<string | null> {
  return (await sessionUserId()) ?? headerUserId(request.headers);
}

/**
 * Same as getUserId, for server components that have no Request object.
 */
export async function getCurrentUserId(): Promise<string | null> {
  return (await sessionUserId()) ?? headerUserId(await headers());
}
