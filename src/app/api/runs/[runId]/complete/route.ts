import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { completeRun } from "@/services/run";
import { logger } from "@/lib/logger";
import { generalLimiter, tooManyRequests } from "@/lib/rate-limit";
import { idSchema, internalError, sessionError } from "@/app/api/sessions/session-errors";

/** Finish a run. Idempotent: a second call returns the same result. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const userId = await getUserId(request);
  if (!userId) return sessionError("unauthorized");

  const rl = generalLimiter.check(userId);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterMs);

  const { runId } = await params;
  if (!idSchema.safeParse(runId).success) return sessionError("run_not_found");

  try {
    const result = await completeRun(userId, runId);

    if ("error" in result) {
      return sessionError(result.error === "forbidden" ? "forbidden" : "run_not_found");
    }

    return NextResponse.json(result.data);
  } catch (err) {
    logger.error("run_complete_failed", { error: String(err) });
    return internalError("Session not finished. Your answers are saved.");
  }
}
