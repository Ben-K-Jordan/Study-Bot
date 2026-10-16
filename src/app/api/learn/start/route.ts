/**
 * POST /api/learn/start
 *
 * Starts a session from the Study screen: the recommended topics for the
 * course in the mode and length the student picked. Reuses an identical
 * session created in the last few hours that was never started, so a
 * second click or a return visit doesn't pile up empty sessions.
 *
 * Body: { course_name, exam_name?, mode, minutes }
 * 201: { session_id, url: "/s/<id>", reused }
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId } from "@/lib/auth";
import { generalLimiter, tooManyRequests } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { startStudySession, StudyStartError } from "@/services/study-recommendations";
import {
  isSessionLength,
  STUDY_MODE_KEYS,
  type SessionLength,
} from "@/lib/study-modes";
import { unauthorized } from "@/lib/http";

const startSchema = z.object({
  course_name: z.string().trim().min(1).max(200),
  exam_name: z.string().trim().min(1).max(200).optional(),
  mode: z.enum(STUDY_MODE_KEYS),
  minutes: z.custom<SessionLength>((value) => isSessionLength(value)),
});

export async function POST(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return unauthorized();

  const rl = generalLimiter.check(userId);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterMs);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Session not started. Reload the page and retry.", code: "INVALID_JSON" },
      { status: 400 },
    );
  }

  const parsed = startSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Choose a course, a mode, and a length.", code: "VALIDATION", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { course_name, exam_name, mode, minutes } = parsed.data;
  try {
    const result = await startStudySession(userId, {
      courseName: course_name,
      examName: exam_name,
      mode,
      minutes,
    });
    return NextResponse.json(result, { status: result.reused ? 200 : 201 });
  } catch (err) {
    if (err instanceof StudyStartError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === "COURSE_NOT_FOUND" ? 404 : 409 },
      );
    }
    logger.error("study.start_failed", { userId, error: String(err) });
    return NextResponse.json(
      { error: "Session not started. Retry.", code: "INTERNAL" },
      { status: 500 },
    );
  }
}
