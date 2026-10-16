import { prisma } from "@/lib/db";
import { runTask, type GatewayContext } from "@/lib/ai/gateway";
import { AiTask } from "@/lib/ai/types";
import { getPrompt } from "@/lib/ai/prompt-registry";
import { createProvider } from "@/lib/ai/provider-factory";
import { logger } from "@/lib/logger";
import { sampleEvenly } from "@/lib/config";
import { deckKind, displayDeckTitle, type DeckKind } from "@/services/deck-titles";
import { resolveTimeZone } from "@/services/gamification";
import { dateColumnKey } from "@/lib/plan-dates";
import { dayKey } from "@/lib/timezone";
import {
  cardStatus,
  deckStats,
  endOfToday,
  findUpcomingExam,
  isDueToday,
  nextDueAfterToday,
  type CardStatus,
  type StudyStats,
} from "@/services/spaced-repetition";

interface FlashcardGenerated {
  front: string;
  back: string;
  tags?: string[];
}

export interface FlashcardData {
  id: string;
  front: string;
  back: string;
  tags: string[] | null;
  ordinal: number;
}

export interface FlashcardDeckData {
  id: string;
  user_id: string;
  course_name: string;
  exam_name: string | null;
  document_id: string | null;
  title: string;
  card_count: number;
  cards?: FlashcardData[];
  created_at: string;
}

export interface DeckSummaryData extends FlashcardDeckData {
  kind: DeckKind;
  /** Title of the file the deck was generated from, if one. */
  source_title: string | null;
  counts: StudyStats;
  /** Earliest review after today, when nothing is due. */
  next_due_at: string | null;
}

/** Limits for a card's two sides, shared with the API validation. */
export const CARD_FRONT_MAX = 1000;
export const CARD_BACK_MAX = 4000;
/** Cards kept from one generation. */
const MAX_GENERATED_CARDS = 40;

export type FlashcardErrorCode =
  | "NO_MATERIALS"
  | "MATERIALS_PROCESSING"
  | "NO_CARDS"
  | "DOC_NOT_FOUND"
  | "DOC_NOT_READY"
  | "DECK_NOT_FOUND"
  | "CARD_NOT_FOUND"
  | "FORBIDDEN";

/** A failure the API maps to a status and a sentence for the student. */
export class FlashcardError extends Error {
  constructor(
    public readonly code: FlashcardErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FlashcardError";
  }
}

const FLASHCARD_MODEL = process.env.AI_MODEL_ANSWER || "gpt-4o-mini";

// ---------------------------------------------------------------------------
// Titles
// ---------------------------------------------------------------------------

export { deckKind, displayDeckTitle, type DeckKind } from "@/services/deck-titles";

/** The base title plus " (2)", " (3)" when the course already has it (titles are unique per course). */
async function uniqueDeckTitle(
  tx: Pick<typeof prisma, "flashcardDeck">,
  userId: string,
  courseName: string,
  base: string,
): Promise<string> {
  const existing = await tx.flashcardDeck.findMany({
    where: { userId, courseName, title: { startsWith: base } },
    select: { title: true },
  });
  const taken = new Set(existing.map((d) => d.title));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base} (${n})`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} (${Date.now()})`;
}

