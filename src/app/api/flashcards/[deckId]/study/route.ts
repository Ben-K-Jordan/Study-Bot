import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getStudyCards } from "@/services/spaced-repetition";
import { logger } from "@/lib/logger";
import { failed, unauthorized } from "../../_lib/http";

/**
 * GET /api/flashcards/:deckId/study?scope=due|all: the cards for a review.
 * "due" (new cards and cards due before today ends) or "all" (default, the
 * whole deck). Each card carries the interval every rating would give it.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ deckId: string }> },
) {
  const userId = await getUserId(request);
  if (!userId) return unauthorized();

  const { deckId } = await params;
  const scope = request.nextUrl.searchParams.get("scope") === "due" ? "due" : "all";

  try {
    const result = await getStudyCards(userId, deckId, scope);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === "Deck not found") {
      return failed("This deck doesn't exist. It may have been deleted.", 404, "DECK_NOT_FOUND");
    }
    logger.error("flashcard.study_failed", { userId, deckId, error: String(err) });
    return failed("Cards didn't load. Retry");
  }
}
