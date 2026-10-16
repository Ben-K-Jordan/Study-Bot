/**
 * GET  /api/guides?course_name=&exam_name=   list guides, newest first; only
 *      the newest of each format carries `sections` (GET /api/guides/{id} for others)
 * POST /api/guides { course_name, exam_name?, guide_type }   generate one
 *
 * Error bodies carry a VOICE.md sentence in `error` and a stable `code`.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId } from "@/lib/auth";
import { GatewayError } from "@/lib/ai/gateway";
import { logger } from "@/lib/logger";
import { aiLimiter, tooManyRequests } from "@/lib/rate-limit";
import { generateStudyGuide, listStudyGuides, NoGuideMaterialsError } from "@/services/study-guides";
import { GUIDE_TYPES } from "@/lib/guide-format";
import { unauthorized } from "@/lib/http";

const generateSchema = z.object({
  course_name: z.string().trim().min(1).max(200),
  exam_name: z.string().trim().max(200).optional(),
  guide_type: z.enum(GUIDE_TYPES),
});

const listSchema = z.object({
  course_name: z.string().trim().max(200).optional(),
  exam_name: z.string().trim().max(200).optional(),
});

const AI_PAUSED = "AI features are paused. Existing decks and guides still work.";

/** Gateway failures as a status and a sentence the screen can show as is. */
function gatewayResponse(err: GatewayError) {
  switch (err.code) {
    case "AI_DISABLED":
      return { status: 503, error: AI_PAUSED };
    case "BUDGET_EXCEEDED":
      return { status: 429, error: AI_PAUSED };
    case "CIRCUIT_OPEN":
      return { status: 503, error: "The AI service failed several times in a row, so it's paused for a few minutes. Retry later." };
    case "PARSE_ERROR":
      return { status: 502, error: "The AI response couldn't be read. Retry." };
    default:
      return { status: 502, error: "The AI service didn't respond. Retry in a minute." };
  }
}

export async function POST(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return unauthorized();

  const rl = aiLimiter.check(userId);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterMs);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Guide not generated. Reload the page and retry.", code: "INVALID_JSON" },
      { status: 400 },
    );
  }

  const parsed = generateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Choose a course and a guide format.", code: "VALIDATION", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { course_name, exam_name, guide_type } = parsed.data;

  try {
    const guide = await generateStudyGuide(userId, course_name, exam_name || undefined, guide_type);
    return NextResponse.json(guide, { status: 201 });
  } catch (err) {
    if (err instanceof GatewayError) {
      const { status, error } = gatewayResponse(err);
      logger.warn("guides.generate_gateway_failed", { userId, code: err.code });
      return NextResponse.json({ error, code: err.code }, { status });
    }
    if (err instanceof NoGuideMaterialsError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 404 });
    }
    logger.error("guides.generate_failed", { userId, error: String(err) });
    return NextResponse.json({ error: "Guide not generated. Retry.", code: "INTERNAL" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return unauthorized();

  const { searchParams } = new URL(request.url);
  const parsed = listSchema.safeParse({
    course_name: searchParams.get("course_name") || undefined,
    exam_name: searchParams.get("exam_name") || undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Choose a course to see its guides.", code: "VALIDATION", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const guides = await listStudyGuides(
      userId,
      parsed.data.course_name || undefined,
      parsed.data.exam_name || undefined,
    );
    return NextResponse.json({ guides });
  } catch (err) {
    logger.error("guides.list_failed", { userId, error: String(err) });
    return NextResponse.json({ error: "Guides didn't load. Retry.", code: "INTERNAL" }, { status: 500 });
  }
}
