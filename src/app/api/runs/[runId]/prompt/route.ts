import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getRunPrompt } from "@/services/run";
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
  const url = new URL(request.url);
  const indexStr = url.searchParams.get("index");

  if (indexStr === null) {
    return NextResponse.json({ error: "index query parameter is required" }, { status: 400 });
  }

  const index = parseInt(indexStr, 10);
  if (isNaN(index) || index < 0) {
    return NextResponse.json({ error: "index must be a non-negative integer" }, { status: 400 });
  }

  try {
    const result = await getRunPrompt(userId, runId, index);

    if ("error" in result) {
      if (result.error === "not_found") {
        return NextResponse.json({ error: "Run not found" }, { status: 404 });
      }
      if (result.error === "forbidden") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (result.error === "invalid_index") {
        return NextResponse.json({ error: "Invalid prompt index" }, { status: 400 });
      }
    }

    return NextResponse.json(result.data);
  } catch (err) {
    logger.error("run_get_prompt_failed", { error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
