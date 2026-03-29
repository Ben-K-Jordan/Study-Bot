import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { startOrResumeRun } from "@/services/run";

export async function POST(
  request: NextRequest,
  { params }: { params: { sessionId: string } }
) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await params;

  try {
    const result = await startOrResumeRun(userId, sessionId);

    if ("error" in result) {
      if (result.error === "session_not_found") {
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      }
      if (result.error === "forbidden") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (result.error === "unsupported_mode") {
        return NextResponse.json(
          { error: "This session mode is not yet supported for runs" },
          { status: 400 }
        );
      }
    }

    const status = result.data!.resumed ? 200 : 201;
    return NextResponse.json(result.data, { status });
  } catch (err) {
    console.error("Failed to start run:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
