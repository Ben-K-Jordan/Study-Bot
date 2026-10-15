import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId } from "@/lib/auth";
import {
  FlashcardError,
  generateFlashcardsFromDocument,
  generateFlashcardsFromCourse,
  listFlashcardDecks,
} from "@/services/flashcards";
import { GatewayError } from "@/lib/ai/gateway";
import { logger } from "@/lib/logger";
import { aiLimiter } from "@/lib/rate-limit";
import {
  failed,
  gatewayFailure,
  invalidInput,
  invalidJson,
  rateLimited,
  unauthorized,
} from "./_lib/http";

const generateSchema = z.object({
  course_name: z.string().trim().min(1).max(200),
  exam_name: z.string().trim().max(200).optional(),
  document_id: z.string().min(1).max(100).optional(),
});

const NOT_GENERATED = "Deck not generated. Retry";

/**
 * POST /api/flashcards: generate a deck with AI from a course's processed
 * materials (or one file with document_id). 201 with the deck.
 */
export async function POST(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return unauthorized();

  const rl = aiLimiter.check(userId);
  if (!rl.allowed) return rateLimited(rl.retryAfterMs);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidJson();
  }

  const parsed = generateSchema.safeParse(body);
  if (!parsed.success) return invalidInput(parsed.error, "Choose a course to generate a deck for.");

  const { course_name, exam_name, document_id } = parsed.data;

  try {
    const deck = document_id
      ? await generateFlashcardsFromDocument(userId, document_id)
      : await generateFlashcardsFromCourse(userId, course_name, exam_name || undefined);
    return NextResponse.json(deck, { status: 201 });
  } catch (err) {
    if (err instanceof GatewayError) return gatewayFailure(err, NOT_GENERATED);
    if (err instanceof FlashcardError) {
      switch (err.code) {
        case "NO_MATERIALS":
          return failed(`Upload materials for ${course_name} first. Decks are generated from them.`, 404, err.code);
        case "MATERIALS_PROCESSING":
          return failed(
            `Your ${course_name} materials are still processing. Generate the deck when they're ready.`,
            409,
            err.code,
          );
        case "NO_CARDS":
          return failed(`No cards came out of your ${course_name} materials. Retry, or upload more materials.`, 502, err.code);
        case "DOC_NOT_FOUND":
        case "FORBIDDEN":
          return failed("That file isn't in your materials.", 404, err.code);
        case "DOC_NOT_READY":
          return failed("That file is still processing. Generate the deck when it's ready.", 409, err.code);
      }
    }
    logger.error("flashcards.generate_failed", { userId, error: String(err) });
    return failed(NOT_GENERATED);
  }
}

/**
 * GET /api/flashcards?course_name=&exam_name=: decks with counts per status
 * and due today. Filtering by course only (no exam) matches /api/learn.
 */
export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return unauthorized();

  const { searchParams } = new URL(request.url);
  const courseName = searchParams.get("course_name") || undefined;
  const examName = searchParams.get("exam_name") || undefined;

  try {
    const decks = await listFlashcardDecks(userId, courseName, examName);
    return NextResponse.json({ decks });
  } catch (err) {
    logger.error("flashcards.list_failed", { userId, error: String(err) });
    return failed("Decks didn't load. Retry");
  }
}