/** Drops malformed AI cards and trims the rest to the field limits. */
export function cleanGeneratedCards(raw: unknown): FlashcardGenerated[] {
  if (!Array.isArray(raw)) return [];
  const cards: FlashcardGenerated[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { front, back, tags } = item as Record<string, unknown>;
    if (typeof front !== "string" || typeof back !== "string") continue;
    const f = front.trim();
    const b = back.trim();
    if (!f || !b) continue;
    cards.push({
      front: f.slice(0, CARD_FRONT_MAX),
      back: b.slice(0, CARD_BACK_MAX),
      tags: Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string").slice(0, 6) : undefined,
    });
    if (cards.length >= MAX_GENERATED_CARDS) break;
  }
  return cards;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * Compute mastery context for adaptive flashcard generation.
 * Analyzes existing card reviews to identify weak/strong areas.
 */
async function computeMasteryContext(
  userId: string,
  courseName: string,
): Promise<string | undefined> {
  const decks = await prisma.flashcardDeck.findMany({
    where: { userId, courseName },
    include: {
      cards: {
        select: {
          id: true,
          tags: true,
          easeFactor: true,
          intervalDays: true,
          repetitions: true,
          reviews: {
            select: { rating: true },
            orderBy: { createdAt: "desc" },
            take: 5,
          },
        },
      },
    },
  });

  const allCards = decks.flatMap((d) => d.cards);
  if (allCards.length === 0) return undefined;

  // Aggregate by tag
  const tagStats = new Map<string, { total: number; avgEase: number; againCount: number; reviewCount: number; masteredCount: number }>();

  for (const card of allCards) {
    const tags = (card.tags as string[] | null) || ["general"];
    const recentRatings = card.reviews.map((r) => r.rating);
    const againCount = recentRatings.filter((r) => r === "AGAIN").length;

    for (const tag of tags) {
      const existing = tagStats.get(tag) || { total: 0, avgEase: 0, againCount: 0, reviewCount: 0, masteredCount: 0 };
      existing.total++;
      existing.avgEase += card.easeFactor;
      existing.againCount += againCount;
      existing.reviewCount += recentRatings.length;
      if (card.intervalDays >= 21) existing.masteredCount++;
      tagStats.set(tag, existing);
    }
  }

  // Build context string
  const lines: string[] = [];
  lines.push(`Total cards reviewed: ${allCards.filter((c) => c.repetitions > 0).length}/${allCards.length}`);

  const weakTopics: string[] = [];
  const strongTopics: string[] = [];

  for (const [tag, stats] of tagStats) {
    const avgEase = stats.avgEase / stats.total;
    const masteryPct = Math.round((stats.masteredCount / stats.total) * 100);
    const againRate = stats.reviewCount > 0 ? Math.round((stats.againCount / stats.reviewCount) * 100) : 0;

    if (avgEase < 2.0 || againRate > 40) {
      weakTopics.push(`${tag} (avg ease: ${avgEase.toFixed(1)}, ${againRate}% again rate, ${masteryPct}% mastered)`);
    } else if (masteryPct >= 70) {
      strongTopics.push(`${tag} (${masteryPct}% mastered, avg ease: ${avgEase.toFixed(1)})`);
    }
  }

  if (weakTopics.length > 0) {
    lines.push(`Weak areas (need more practice): ${weakTopics.join("; ")}`);
  }
  if (strongTopics.length > 0) {
    lines.push(`Strong areas: ${strongTopics.join("; ")}`);
  }

  return lines.length > 1 ? lines.join("\n") : undefined;
}

async function runGeneration(
  userId: string,
  input: { title: string; courseName: string; examName?: string; chunkTexts: string[] },
): Promise<FlashcardGenerated[]> {
  const masteryContext = await computeMasteryContext(userId, input.courseName);
  const ctx: GatewayContext = { userId, provider: createProvider() };
  const prompt = getPrompt(AiTask.GENERATE_FLASHCARDS);

  // Output with no usable card fails the parse, so the gateway doesn't
  // cache it and Retry asks the model again instead of replaying the same
  // empty list for an hour.
  let noCards = false;
  try {
    const result = await runTask<{ cards: FlashcardGenerated[] }>(ctx, {
      task: AiTask.GENERATE_FLASHCARDS,
      promptVersion: prompt.version,
      model: FLASHCARD_MODEL,
      input: { ...input, masteryContext },
      parseOutput: (raw: unknown) => {
        const cards = cleanGeneratedCards((raw as Record<string, unknown> | null)?.cards);
        if (cards.length === 0) {
          noCards = true;
          throw new Error("No usable cards in the output");
        }
        return { cards };
      },
    });
    return result.output.cards;
  } catch (err) {
    if (noCards) throw new FlashcardError("NO_CARDS", "The materials produced no cards.");
    throw err;
  }
}

async function saveGeneratedDeck(
  userId: string,
  deck: { courseName: string; examName: string | null; documentId: string | null; baseTitle: string },
  cards: FlashcardGenerated[],
) {
  return prisma.$transaction(async (tx) => {
    const title = await uniqueDeckTitle(tx, userId, deck.courseName, deck.baseTitle);
    const newDeck = await tx.flashcardDeck.create({
      data: {
        userId,
        courseName: deck.courseName,
        examName: deck.examName,
        documentId: deck.documentId,
        title,
        cardCount: cards.length,
      },
    });

    await tx.flashcard.createMany({
      data: cards.map((card, i) => ({
        deckId: newDeck.id,
        front: card.front,
        back: card.back,
        tags: card.tags && card.tags.length > 0 ? card.tags : undefined,
        ordinal: i,
      })),
    });

    return newDeck;
  });
}

function toDeckData(
  deck: { id: string; userId: string; courseName: string; examName: string | null; documentId: string | null; title: string; cardCount: number; createdAt: Date },
  cards: FlashcardGenerated[],
): FlashcardDeckData {
  return {
    id: deck.id,
    user_id: deck.userId,
    course_name: deck.courseName,
    exam_name: deck.examName,
    document_id: deck.documentId,
    title: deck.title,
    card_count: deck.cardCount,
    cards: cards.map((card, i) => ({
      id: `pending-${i}`,
      front: card.front,
      back: card.back,
      tags: card.tags || null,
      ordinal: i,
    })),
    created_at: deck.createdAt.toISOString(),
  };
}

/**
 * Generate flashcards from a specific document's chunks.
 */
export async function generateFlashcardsFromDocument(
  userId: string,
  documentId: string,
): Promise<FlashcardDeckData> {
  const doc = await prisma.contentDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      userId: true,
      title: true,
      courseName: true,
      examName: true,
      status: true,
    },
  });

  if (!doc) throw new FlashcardError("DOC_NOT_FOUND", "Document not found");
  if (doc.userId !== userId) throw new FlashcardError("FORBIDDEN", "Forbidden");
  if (doc.status !== "PROCESSED" || !doc.courseName) {
    throw new FlashcardError("DOC_NOT_READY", "Document not yet processed");
  }

  const allChunks = await prisma.contentChunk.findMany({
    where: { documentId },
    orderBy: { ordinal: "asc" },
    select: { text: true },
  });

  if (allChunks.length === 0) {
    throw new FlashcardError("DOC_NOT_READY", "No content chunks found for this document");
  }

  const cards = await runGeneration(userId, {
    title: doc.title,
    courseName: doc.courseName,
    examName: doc.examName || undefined,
    chunkTexts: sampleEvenly(allChunks, 12).map((c) => c.text),
  });

  const deck = await saveGeneratedDeck(
    userId,
    { courseName: doc.courseName, examName: doc.examName || null, documentId, baseTitle: doc.title },
    cards,
  );

  logger.info("flashcards.generated", {
    user_id: userId,
    deck_id: deck.id,
    document_id: documentId,
    card_count: cards.length,
  });

  return toDeckData(deck, cards);
}

