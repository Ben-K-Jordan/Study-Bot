import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getFlashcardDeck, deleteFlashcardDeck } from "@/services/flashcards";
import { logger } from "@/lib/logger";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ deckId: string }> },
) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { deckId } = await params;

  const deck = await getFlashcardDeck(userId, deckId);
  if (!deck) {
    return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  }

  return NextResponse.json(deck);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ deckId: string }> },
) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { deckId } = await params;

  try {
    const deleted = await deleteFlashcardDeck(userId, deckId);
    if (!deleted) {
      return NextResponse.json({ error: "Deck not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("flashcard.delete_failed", { userId, deckId, error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
