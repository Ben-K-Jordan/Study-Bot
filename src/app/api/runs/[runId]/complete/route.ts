import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { completeRun } from "@/services/run";
import { logger } from "@/lib/logger";
import { generalLimiter, tooManyRequests } from "@/lib/rate-limit";

export async function POST(
  request: NextRequest,
  { params }: { params: { runId: string } }
) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = generalLimiter.check(userId);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterMs);

  const { runId } = await params;

  try {
    const result = await completeRun(userId, runId);

    if ("error" in result) {
      if (result.error === "not_found") {
        return NextResponse.json({ error: "Run not found" }, { status: 404 });
      }
      if (result.error === "forbidden") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.json({ error: result.error }, { status: 409 });
    }

    return NextResponse.json(result.data);
  } catch (err) {
    logger.error("run_complete_failed", { error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
