import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { deletePlan, getPlan } from "@/services/plan";
import { logger } from "@/lib/logger";

function unauthorized() {
  return NextResponse.json(
    { error: "Your sign-in expired. Sign in again.", code: "unauthorized" },
    { status: 401 },
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  const userId = await getUserId(request);
  if (!userId) return unauthorized();

  const { planId } = await params;

  try {
    const result = await getPlan(userId, planId);

    if ("error" in result) {
      if (result.error === "not_found") {
        return NextResponse.json(
          { error: "This plan doesn't exist anymore.", code: "not_found" },
          { status: 404 },
        );
      }
      return NextResponse.json(
        { error: "This plan belongs to another account.", code: "forbidden" },
        { status: 403 },
      );
    }

    return NextResponse.json(result.data);
  } catch (err) {
    logger.error("get_plan_failed", { plan_id: planId, error: String(err) });
    return NextResponse.json(
      { error: "The plan didn't load. Retry in a minute.", code: "internal" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/plans/{planId}[?calendar=remove]
 *
 * Deletes the plan and its items; sessions, answers and progress stay. With
 * `calendar=remove`, the plan's Google Calendar events are removed first and
 * the plan is kept (409) when any of them can't be.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  const userId = await getUserId(request);
  if (!userId) return unauthorized();

  const { planId } = await params;
  const removeCalendarEvents = request.nextUrl.searchParams.get("calendar") === "remove";

  try {
    const result = await deletePlan(userId, planId, { removeCalendarEvents });

    if ("data" in result) {
      return NextResponse.json({ success: true, ...result.data });
    }
    if (result.error === "not_found") {
      return NextResponse.json(
        { error: "This plan doesn't exist anymore.", code: "not_found" },
        { status: 404 },
      );
    }
    return NextResponse.json(
      {
        error: result.message,
        code: result.code,
        removed: result.removed,
        failed: result.failed,
      },
      { status: 409 },
    );
  } catch (err) {
    logger.error("delete_plan_failed", { plan_id: planId, error: String(err) });
    return NextResponse.json(
      { error: "Plan not deleted. Retry in a minute.", code: "internal" },
      { status: 500 },
    );
  }
}
