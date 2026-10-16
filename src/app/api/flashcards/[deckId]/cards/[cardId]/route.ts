import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { deleteFlashcard, FlashcardError, updateFlashcard } from "@/services/flashcards";
import { logger } from "@/lib/logger";
import { generalLimiter } from "@/lib/rate-limit";
import { failed, invalidInput, invalidJson, rateLimited, unauthorized } from "../../../_lib/http";
import { cardUpdateSchema } from "../../../_lib/card-schema";

type Params = { params: Promise<{ deckId: string; cardId: string }> };

function notFound(err: FlashcardError) {
  return err.code === "CARD_NOT_FOUND"
    ? failed("This card isn't in the deck anymore. Reload to see the deck.", 404, err.code)
    : failed("This deck doesn't exist. It may have been deleted.", 404, err.code);
}

/** PATCH /api/flashcards/:deckId/cards/:cardId { front?, back? }: edits a card's text. */
export async function PATCH(request: NextRequest, { params }: Params) {
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

  const parsed = cardUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidInput(parsed.error);

  const { deckId, cardId } = await params;

  try {
    const card = await updateFlashcard(userId, deckId, cardId, parsed.data);
    return NextResponse.json({ card });
  } catch (err) {
    if (err instanceof FlashcardError) return notFound(err);
    logger.error("flashcards.card_update_failed", { userId, deckId, cardId, error: String(err) });
    return failed("Card not saved. Retry.");
  }
}

/** DELETE /api/flashcards/:deckId/cards/:cardId: deletes the card and its review history. */
export async function DELETE(request: NextRequest, { params }: Params) {
  const userId = await getUserId(request);
  if (!userId) return unauthorized();

  const { deckId, cardId } = await params;

  try {
    await deleteFlashcard(userId, deckId, cardId);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof FlashcardError) return notFound(err);
    logger.error("flashcards.card_delete_failed", { userId, deckId, cardId, error: String(err) });
    return failed("Card not deleted. Retry.");
  }
}
