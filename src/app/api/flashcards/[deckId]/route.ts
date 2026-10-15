import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getDeckDetail, deleteFlashcardDeck } from "@/services/flashcards";
import { logger } from "@/lib/logger";
import { failed, unauthorized } from "../_lib/http";

const DECK_NOT_FOUND = "This deck doesn't exist. It may have been deleted.";

/**
 * GET /api/flashcards/:deckId: the deck with counts, its upcoming exam, and
 * every card with its status and next review.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ deckId: string }> },
) {
  const userId = await getUserId(request);
  if (!userId) return unauthorized();

  const { deckId } = await params;

  try {
    const deck = await getDeckDetail(userId, deckId);
    if (!deck) return failed(DECK_NOT_FOUND, 404, "DECK_NOT_FOUND");
    return NextResponse.json(deck);
  } catch (err) {
    logger.error("flashcard.deck_get_failed", { userId, deckId, error: String(err) });
    return failed("Deck didn't load. Retry");
  }
}

/** DELETE /api/flashcards/:deckId: deletes the deck, its cards and their review history. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ deckId: string }> },
) {
  const userId = await getUserId(request);
  if (!userId) return unauthorized();

  const { deckId } = await params;

  try {
    const deleted = await deleteFlashcardDeck(userId, deckId);
    if (!deleted) return failed(DECK_NOT_FOUND, 404, "DECK_NOT_FOUND");
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("flashcard.delete_failed", { userId, deckId, error: String(err) });
    return failed("Deck not deleted. Retry");
  }
}
