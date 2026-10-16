/**
 * SM-2 Spaced Repetition Service
 *
 * Implements the SuperMemo SM-2 algorithm for flashcard scheduling.
 * Each card review updates ease factor, interval, and next due date.
 * Intervals are exam-aware: the nearest upcoming exam for the deck's course
 * caps them (see compressIntervalForExam), so reviews finish before it.
 */

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { compressIntervalForExam } from "@/lib/spacing";
import { dateColumnValue } from "@/lib/plan-dates";
import { addDays, dayKey, zonedTimeToUtc } from "@/lib/timezone";
import { deckKind, displayDeckTitle, type DeckKind } from "@/services/deck-titles";
import { resolveTimeZone } from "@/services/gamification";

// Rating scale matches SM-2: 0=Again, 3=Hard, 4=Good, 5=Easy
const RATING_MAP: Record<string, number> = {
  AGAIN: 0,
  HARD: 3,
  GOOD: 4,
  EASY: 5,
};

export type ReviewRating = "AGAIN" | "HARD" | "GOOD" | "EASY";
export const REVIEW_RATINGS: readonly ReviewRating[] = ["AGAIN", "HARD", "GOOD", "EASY"];

/** Minutes until a card rated Again comes back (the learning step). */
export const LEARNING_STEP_MINUTES = 10;

/** Cards with an interval this long or longer count as Mastered. */
export const MASTERED_INTERVAL_DAYS = 21;

export type CardStatus = "new" | "learning" | "review" | "mastered";

/** Interval in days each rating would give a card (0 = the learning step). */
export type IntervalPreviews = Record<ReviewRating, number>;

interface SM2Result {
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  nextDueAt: Date;
}

export interface SM2Options {
  /**
   * The student's IANA time zone (resolveTimeZone). Day intervals come due
   * at 4:00 AM on the student's clock; without a zone, 4:00 AM UTC, never
   * the server's own clock.
   */
  timeZone?: string | null;
  now?: Date;
}

interface CardSchedule {
  repetitions: number;
  intervalDays: number;
  nextDueAt: Date | string | null;
}

/**
 * New: never reviewed. Learning: rated Again last time (10-minute step).
 * Mastered: an interval of 21 days or more. Everything else is in review.
 */
export function cardStatus(card: CardSchedule): CardStatus {
  if (card.repetitions === 0 && !card.nextDueAt) return "new";
  if (card.intervalDays === 0) return "learning";
  if (card.intervalDays >= MASTERED_INTERVAL_DAYS) return "mastered";
  return "review";
}

/**
 * Core SM-2 algorithm.
 * Given current card state and a quality rating, compute new scheduling.
 *
 * When `examDate` is provided, the computed interval is capped with the
 * shared exam-aware compression policy (Cepeda et al. 2008) so reviews
 * complete before the exam. Omitting it (or passing null) preserves the
 * original exam-unaware behavior.
 */
