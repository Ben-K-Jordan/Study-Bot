import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/http";
import { getUserId } from "@/lib/auth";
import { getRunPrompt } from "@/services/run";
import { logger } from "@/lib/logger";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const userId = await getUserId(request);
  if (!userId) {
    return unauthorized();
  }

  const { runId } = await params;
  const url = new URL(request.url);
  const indexStr = url.searchParams.get("index");

  if (indexStr === null) {
    return NextResponse.json({ error: "This question isn't in the session. Reload to continue." }, { status: 400 });
  }

  const index = parseInt(indexStr, 10);
  if (isNaN(index) || index < 0) {
    return NextResponse.json({ error: "This question isn't in the session. Reload to continue." }, { status: 400 });
  }

  try {
    const result = await getRunPrompt(userId, runId, index);

    if ("error" in result) {
      if (result.error === "not_found") {
        return NextResponse.json({ error: "Session not found. It may have been deleted." }, { status: 404 });
      }
      if (result.error === "forbidden") {
        return NextResponse.json({ error: "This session belongs to another account." }, { status: 403 });
      }
      if (result.error === "invalid_index") {
        return NextResponse.json({ error: "This question isn't in the session. Reload to continue." }, { status: 400 });
      }
    }

    return NextResponse.json(result.data);
  } catch (err) {
    logger.error("run_get_prompt_failed", { error: String(err) });
    return NextResponse.json({ error: "The next question didn't load. Retry." }, { status: 500 });
  }
}
