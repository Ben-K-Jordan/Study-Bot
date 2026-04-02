/**
 * GET /api/mastery?course_name=X — mastery summary for a course.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getMasterySummary, getDueObjectives } from "@/lib/mastery";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const courseName = request.nextUrl.searchParams.get("course_name");
  if (!courseName) {
    return NextResponse.json({ error: "course_name query parameter required" }, { status: 400 });
  }

  try {
    const [summary, dueObjectives] = await Promise.all([
      getMasterySummary(userId, courseName),
      getDueObjectives(userId, courseName, 10),
    ]);

    return NextResponse.json({
      course_name: courseName,
      total: summary.total,
      mastered: summary.mastered,
      due: summary.due,
      due_objectives: dueObjectives.map((o) => ({
        objective_key: o.objectiveKey,
        next_due_at: o.nextDueAt?.toISOString() ?? null,
        last_accuracy: o.lastAccuracy,
        interval_days: o.intervalDays,
      })),
      objectives: summary.objectives,
    });
  } catch (err) {
    logger.error("mastery.get_failed", { userId, courseName, error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
