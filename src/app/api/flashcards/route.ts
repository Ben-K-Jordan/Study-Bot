import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getUserId } from "@/lib/auth";
import {
  generateFlashcardsFromDocument,
  generateFlashcardsFromCourse,
  listFlashcardDecks,
} from "@/services/flashcards";
import { GatewayError } from "@/lib/ai/gateway";
import { logger } from "@/lib/logger";
import { aiLimiter, tooManyRequests } from "@/lib/rate-limit";

const generateSchema = z.object({
  course_name: z.string().min(1),
  exam_name: z.string().optional(),
  document_id: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = aiLimiter.check(userId);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterMs);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = generateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { course_name, exam_name, document_id } = parsed.data;

  try {
    const deck = document_id
      ? await generateFlashcardsFromDocument(userId, document_id)
      : await generateFlashcardsFromCourse(userId, course_name, exam_name);
    return NextResponse.json(deck, { status: 201 });
  } catch (err) {
    if (err instanceof GatewayError) {
      const status = err.code === "BUDGET_EXCEEDED" ? 429 : err.code === "AI_DISABLED" ? 503 : 502;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    if (err instanceof Error && (err.message.includes("not found") || err.message.includes("No course"))) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof Error && err.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    logger.error("flashcards.generate_failed", { userId, error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const courseName = searchParams.get("course_name") || undefined;
  const examName = searchParams.get("exam_name") || undefined;

  try {
    const decks = await listFlashcardDecks(userId, courseName, examName);
    return NextResponse.json({ decks });
  } catch (err) {
    logger.error("flashcards.list_failed", { userId, error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
