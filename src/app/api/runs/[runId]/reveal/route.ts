import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getAnswerReveal } from "@/services/run";
import { logger } from "@/lib/logger";

/**
 * GET /api/runs/:runId/reveal?index=N
 *
 * Returns the model answer / key points for the current prompt so the
 * student can self-score against an explicit standard. Only valid for the
 * run's current index and never during the EXAM phase.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { runId: string } }
) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { runId } = await params;
  const indexStr = new URL(request.url).searchParams.get("index");
  const index = indexStr === null ? NaN : parseInt(indexStr, 10);
  if (Number.isNaN(index) || index < 0) {
    return NextResponse.json({ error: "index must be a non-negative integer" }, { status: 400 });
  }

  try {
    const result = await getAnswerReveal(userId, runId, index);

    if ("error" in result) {
      if (result.error === "not_found") {
        return NextResponse.json({ error: "Run not found" }, { status: 404 });
      }
      if (result.error === "forbidden") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (result.error === "wrong_phase") {
        return NextResponse.json({ error: result.message }, { status: 409 });
      }
      if (result.error === "wrong_index") {
        return NextResponse.json(
          { error: "Wrong prompt index", expected: result.expected },
          { status: 409 }
        );
      }
    }

    return NextResponse.json(result.data);
  } catch (err) {
    logger.error("run_reveal_failed", { error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
