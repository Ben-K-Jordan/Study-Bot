import { NextResponse } from "next/server";
import { getUserId } from "./auth";

/** User IDs listed in ADMIN_USER_IDS (comma-separated). */
function adminUserIds(): string[] {
  return (process.env.ADMIN_USER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

/**
 * Gate for /api/admin routes. Returns the admin's user ID, or the 401/403
 * response to send back.
 *
 *   const admin = await requireAdmin(request);
 *   if ("response" in admin) return admin.response;
 */
export async function requireAdmin(
  request: Request,
): Promise<{ userId: string } | { response: NextResponse }> {
  const userId = await getUserId(request);
  if (!userId) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!adminUserIds().includes(userId)) {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { userId };
}
