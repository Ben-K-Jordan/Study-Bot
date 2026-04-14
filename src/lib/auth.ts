import { getServerSession } from "next-auth";
import { authOptions } from "./auth-options";

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
  if (process.env.NODE_ENV !== "production" || process.env.ALLOW_TEST_AUTH === "true") {
    const raw = request.headers.get("x-user-id");
    if (!raw) return null;
    // Handle duplicate header values (e.g. "user, user" from Playwright + client fetch)
    const first = raw.split(",")[0].trim();
    return first || null;
  }

  return null;
}
