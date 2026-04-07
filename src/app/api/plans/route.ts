import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { createPlan } from "@/services/plan";
import { prisma } from "@/lib/db";
import { z } from "zod/v4";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
      exam_date: plan.examDate.toISOString().split("T")[0],
      start_date: plan.startDate.toISOString().split("T")[0],
      end_date: plan.endDate.toISOString().split("T")[0],
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
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  try {
    const result = await createPlan(userId, body);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", issues: err.issues },
        { status: 400 }
      );
    }
    logger.error("create_plan_failed", { error: String(err) });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
