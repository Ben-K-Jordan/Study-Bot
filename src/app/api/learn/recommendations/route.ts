/**
 * GET /api/learn/recommendations?course_name=...
 *
 * Returns mastery-driven study recommendations for a course,
 * including the best next session, overdue/weak objectives,
 * error summary, streak, and plan nudges.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { generalLimiter, tooManyRequests } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { getStudyRecommendations } from "@/services/study-recommendations";

export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = generalLimiter.check(userId);
  if (!rl.allowed) {
    return tooManyRequests(rl.retryAfterMs);
  }

  const courseName = request.nextUrl.searchParams.get("course_name");
  if (!courseName) {
    return NextResponse.json(
      { error: "course_name query parameter required" },
      { status: 400 },
    );
  }

  try {
    const recommendations = await getStudyRecommendations(userId, courseName);
    return NextResponse.json(recommendations);
  } catch (err) {
    logger.error("recommendations.fetch_failed", {
      userId,
      courseName,
      error: String(err),
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