/**
 * Generate flashcards from all processed documents in a course (and exam).
 */
export async function generateFlashcardsFromCourse(
  userId: string,
  courseName: string,
  examName?: string,
): Promise<FlashcardDeckData> {
  const docWhere: Record<string, unknown> = {
    userId,
    namespace: "COURSE",
    courseName,
    status: "PROCESSED",
  };
  if (examName) docWhere.examName = examName;

  // Cap fetch to avoid loading unbounded chunks into memory
  const allChunks = await prisma.contentChunk.findMany({
    where: { document: { is: docWhere } },
    orderBy: [{ documentId: "asc" }, { ordinal: "asc" }],
    select: { text: true },
    take: 200,
  });

  if (allChunks.length === 0) {
    // Tell "nothing uploaded" apart from "uploaded, still processing".
    const uploaded = await prisma.contentDocument.count({
      where: { userId, namespace: "COURSE", courseName, ...(examName ? { examName } : {}) },
    });
    throw uploaded > 0
      ? new FlashcardError("MATERIALS_PROCESSING", "Course materials are still processing")
      : new FlashcardError("NO_MATERIALS", "No course materials found");
  }

  const cards = await runGeneration(userId, {
    title: courseName,
    courseName,
    examName,
    chunkTexts: sampleEvenly(allChunks, 15).map((c) => c.text),
  });

  const deck = await saveGeneratedDeck(
    userId,
    {
      courseName,
      examName: examName || null,
      documentId: null,
      baseTitle: `All ${examName || courseName} materials`,
    },
    cards,
  );

  logger.info("flashcards.generated_from_course", {
    user_id: userId,
    deck_id: deck.id,
    course_name: courseName,
    card_count: cards.length,
  });

  return toDeckData(deck, cards);
}

