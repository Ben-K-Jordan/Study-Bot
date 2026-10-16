import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getRun } from "@/services/run";
import { logger } from "@/lib/logger";
import { idSchema, internalError, sessionError } from "@/app/api/sessions/session-errors";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const userId = await getUserId(request);
  if (!userId) return sessionError("unauthorized");

  const { runId } = await params;
  if (!idSchema.safeParse(runId).success) return sessionError("run_not_found");

  try {
    const result = await getRun(userId, runId);

    if ("error" in result) {
      return sessionError(result.error === "forbidden" ? "forbidden" : "run_not_found");
    }

    return NextResponse.json(result.data);
  } catch (err) {
    logger.error("run_get_failed", { error: String(err) });
    return internalError("Session didn't load.");
  }
}