export function computeSM2(
  currentEase: number,
  currentInterval: number,
  currentReps: number,
  rating: ReviewRating,
  examDate?: Date | null,
  options: SM2Options = {},
): SM2Result {
  const now = options.now ?? new Date();
  const q = RATING_MAP[rating];
  let ef = currentEase;
  let interval: number;
  let reps: number;

  if (q < 3) {
    // Failed: reset to the learning phase
    reps = 0;
    interval = 0; // Due again in 10 minutes (the review re-queues it)
  } else {
    // Passed: update ease factor
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

  // Exam-aware compression: cap day-scale intervals so reviews finish before
  // the exam. Learning-phase cards (interval 0, due again in 10 minutes) are
  // left alone; compression only applies to intervals measured in days.
  if (interval > 0) {
    interval = compressIntervalForExam(interval, examDate, now);
  }

  let nextDue: Date;
  if (interval === 0) {
    nextDue = new Date(now.getTime() + LEARNING_STEP_MINUTES * 60 * 1000);
  } else {
    // 4:00 AM on the student's clock, `interval` calendar days from today
    const timeZone = options.timeZone || "UTC";
    nextDue = zonedTimeToUtc(addDays(dayKey(now, timeZone), interval), "04:00", timeZone);
  }

  return {
    easeFactor: Math.round(ef * 100) / 100,
    intervalDays: interval,
    repetitions: reps,
    nextDueAt: nextDue,
  };
}

/** The interval each rating would give a card, with the same exam cap. */
export function intervalPreviews(
  card: { easeFactor: number; intervalDays: number; repetitions: number },
  examDate?: Date | null,
  now: Date = new Date(),
): IntervalPreviews {
  const preview = {} as IntervalPreviews;
  for (const rating of REVIEW_RATINGS) {
    preview[rating] = computeSM2(card.easeFactor, card.intervalDays, card.repetitions, rating, examDate, {
      now,
    }).intervalDays;
  }
  return preview;
}

/** Midnight that ends today on the student's clock (UTC midnight without a zone). */
export function endOfToday(timeZone: string | null | undefined, now: Date = new Date()): Date {
  return zonedTimeToUtc(addDays(dayKey(now, timeZone), 1), "00:00", timeZone);
}

/** New cards and cards whose next review falls before today ends are due. */
export function isDueToday(card: CardSchedule, todayEnds: Date): boolean {
  if (cardStatus(card) === "new") return true;
  if (!card.nextDueAt) return false;
  return new Date(card.nextDueAt).getTime() < todayEnds.getTime();
}

export interface UpcomingExam {
  examName: string;
  examDate: Date;
}

/**
 * The exam a course's cards are scheduled toward: the deck's own exam when it
 * has one and a plan exists for it, else the course's nearest upcoming exam.
 * Exam dates are calendar dates, compared with today on the student's clock
 * (`timeZone`, else UTC): an exam today still counts, and yesterday's exam
 * no longer caps intervals, even while it's still that day in UTC.
 */
export async function findUpcomingExam(
  userId: string,
  courseName: string,
  examName?: string | null,
  now: Date = new Date(),
  timeZone?: string | null,
): Promise<UpcomingExam | null> {
  const today = dateColumnValue(dayKey(now, timeZone));
  const plans = await prisma.studyPlan.findMany({
    where: { userId, courseName, examDate: { gte: today } },
    orderBy: { examDate: "asc" },
    select: { examName: true, examDate: true },
    take: 20,
  });
  const match = (examName ? plans.find((p) => p.examName === examName) : undefined) ?? plans[0];
  return match ? { examName: match.examName, examDate: match.examDate } : null;
}

export interface ReviewResult {
  cardId: string;
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  nextDueAt: string;
  rating: string;
  status: CardStatus;
  /** Intervals for the card's next review, for a card that comes back this review. */
  previews: IntervalPreviews;
}

/**
 * Review a flashcard: updates SM-2 state and creates a review log. Intervals
 * are capped by the nearest exam for the deck's course and come due at
 * 4:00 AM in the student's time zone (resolveTimeZone, the zone streaks and
 * Study use). Pass `zone`, or the lookup already under way, to skip it.
 */
export async function reviewCard(
  userId: string,
  cardId: string,
  rating: ReviewRating,
  zone?: Promise<string> | string,
): Promise<ReviewResult> {
  const [owner, timeZone] = await Promise.all([
    prisma.flashcard.findUnique({
      where: { id: cardId },
      select: { deck: { select: { userId: true, courseName: true, examName: true } } },
    }),
    zone ?? resolveTimeZone(userId),
  ]);

  if (!owner) throw new Error("Card not found");
  if (owner.deck.userId !== userId) throw new Error("Forbidden");

  const now = new Date();
  const exam = await findUpcomingExam(userId, owner.deck.courseName, owner.deck.examName, now, timeZone);

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
      exam?.examDate ?? null,
      { timeZone, now },
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
    exam_capped: Boolean(exam),
  });

  return {
    cardId,
    easeFactor: result.easeFactor,
    intervalDays: result.intervalDays,
    repetitions: result.repetitions,
    nextDueAt: result.nextDueAt.toISOString(),
    rating,
    status: cardStatus(result),
    previews: intervalPreviews(result, exam?.examDate ?? null, now),
  };
}

export type StudyScope = "due" | "all";

export interface StudyCard {
  id: string;
  front: string;
  back: string;
  tags: string[] | null;
  ordinal: number;
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  nextDueAt: string | null;
  status: CardStatus;
  /** True for new cards and cards due before today ends. */
  due: boolean;
  previews: IntervalPreviews;
}

export interface StudyStats {
  newCount: number;
  learningCount: number;
  reviewCount: number;
  masteredCount: number;
  /** New cards plus cards due before today ends. */
  dueCount: number;
}

export interface StudyData {
  deck: {
    id: string;
    title: string;
    courseName: string;
    examName: string | null;
    kind: DeckKind;
    /** Title of the file the deck was generated from, if one. */
    sourceTitle: string | null;
  };
  cards: StudyCard[];
  /** Counts over the whole deck, whatever the scope. */
  stats: StudyStats;
  /** The exam intervals are capped for, if any. */
  exam: { name: string; date: string } | null;
  /** Earliest review after today, when nothing else is due. */
  nextDueAt: string | null;
  scope: StudyScope;
  /** The student's time zone for dates on screen (resolveTimeZone). */
  timeZone: string;
}