// ---------------------------------------------------------------------------
// Reading decks
// ---------------------------------------------------------------------------

type DeckWithCards = {
  id: string;
  userId: string;
  courseName: string;
  examName: string | null;
  documentId: string | null;
  title: string;
  createdAt: Date;
  document: { title: string } | null;
  cards: { repetitions: number; intervalDays: number; nextDueAt: Date | null }[];
};

function summarizeDeck(d: DeckWithCards, todayEnds: Date): DeckSummaryData {
  return {
    id: d.id,
    user_id: d.userId,
    course_name: d.courseName,
    exam_name: d.examName,
    document_id: d.documentId,
    title: displayDeckTitle(d.title, d.courseName),
    card_count: d.cards.length,
    created_at: d.createdAt.toISOString(),
    kind: deckKind(d.title),
    source_title: d.document?.title ?? null,
    counts: deckStats(d.cards, todayEnds),
    next_due_at: nextDueAfterToday(d.cards, todayEnds),
  };
}

const DECK_SUMMARY_INCLUDE = {
  document: { select: { title: true } },
  cards: { select: { repetitions: true, intervalDays: true, nextDueAt: true } },
} as const;

/**
 * List flashcard decks for a user, optionally filtered by course, with
 * counts per status and due today (on the student's clock).
 */
export async function listFlashcardDecks(
  userId: string,
  courseName?: string,
  examName?: string,
): Promise<DeckSummaryData[]> {
  const where: Record<string, unknown> = { userId };
  if (courseName) where.courseName = courseName;
  if (examName) where.examName = examName;

  const [decks, timeZone] = await Promise.all([
    prisma.flashcardDeck.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: DECK_SUMMARY_INCLUDE,
    }),
    resolveTimeZone(userId),
  ]);

  const todayEnds = endOfToday(timeZone);
  return decks.map((d) => summarizeDeck(d, todayEnds));
}

export interface CourseDecks {
  courseName: string;
  /** The exam to generate for: the only exam among the course's materials, else null (all of them). */
  generateExamName: string | null;
  /** Files uploaded for the course, and how many finished processing. */
  materialCount: number;
  readyMaterialCount: number;
  /** Nearest upcoming exam from the course's plans. */
  exam: { name: string; date: string } | null;
  decks: DeckSummaryData[];
}

export interface DeckLibrary {
  courses: CourseDecks[];
  timeZone: string;
}

/**
 * Every course with materials or decks, nearest exam first, with its decks
 * and their counts. Feeds the /flashcards page.
 */
