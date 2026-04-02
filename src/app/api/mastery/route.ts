/**
 * GET /api/mastery?course_name=X — mastery summary for a course.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getMasterySummary } from "@/lib/mastery";
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
    const summary = await getMasterySummary(userId, courseName);

    // Derive top-10 due objectives from the already-fetched list (avoids a second query)
    const dueObjectives = summary.objectives
      .filter((o) => o.is_due)
      .sort((a, b) => (a.next_due_at ?? "").localeCompare(b.next_due_at ?? ""))
      .slice(0, 10);

    return NextResponse.json({
      course_name: courseName,
      total: summary.total,
      mastered: summary.mastered,
      due: summary.due,
      due_objectives: dueObjectives.map((o) => ({
        objective_key: o.objective_key,
        next_due_at: o.next_due_at,
        last_accuracy: o.last_accuracy,
        interval_days: o.interval_days,
      })),
      objectives: summary.objectives,
    });
  } catch (err) {
    logger.error("mastery.get_failed", { userId, courseName, error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