/** Counts per status and due today over a set of cards. */
export function deckStats(cards: CardSchedule[], todayEnds: Date): StudyStats {
  const stats: StudyStats = { newCount: 0, learningCount: 0, reviewCount: 0, masteredCount: 0, dueCount: 0 };
  for (const card of cards) {
    const status = cardStatus(card);
    if (status === "new") stats.newCount++;
    else if (status === "learning") stats.learningCount++;
    else if (status === "mastered") stats.masteredCount++;
    else stats.reviewCount++;
    if (isDueToday(card, todayEnds)) stats.dueCount++;
  }
  return stats;
}

/** Earliest next review that falls after today, or null. */
export function nextDueAfterToday(cards: CardSchedule[], todayEnds: Date): string | null {
  let earliest: number | null = null;
  for (const card of cards) {
    if (!card.nextDueAt) continue;
    const t = new Date(card.nextDueAt).getTime();
    if (t >= todayEnds.getTime() && (earliest === null || t < earliest)) earliest = t;
  }
  return earliest === null ? null : new Date(earliest).toISOString();
}

/**
 * Cards for a review, ordered by priority:
 * 1. Cards due before today ends, most overdue first
 * 2. New cards, by ordinal
 * 3. (scope "all" only) Cards not due yet, by ordinal
 */
export async function getStudyCards(
  userId: string,
  deckId: string,
  scope: StudyScope = "all",
): Promise<StudyData> {
  const [deck, timeZone] = await Promise.all([
    prisma.flashcardDeck.findUnique({
      where: { id: deckId },
      include: { cards: { orderBy: { ordinal: "asc" } }, document: { select: { title: true } } },
    }),
    resolveTimeZone(userId),
  ]);

  if (!deck || deck.userId !== userId) throw new Error("Deck not found");

  const now = new Date();
  const exam = await findUpcomingExam(userId, deck.courseName, deck.examName, now, timeZone);
  const todayEnds = endOfToday(timeZone, now);

  const cards: StudyCard[] = deck.cards.map((c) => {
    const schedule = { repetitions: c.repetitions, intervalDays: c.intervalDays, nextDueAt: c.nextDueAt };
    return {
      id: c.id,
      front: c.front,
      back: c.back,
      tags: Array.isArray(c.tags) ? (c.tags as unknown[]).filter((t): t is string => typeof t === "string") : null,
      ordinal: c.ordinal,
      easeFactor: c.easeFactor,
      intervalDays: c.intervalDays,
      repetitions: c.repetitions,
      nextDueAt: c.nextDueAt?.toISOString() ?? null,
      status: cardStatus(schedule),
      due: isDueToday(schedule, todayEnds),
      previews: intervalPreviews(c, exam?.examDate ?? null, now),
    };
  });

  const rank = (card: StudyCard) => (card.due && card.status !== "new" ? 0 : card.status === "new" ? 1 : 2);
  const ordered = cards
    .filter((card) => scope === "all" || card.due)
    .sort((a, b) => {
      const diff = rank(a) - rank(b);
      if (diff !== 0) return diff;
      if (rank(a) === 0) {
        // Most overdue first
        return new Date(a.nextDueAt!).getTime() - new Date(b.nextDueAt!).getTime();
      }
      return a.ordinal - b.ordinal;
    });

  return {
    deck: {
      id: deck.id,
      title: displayDeckTitle(deck.title, deck.courseName),
      courseName: deck.courseName,
      examName: deck.examName,
      kind: deckKind(deck.title),
      sourceTitle: deck.document?.title ?? null,
    },
    cards: ordered,
    stats: deckStats(deck.cards, todayEnds),
    exam: exam ? { name: exam.examName, date: exam.examDate.toISOString().slice(0, 10) } : null,
    nextDueAt: nextDueAfterToday(deck.cards, todayEnds),
    scope,
    timeZone,
  };
}

/**
 * Check if all cards in a deck were reviewed correctly today (all cards have
 * rating != AGAIN in their most recent review today). "Today" is the
 * student's day in `timeZone` (resolveTimeZone), the same day the streak uses.
 */
export async function isDeckPerfect(
  userId: string,
  deckId: string,
  timeZone: string = "UTC",
  now: Date = new Date(),
): Promise<boolean> {
  const today = zonedTimeToUtc(dayKey(now, timeZone), "00:00", timeZone);

  const deck = await prisma.flashcardDeck.findFirst({
    where: { id: deckId, userId },
    select: { cards: { select: { id: true } } },
  });

  // Unknown deck, another user's deck, or an empty deck is never "perfect"
  // (an empty deck would otherwise be vacuously perfect via [].every()).
  if (!deck || deck.cards.length === 0) return false;

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