export async function getDeckLibrary(userId: string, now: Date = new Date()): Promise<DeckLibrary> {
  // The student's today can be a day behind UTC's; the exact cut is made
  // below, once the zone is known.
  const fromDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const [decks, documents, plans, timeZone] = await Promise.all([
    prisma.flashcardDeck.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: DECK_SUMMARY_INCLUDE,
    }),
    prisma.contentDocument.findMany({
      where: { userId, namespace: "COURSE", courseName: { not: null } },
      select: { courseName: true, examName: true, status: true },
    }),
    prisma.studyPlan.findMany({
      where: { userId, examDate: { gte: fromDay } },
      orderBy: { examDate: "asc" },
      select: { courseName: true, examName: true, examDate: true },
    }),
    resolveTimeZone(userId),
  ]);

  const todayEnds = endOfToday(timeZone, now);
  const todayKey = dayKey(now, timeZone);
  const byCourse = new Map<string, CourseDecks & { exams: Set<string> }>();
  const entry = (courseName: string) => {
    let course = byCourse.get(courseName);
    if (!course) {
      course = {
        courseName,
        generateExamName: null,
        materialCount: 0,
        readyMaterialCount: 0,
        exam: null,
        decks: [],
        exams: new Set(),
      };
      byCourse.set(courseName, course);
    }
    return course;
  };

  for (const doc of documents) {
    if (!doc.courseName) continue;
    const course = entry(doc.courseName);
    course.materialCount++;
    if (doc.status === "PROCESSED") course.readyMaterialCount++;
    course.exams.add(doc.examName ?? "");
  }
  for (const deck of decks) entry(deck.courseName).decks.push(summarizeDeck(deck, todayEnds));
  for (const plan of plans) {
    const examDay = dateColumnKey(plan.examDate);
    if (examDay < todayKey) continue;
    const course = byCourse.get(plan.courseName);
    if (course && !course.exam) {
      course.exam = { name: plan.examName, date: examDay };
    }
  }

  const courses = [...byCourse.values()].map(({ exams, ...course }) => {
    const examNames = [...exams];
    return {
      ...course,
      generateExamName: examNames.length === 1 && examNames[0] ? examNames[0] : null,
    };
  });

  courses.sort((a, b) => {
    if (a.exam && b.exam) return a.exam.date.localeCompare(b.exam.date) || a.courseName.localeCompare(b.courseName);
    if (a.exam) return -1;
    if (b.exam) return 1;
    return a.courseName.localeCompare(b.courseName);
  });

  return { courses, timeZone };
}

export interface DeckCardDetail {
  id: string;
  front: string;
  back: string;
  tags: string[] | null;
  ordinal: number;
  status: CardStatus;
  nextDueAt: string | null;
  due: boolean;
}

export interface DeckDetail extends DeckSummaryData {
  cards: DeckCardDetail[];
  exam: { name: string; date: string } | null;
  timeZone: string;
}

/**
 * One deck with every card, its status and next review, for the deck page.
 * Returns null for a missing deck or another user's deck.
 */
export async function getDeckDetail(userId: string, deckId: string): Promise<DeckDetail | null> {
  const [deck, timeZone] = await Promise.all([
    prisma.flashcardDeck.findUnique({
      where: { id: deckId },
      include: {
        document: { select: { title: true } },
        cards: { orderBy: { ordinal: "asc" } },
      },
    }),
    resolveTimeZone(userId),
  ]);
  if (!deck || deck.userId !== userId) return null;

  const now = new Date();
  const todayEnds = endOfToday(timeZone, now);
  const exam = await findUpcomingExam(userId, deck.courseName, deck.examName, now, timeZone);

  return {
    ...summarizeDeck(deck, todayEnds),
    exam: exam ? { name: exam.examName, date: exam.examDate.toISOString().slice(0, 10) } : null,
    timeZone,
    cards: deck.cards.map((c) => ({
      id: c.id,
      front: c.front,
      back: c.back,
      tags: Array.isArray(c.tags) ? (c.tags as unknown[]).filter((t): t is string => typeof t === "string") : null,
      ordinal: c.ordinal,
      status: cardStatus(c),
      nextDueAt: c.nextDueAt?.toISOString() ?? null,
      due: isDueToday(c, todayEnds),
    })),
  };
}

/**
 * Delete a flashcard deck and all its cards (cascade).
 */
