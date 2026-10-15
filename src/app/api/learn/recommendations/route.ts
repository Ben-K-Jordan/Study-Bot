/**
 * GET /api/learn/recommendations?course_name=...
 *
 * The recommended next session for a course (mode, topics, reason), plus
 * overdue and weak topics, unresolved errors, the streak, today's planned
 * sessions and the course's exam.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId } from "@/lib/auth";
import { generalLimiter } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { getStudyRecommendations } from "@/services/study-recommendations";
import { tooManyRequests, unauthorized } from "../responses";

const querySchema = z.object({
  course_name: z.string().trim().min(1).max(200),
});

export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return unauthorized();

  const rl = generalLimiter.check(userId);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterMs);

  const parsed = querySchema.safeParse({
    course_name: request.nextUrl.searchParams.get("course_name") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Choose a course to see its next session.", code: "VALIDATION", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const courseName = parsed.data.course_name;
  try {
    const recommendations = await getStudyRecommendations(userId, courseName);
    return NextResponse.json(recommendations);
  } catch (err) {
    logger.error("recommendations.fetch_failed", { userId, courseName, error: String(err) });
    return NextResponse.json(
      { error: "Recommendation didn't load. Retry.", code: "INTERNAL" },
      { status: 500 },
    );
  }
}
