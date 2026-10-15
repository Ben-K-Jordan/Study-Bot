import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { jsonError, parseReflowBody, prepareReflow, reflowRequestSchema, summarize } from "../shared";

/**
 * POST /api/plans/{planId}/reflow/preview
 *
 * The moves a reschedule would make, without changing anything. With
 * `include_missed: true` (the Plan screen), missed sessions move as well and
 * every session must land before the exam day.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ planId: string }> },
) {
  const userId = await getUserId(req);
  if (!userId) {
    return jsonError(401, "Your sign-in expired. Sign in again.", "unauthorized");
  }

  const { planId } = await params;

  const parsed = await parseReflowBody(req, reflowRequestSchema);
  if ("response" in parsed) return parsed.response;
  const body = parsed.body;

  const prepared = await prepareReflow(userId, planId, body, "reflow.preview");
  if ("response" in prepared) return prepared.response;
  const { plan, result } = prepared;

  return NextResponse.json({
    plan_id: planId,
    reason: body.reason,
    algorithm_version: result.algorithmVersion,
    changes: result.changes,
    warnings: result.warnings,
    summary: summarize(result, plan.items.length),
  });
}
