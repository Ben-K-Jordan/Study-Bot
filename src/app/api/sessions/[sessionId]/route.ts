import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getSession } from "@/services/session";

export async function GET(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await params;
  const result = await getSession(userId, sessionId);

  if ("error" in result) {
    if (result.error === "not_found") {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (result.error === "forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  return NextResponse.json(result.data);
}
