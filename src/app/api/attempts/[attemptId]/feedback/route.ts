import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { generateFeedback } from "@/services/feedback";
import { logger } from "@/lib/logger";

export async function GET(
  request: NextRequest,
  { params }: { params: { attemptId: string } }
) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { attemptId } = await params;

  try {
    const result = await generateFeedback(userId, attemptId);
    const payload = JSON.stringify(result);
    logger.info("feedback.response", {
      attempt_id: attemptId,
      status: result.status,
      payload_bytes: payload.length,
    });
    return NextResponse.json(result);
  } catch (err) {
    logger.error("generate_feedback_failed", { error: String(err) });
    return NextResponse.json(
      { status: "UNAVAILABLE", excerpts: [] },
      { status: 200 }
    );
  }
}
