/**
 * SM-2 Spaced Repetition Service
 *
 * Implements the SuperMemo SM-2 algorithm for flashcard scheduling.
 * Each card review updates ease factor, interval, and next due date.
 */

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

// Rating scale matches SM-2: 0=Again, 3=Hard, 4=Good, 5=Easy
const RATING_MAP: Record<string, number> = {
  AGAIN: 0,
  HARD: 3,
  GOOD: 4,
  EASY: 5,
};

export type ReviewRating = "AGAIN" | "HARD" | "GOOD" | "EASY";

interface SM2Result {
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  nextDueAt: Date;
}

/**
 * Core SM-2 algorithm.
 * Given current card state and a quality rating, compute new scheduling.
 */
export function computeSM2(
  currentEase: number,
  currentInterval: number,
  currentReps: number,
  rating: ReviewRating,
): SM2Result {
  const q = RATING_MAP[rating];
  let ef = currentEase;
  let interval: number;
  let reps: number;

  if (q < 3) {
    // Failed — reset to learning phase
    reps = 0;
    interval = 0; // Due immediately (show again this session)
  } else {
    // Passed — update ease factor
    ef = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    if (ef < 1.3) ef = 1.3; // Floor

    if (currentReps === 0) {
      interval = 1;
      reps = 1;
    } else if (currentReps === 1) {
      interval = 6;
      reps = 2;
    } else {
      interval = Math.round(currentInterval * ef);
      reps = currentReps + 1;
    }
  }

  const nextDue = new Date();
  if (interval === 0) {
    // Due in 10 minutes for "again" cards
    nextDue.setMinutes(nextDue.getMinutes() + 10);
  } else {
    nextDue.setDate(nextDue.getDate() + interval);
    nextDue.setHours(4, 0, 0, 0); // Due at 4am next day
  }

  return {
    easeFactor: Math.round(ef * 100) / 100,
    intervalDays: interval,
    repetitions: reps,
    nextDueAt: nextDue,
  };
}

/**
 * Review a flashcard — updates SM-2 state and creates review log.
 * Returns the updated card state + whether the deck is now "perfect" (all cards reviewed correctly).
 */
export async function reviewCard(
  userId: string,
  cardId: string,
  rating: ReviewRating,
): Promise<{
  cardId: string;
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  nextDueAt: string;
  rating: string;
}> {
  // Read + compute + write inside a single interactive transaction to prevent
  // concurrent reviews from clobbering each other's SM-2 state.
  const result = await prisma.$transaction(async (tx) => {
    const card = await tx.flashcard.findUnique({
      where: { id: cardId },
      include: { deck: { select: { userId: true } } },
    });

    if (!card) throw new Error("Card not found");
    if (card.deck.userId !== userId) throw new Error("Forbidden");

    const sm2 = computeSM2(
      card.easeFactor,
      card.intervalDays,
      card.repetitions,
      rating,
    );

    await tx.flashcard.update({
      where: { id: cardId },
      data: {
        easeFactor: sm2.easeFactor,
        intervalDays: sm2.intervalDays,
        repetitions: sm2.repetitions,
        nextDueAt: sm2.nextDueAt,
      },
    });

    await tx.cardReview.create({
      data: {
        cardId,
        userId,
        rating,
        easeFactor: sm2.easeFactor,
        intervalDays: sm2.intervalDays,
        repetitions: sm2.repetitions,
      },
    });

    return sm2;
  });

  logger.info("flashcard.reviewed", {
    user_id: userId,
    card_id: cardId,
    rating,
    interval_days: result.intervalDays,
    ease_factor: result.easeFactor,
  });

  return {
    cardId,
    easeFactor: result.easeFactor,
    intervalDays: result.intervalDays,
    repetitions: result.repetitions,
    nextDueAt: result.nextDueAt.toISOString(),
    rating,
  };
}

