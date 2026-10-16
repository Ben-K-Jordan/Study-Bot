import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getSessionDeckPreview } from "@/services/session";
import { idSchema, sessionError } from "../../session-errors";

/**
 * What the next run of a session will hold ("7 new, 2 due for review"), for
 * the intro after Start session again. `deck` is null when it can't be
 * predicted. Owner only; anyone else gets the same 404 as a missing session.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const userId = await getUserId(request);
  if (!userId) return sessionError("unauthorized");

  const { sessionId } = await params;
  if (!idSchema.safeParse(sessionId).success) return sessionError("session_not_found");

  const result = await getSessionDeckPreview(userId, sessionId);
  if ("error" in result) return sessionError("session_not_found");
  return NextResponse.json({ deck: result.data });
}
