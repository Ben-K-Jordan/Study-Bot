import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { addFlashcard, FlashcardError } from "@/services/flashcards";
import { logger } from "@/lib/logger";
import { generalLimiter } from "@/lib/rate-limit";
import { failed, invalidInput, invalidJson, rateLimited, unauthorized } from "../../_lib/http";
import { cardCreateSchema } from "../../_lib/card-schema";

/** POST /api/flashcards/:deckId/cards { front, back }: adds a card at the end of the deck. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ deckId: string }> },
) {
  const userId = await getUserId(request);
  if (!userId) return unauthorized();

  const rl = generalLimiter.check(userId);
  if (!rl.allowed) return rateLimited(rl.retryAfterMs);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidJson();
  }

  const parsed = cardCreateSchema.safeParse(body);
  if (!parsed.success) return invalidInput(parsed.error);

  const { deckId } = await params;

  try {
    const card = await addFlashcard(userId, deckId, parsed.data);
    return NextResponse.json({ card }, { status: 201 });
  } catch (err) {
    if (err instanceof FlashcardError && err.code === "DECK_NOT_FOUND") {
      return failed("This deck doesn't exist. It may have been deleted.", 404, err.code);
    }
    logger.error("flashcards.card_add_failed", { userId, deckId, error: String(err) });
    return failed("Card not added. Retry");
  }
}
