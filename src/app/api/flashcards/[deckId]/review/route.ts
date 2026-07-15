import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { reviewCard, isDeckPerfect } from "@/services/spaced-repetition";
import { awardXp } from "@/services/gamification";
import { logger } from "@/lib/logger";

const reviewSchema = z.object({
  card_id: z.string().min(1),
  rating: z.enum(["AGAIN", "HARD", "GOOD", "EASY"]),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ deckId: string }> },
) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { deckId } = await params;
  const { card_id, rating } = parsed.data;

  try {
    // Validate the deck: it must exist, belong to this user, and contain the
    // reviewed card — otherwise the perfect-deck bonus can be farmed with
    // arbitrary deck IDs.
    const deck = await prisma.flashcardDeck.findUnique({
      where: { id: deckId },
      select: {
        userId: true,
        cards: { where: { id: card_id }, select: { id: true } },
      },
    });
    if (!deck) {
      return NextResponse.json({ error: "Deck not found" }, { status: 404 });
    }
    if (deck.userId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (deck.cards.length === 0) {
      return NextResponse.json({ error: "Card not found in deck" }, { status: 404 });
    }

    const result = await reviewCard(userId, card_id, rating);

    // Award XP for the review
    const xp = await awardXp(userId, "FLASHCARD_REVIEW", undefined, card_id);

    // Check for perfect deck bonus — awarded at most once per deck per UTC day
    let perfectBonus = 0;
    let perfectDeck = false;
    if (rating !== "AGAIN") {
      perfectDeck = await isDeckPerfect(userId, deckId);
      if (perfectDeck) {
        const utcDayStart = new Date();
        utcDayStart.setUTCHours(0, 0, 0, 0);
        const alreadyAwarded = await prisma.xpEvent.findFirst({
          where: {
            userId,
            action: "PERFECT_DECK",
            sourceId: deckId,
            createdAt: { gte: utcDayStart },
          },
          select: { id: true },
        });
        if (!alreadyAwarded) {
          const bonus = await awardXp(userId, "PERFECT_DECK", undefined, deckId);
          perfectBonus = bonus.xpAmount;
        }
      }
    }

    return NextResponse.json({
      ...result,
      xpEarned: xp.xpAmount + perfectBonus,
      perfectDeck,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Card not found") {
      return NextResponse.json({ error: "Card not found" }, { status: 404 });
    }
    if (err instanceof Error && err.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    logger.error("flashcard.review_failed", { userId, cardId: card_id, error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
