import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { endBreak } from "@/services/run";

export async function POST(
  request: NextRequest,
  { params }: { params: { runId: string } }
) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { runId } = await params;

  try {
    const result = await endBreak(userId, runId);

    if ("error" in result) {
      if (result.error === "not_found") {
        return NextResponse.json({ error: "Run not found" }, { status: 404 });
      }
      if (result.error === "forbidden") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (result.error === "not_on_break") {
        return NextResponse.json({ error: "Not currently on break" }, { status: 409 });
      }
    }

    return NextResponse.json(result.data);
  } catch (err) {
    console.error("Failed to end break:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