/**
 * Get cards for a study session, ordered by priority:
 * 1. Overdue cards (nextDueAt < now) — most overdue first
 * 2. New cards (nextDueAt is null) — by ordinal
 * 3. Cards due today
 */
export async function getStudyCards(
  userId: string,
  deckId: string,
): Promise<{
  deck: { id: string; title: string; courseName: string };
  cards: {
    id: string;
    front: string;
    back: string;
    tags: string[] | null;
    ordinal: number;
    easeFactor: number;
    intervalDays: number;
    repetitions: number;
    nextDueAt: string | null;
    status: "new" | "learning" | "review" | "mastered";
  }[];
  stats: { newCount: number; learningCount: number; reviewCount: number; masteredCount: number };
}> {
  const deck = await prisma.flashcardDeck.findUnique({
    where: { id: deckId },
    include: {
      cards: { orderBy: { ordinal: "asc" } },
    },
  });

  if (!deck || deck.userId !== userId) throw new Error("Deck not found");

  const now = new Date();
  let newCount = 0;
  let learningCount = 0;
  let reviewCount = 0;
  let masteredCount = 0;

  const cards = deck.cards.map((c) => {
    let status: "new" | "learning" | "review" | "mastered";
    if (c.repetitions === 0 && !c.nextDueAt) {
      status = "new";
      newCount++;
    } else if (c.intervalDays === 0) {
      status = "learning";
      learningCount++;
    } else if (c.intervalDays >= 21) {
      status = "mastered";
      masteredCount++;
    } else {
      status = "review";
      reviewCount++;
    }

    return {
      id: c.id,
      front: c.front,
      back: c.back,
      tags: c.tags as string[] | null,
      ordinal: c.ordinal,
      easeFactor: c.easeFactor,
      intervalDays: c.intervalDays,
      repetitions: c.repetitions,
      nextDueAt: c.nextDueAt?.toISOString() ?? null,
      status,
    };
  });

  // Sort: due/overdue first, then new, then not-yet-due
  cards.sort((a, b) => {
    const aDue = a.nextDueAt ? new Date(a.nextDueAt) <= now : false;
    const bDue = b.nextDueAt ? new Date(b.nextDueAt) <= now : false;
    const aNew = a.status === "new";
    const bNew = b.status === "new";

    if (aDue && !bDue) return -1;
    if (!aDue && bDue) return 1;
    if (aDue && bDue) {
      // Most overdue first
      return new Date(a.nextDueAt!).getTime() - new Date(b.nextDueAt!).getTime();
    }
    if (aNew && !bNew) return -1;
    if (!aNew && bNew) return 1;
    return a.ordinal - b.ordinal;
  });

  return {
    deck: { id: deck.id, title: deck.title, courseName: deck.courseName },
    cards,
    stats: { newCount, learningCount, reviewCount, masteredCount },
  };
}

/**
 * Check if all cards in a deck were reviewed correctly in the current session
 * (all cards have rating != AGAIN in their most recent review today).
 */
export async function isDeckPerfect(userId: string, deckId: string): Promise<boolean> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const deck = await prisma.flashcardDeck.findUnique({
    where: { id: deckId },
    select: { cards: { select: { id: true } } },
  });

  if (!deck) return false;

  // Get today's reviews for all cards in this deck
  const reviews = await prisma.cardReview.findMany({
    where: {
      userId,
      cardId: { in: deck.cards.map((c) => c.id) },
      createdAt: { gte: today },
    },
    orderBy: { createdAt: "desc" },
  });

  // Check each card has at least one review and the latest is not AGAIN
  const latestByCard = new Map<string, string>();
  for (const r of reviews) {
    if (!latestByCard.has(r.cardId)) {
      latestByCard.set(r.cardId, r.rating);
    }
  }

  if (latestByCard.size < deck.cards.length) return false;
  return Array.from(latestByCard.values()).every((rating) => rating !== "AGAIN");
}
