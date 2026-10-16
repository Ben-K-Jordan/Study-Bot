/**
 * GET /api/learn
 *
 * Per-course counts for the Study screen: materials (ready, processing,
 * couldn't be read), decks and cards due, and guides.
 */
import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { getStudyCourses } from "@/services/study-recommendations";
import { unauthorized } from "@/lib/http";

export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return unauthorized();

  try {
    const courses = await getStudyCourses(userId);
    return NextResponse.json({ courses, hasCourses: courses.length > 0 });
  } catch (err) {
    logger.error("learn.fetch_failed", { userId, error: String(err) });
    return NextResponse.json(
      { error: "Courses didn't load. Retry.", code: "INTERNAL" },
      { status: 500 },
    );
  }
}
