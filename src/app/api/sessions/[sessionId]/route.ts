import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getSession } from "@/services/session";
import { idSchema, sessionError } from "../session-errors";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const userId = await getUserId(request);
  if (!userId) return sessionError("unauthorized");

  const { sessionId } = await params;
  if (!idSchema.safeParse(sessionId).success) return sessionError("session_not_found");

  const result = await getSession(userId, sessionId);

  if ("error" in result) {
    return sessionError(result.error === "forbidden" ? "forbidden" : "session_not_found");
  }

  return NextResponse.json(result.data);
}