export async function deleteFlashcardDeck(
  userId: string,
  deckId: string,
): Promise<boolean> {
  const deck = await prisma.flashcardDeck.findUnique({
    where: { id: deckId },
    select: { userId: true },
  });
  if (!deck || deck.userId !== userId) return false;

  await prisma.flashcardDeck.delete({ where: { id: deckId } });
  logger.info("flashcards.deleted", { user_id: userId, deck_id: deckId });
  return true;
}

/**
 * Whether the deck exists and belongs to the user: one indexed lookup, so a
 * page can answer a missing deck with a 404 before anything streams.
 */
export async function isDeckOwner(userId: string, deckId: string): Promise<boolean> {
  const deck = await prisma.flashcardDeck.findUnique({ where: { id: deckId }, select: { userId: true } });
  return deck !== null && deck.userId === userId;
}

// ---------------------------------------------------------------------------
// Editing cards
// ---------------------------------------------------------------------------

async function assertDeckOwner(userId: string, deckId: string) {
  if (!(await isDeckOwner(userId, deckId))) throw new FlashcardError("DECK_NOT_FOUND", "Deck not found");
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2002";
}

/** Adds a card at the end of the deck. New cards start unreviewed. */
export async function addFlashcard(
  userId: string,
  deckId: string,
  input: { front: string; back: string },
): Promise<FlashcardData> {
  await assertDeckOwner(userId, deckId);

  const create = () =>
    prisma.$transaction(async (tx) => {
      const { _max } = await tx.flashcard.aggregate({ where: { deckId }, _max: { ordinal: true } });
      const card = await tx.flashcard.create({
        data: { deckId, front: input.front, back: input.back, ordinal: (_max.ordinal ?? -1) + 1 },
      });
      const total = await tx.flashcard.count({ where: { deckId } });
      await tx.flashcardDeck.update({ where: { id: deckId }, data: { cardCount: total } });
      return card;
    });

  let card;
  try {
    card = await create();
  } catch (err) {
    // Two cards added at once can race for the same ordinal: retry once.
    if (!isUniqueViolation(err)) throw err;
    card = await create();
  }

  logger.info("flashcards.card_added", { user_id: userId, deck_id: deckId, card_id: card.id });
  return { id: card.id, front: card.front, back: card.back, tags: null, ordinal: card.ordinal };
}

/** Edits a card's text. Its schedule and review history stay. */
export async function updateFlashcard(
  userId: string,
  deckId: string,
  cardId: string,
  input: { front?: string; back?: string },
): Promise<FlashcardData> {
  await assertDeckOwner(userId, deckId);
  const existing = await prisma.flashcard.findUnique({ where: { id: cardId }, select: { deckId: true } });
  if (!existing || existing.deckId !== deckId) throw new FlashcardError("CARD_NOT_FOUND", "Card not found");

  const card = await prisma.flashcard.update({
    where: { id: cardId },
    data: {
      ...(input.front !== undefined ? { front: input.front } : {}),
      ...(input.back !== undefined ? { back: input.back } : {}),
    },
  });
  logger.info("flashcards.card_updated", { user_id: userId, deck_id: deckId, card_id: cardId });
  return {
    id: card.id,
    front: card.front,
    back: card.back,
    tags: Array.isArray(card.tags) ? (card.tags as string[]) : null,
    ordinal: card.ordinal,
  };
}

/** Deletes a card and its review history. */
export async function deleteFlashcard(userId: string, deckId: string, cardId: string): Promise<void> {
  await assertDeckOwner(userId, deckId);
  await prisma.$transaction(async (tx) => {
    const existing = await tx.flashcard.findUnique({ where: { id: cardId }, select: { deckId: true } });
    if (!existing || existing.deckId !== deckId) throw new FlashcardError("CARD_NOT_FOUND", "Card not found");
    await tx.cardReview.deleteMany({ where: { cardId } });
    await tx.flashcard.delete({ where: { id: cardId } });
    const total = await tx.flashcard.count({ where: { deckId } });
    await tx.flashcardDeck.update({ where: { id: deckId }, data: { cardCount: total } });
  });
  logger.info("flashcards.card_deleted", { user_id: userId, deck_id: deckId, card_id: cardId });
}
