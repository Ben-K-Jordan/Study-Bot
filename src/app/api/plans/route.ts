import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { createPlanWithReplace } from "@/services/plan";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { dateColumnKey } from "@/lib/plan-dates";

export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json(
      { error: "Your sign-in expired. Sign in again.", code: "unauthorized" },
      { status: 401 },
    );
  }

  try {
    const plans = await prisma.studyPlan.findMany({
      where: { userId },
      include: {
        items: {
          orderBy: [{ dayIndex: "asc" }, { startTime: "asc" }],
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    // Collect all session IDs across all plans
    const allSessionIds = plans.flatMap((p) => p.items.map((i) => i.sessionId));
    const sessions = await prisma.session.findMany({
      where: { sessionId: { in: allSessionIds } },
      include: { runs: { select: { runId: true, status: true, metrics: true, endedAt: true, startedAt: true } } },
    });
    const sessionMap = new Map(sessions.map((s) => [s.sessionId, s]));

    const result = plans.map((plan) => ({
      plan_id: plan.planId,
      course_name: plan.courseName,
      exam_name: plan.examName,
      exam_date: dateColumnKey(plan.examDate),
      start_date: dateColumnKey(plan.startDate),
      end_date: dateColumnKey(plan.endDate),
      timezone: plan.timezone,
      created_at: plan.createdAt.toISOString(),
      items: plan.items.map((item) => {
        const session = sessionMap.get(item.sessionId);
        return {
          id: item.id,
          day_index: item.dayIndex,
          start_time: item.startTime.toISOString(),
          end_time: item.endTime.toISOString(),
          status: item.status,
          completed_at: item.completedAt?.toISOString() ?? null,
          missed_at: item.missedAt?.toISOString() ?? null,
          session_id: item.sessionId,
          mode: session?.mode ?? "",
          topic_scope: session?.topicScope ?? "",
          planned_minutes: session?.plannedMinutes ?? 0,
          course_name: session?.courseName ?? "",
          exam_name: session?.examName ?? "",
          runs: session?.runs ?? [],
        };
      }),
    }));

    return NextResponse.json({ plans: result }, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (err) {
    logger.error("list_plans_failed", { error: String(err) });
    return NextResponse.json(
      { error: "Plans didn't load. Retry in a minute.", code: "internal" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/plans: create a plan. With `replace_plan_id`, the replaced plan
 * is deleted only after the new one is created (see createPlanWithReplace).
 * Validation errors return `issues` whose paths name the fields
 * (course_name, exam_name, exam_date, availability, objectives).
 */
export async function POST(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json(
      { error: "Your sign-in expired. Sign in again.", code: "unauthorized" },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "The request wasn't valid JSON.", code: "invalid_json" },
      { status: 400 }
    );
  }

  try {
    const result = await createPlanWithReplace(userId, body);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Check the highlighted fields.", code: "validation_failed", issues: err.issues },
        { status: 400 }
      );
    }
    logger.error("create_plan_failed", { error: String(err) });
    return NextResponse.json(
      { error: "Plan not created. Retry in a minute.", code: "internal" },
      { status: 500 }
    );
  }
}
