import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { startOrResumeRun } from "@/services/run";
import { logger } from "@/lib/logger";
import { idSchema, internalError, sessionError } from "../../../session-errors";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const userId = await getUserId(request);
  if (!userId) return sessionError("unauthorized");

  const { sessionId } = await params;
  if (!idSchema.safeParse(sessionId).success) return sessionError("session_not_found");

  try {
    const result = await startOrResumeRun(userId, sessionId);

    if ("error" in result) {
      if (result.error === "forbidden") return sessionError("forbidden");
      if (result.error === "unsupported_mode") return sessionError("unsupported_mode");
      return sessionError("session_not_found");
    }

    const httpStatus = result.data!.resumed ? 200 : 201;
    const payload = JSON.stringify(result.data);
    logger.info("run.start.response", {
      session_id: sessionId,
      run_id: result.data!.run_id,
      payload_bytes: payload.length,
      resumed: result.data!.resumed,
    });
    return new NextResponse(payload, {
      status: httpStatus,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    logger.error("run_start_failed", { error: String(err) });
    return internalError("Session not started.");
  }
}
