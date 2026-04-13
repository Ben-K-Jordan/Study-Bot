import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getStudyCards } from "@/services/spaced-repetition";
import { logger } from "@/lib/logger";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ deckId: string }> },
) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { deckId } = await params;

  try {
    const result = await getStudyCards(userId, deckId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === "Deck not found") {
      return NextResponse.json({ error: "Deck not found" }, { status: 404 });
    }
    logger.error("flashcard.study_failed", { userId, deckId, error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
