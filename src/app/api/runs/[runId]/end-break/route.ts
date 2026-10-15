import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { endBreak } from "@/services/run";
import { logger } from "@/lib/logger";
import { idSchema, internalError, sessionError } from "@/app/api/sessions/session-errors";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const userId = await getUserId(request);
  if (!userId) return sessionError("unauthorized");

  const { runId } = await params;
  if (!idSchema.safeParse(runId).success) return sessionError("run_not_found");

  try {
    const result = await endBreak(userId, runId);

    if ("error" in result) {
      if (result.error === "forbidden") return sessionError("forbidden");
      if (result.error === "not_on_break") return sessionError("not_on_break");
      return sessionError("run_not_found");
    }

    return NextResponse.json(result.data);
  } catch (err) {
    logger.error("run_end_break_failed", { error: String(err) });
    return internalError("Break didn't end.");
  }
}
