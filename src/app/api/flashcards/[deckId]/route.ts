import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getFlashcardDeck } from "@/services/flashcards";

export async function GET(
  request: NextRequest,
  { params }: { params: { deckId: string } }
) {
  const userId = getUserId(request.headers);
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
