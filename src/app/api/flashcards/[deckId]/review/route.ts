import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { reviewCard, isDeckPerfect } from "@/services/spaced-repetition";
import { awardXp, resolveTimeZone, startOfDay } from "@/services/gamification";
import { logger } from "@/lib/logger";
import { failed, invalidInput, invalidJson, unauthorized } from "../../_lib/http";

const reviewSchema = z.object({
  card_id: z.string().min(1),
  rating: z.enum(["AGAIN", "HARD", "GOOD", "EASY"]),
});

const DECK_NOT_FOUND = "This deck doesn't exist. It may have been deleted.";
const CARD_NOT_FOUND = "This card isn't in the deck anymore. Reload to continue.";

/**
 * POST /api/flashcards/:deckId/review: rates one card. The new interval is
 * capped by the course's nearest exam. Returns the card's new schedule,
 * status and next interval previews, plus XP earned.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ deckId: string }> },
) {
  const userId = await getUserId(request);
  if (!userId) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidJson();
  }

  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) return invalidInput(parsed.error, "Rate the card Again, Hard, Good, or Easy.");

  const { deckId } = await params;
  const { card_id, rating } = parsed.data;

  // The student's zone sets the card's next due date and the day the
  // perfect-deck bonus counts in. Its lookup runs alongside the deck check.
  const zone = resolveTimeZone(userId);
  zone.catch(() => {}); // awaited below; an early return must not leave it unhandled

  try {
    // Validate the deck: it must exist, belong to this user, and contain the
    // reviewed card; otherwise the perfect-deck bonus can be farmed with
    // arbitrary deck IDs.
    const deck = await prisma.flashcardDeck.findUnique({
      where: { id: deckId },
      select: {
        userId: true,
        cards: { where: { id: card_id }, select: { id: true } },
      },
    });
    if (!deck) return failed(DECK_NOT_FOUND, 404, "DECK_NOT_FOUND");
    if (deck.userId !== userId) return failed(DECK_NOT_FOUND, 403, "FORBIDDEN");
    if (deck.cards.length === 0) return failed(CARD_NOT_FOUND, 404, "CARD_NOT_FOUND");

    const result = await reviewCard(userId, card_id, rating, zone);
    const timeZone = await zone; // already settled: reviewCard waited for it

    // The review's XP and the perfect-deck check don't depend on each other.
    // The bonus is awarded at most once per deck per day, in the student's
    // time zone (the day the streak and XP today use).
    const now = new Date();
    const [xp, perfect] = await Promise.all([
      awardXp(userId, "FLASHCARD_REVIEW", undefined, card_id),
      rating === "AGAIN" ? NOT_PERFECT : perfectDeckToday(userId, deckId, timeZone, now),
    ]);
    const perfectBonus = perfect.bonusDue
      ? (await awardXp(userId, "PERFECT_DECK", undefined, deckId)).xpAmount
      : 0;

    return NextResponse.json({
      ...result,
      xpEarned: xp.xpAmount + perfectBonus,
      perfectDeck: perfect.perfectDeck,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Card not found") {
      return failed(CARD_NOT_FOUND, 404, "CARD_NOT_FOUND");
    }
    if (err instanceof Error && err.message === "Forbidden") {
      return failed(DECK_NOT_FOUND, 403, "FORBIDDEN");
    }
    logger.error("flashcard.review_failed", { userId, cardId: card_id, error: String(err) });
    return failed("Rating not saved. Retry.");
  }
}

const NOT_PERFECT = { perfectDeck: false, bonusDue: false };

/**
 * Whether every card in the deck was rated Hard or better today, and if so
 * whether today's bonus for it is still to be awarded.
 */
async function perfectDeckToday(
  userId: string,
  deckId: string,
  timeZone: string,
  now: Date,
): Promise<{ perfectDeck: boolean; bonusDue: boolean }> {
  const perfectDeck = await isDeckPerfect(userId, deckId, timeZone, now);
  if (!perfectDeck) return { perfectDeck, bonusDue: false };
  const alreadyAwarded = await prisma.xpEvent.findFirst({
    where: {
      userId,
      action: "PERFECT_DECK",
      sourceId: deckId,
      createdAt: { gte: startOfDay(now, timeZone) },
    },
    select: { id: true },
  });
  return { perfectDeck, bonusDue: !alreadyAwarded };
}
