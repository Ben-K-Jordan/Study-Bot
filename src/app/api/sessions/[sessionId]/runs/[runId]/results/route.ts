import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getSessionResults } from "@/services/session";
import { logger } from "@/lib/logger";
import { idSchema, internalError, sessionError } from "../../../../session-errors";

/**
 * Results of one finished run of a session: stats, rated answers for the
 * confidence chart, and follow-up dates from the scheduler. Owner only.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; runId: string }> }
) {
  const userId = await getUserId(request);
  if (!userId) return sessionError("unauthorized");

  const { sessionId, runId } = await params;
  if (!idSchema.safeParse(sessionId).success || !idSchema.safeParse(runId).success) {
    return sessionError("run_not_found");
  }

  try {
    const result = await getSessionResults(userId, sessionId, runId);
    if ("error" in result) {
      if (result.error === "forbidden") return sessionError("forbidden");
      if (result.error === "not_completed") return sessionError("run_not_completed");
      return sessionError("run_not_found");
    }
    return NextResponse.json(result.data);
  } catch (err) {
    logger.error("session_results_failed", { error: String(err), run_id: runId });
    return internalError("Results didn't load.");
  }
}
