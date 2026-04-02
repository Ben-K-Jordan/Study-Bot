import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getRun } from "@/services/run";
import { logger } from "@/lib/logger";

export async function GET(
  request: NextRequest,
  { params }: { params: { runId: string } }
) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { runId } = await params;

  try {
    const result = await getRun(userId, runId);

    if ("error" in result) {
      if (result.error === "not_found") {
        return NextResponse.json({ error: "Run not found" }, { status: 404 });
      }
      if (result.error === "forbidden") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    return NextResponse.json(result.data);
  } catch (err) {
    logger.error("run_get_failed", { error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
