import { prisma } from "@/lib/db";
import { runTask, type GatewayContext } from "@/lib/ai/gateway";
import { AiTask } from "@/lib/ai/types";
import { getPrompt } from "@/lib/ai/prompt-registry";
import { createProvider } from "@/lib/ai/provider-factory";
import { logger } from "@/lib/logger";
import { sampleEvenly } from "@/lib/config";

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

const FLASHCARD_MODEL = process.env.AI_MODEL_ANSWER || "gpt-4o-mini";

/**
 * Compute mastery context for adaptive flashcard generation.
 * Analyzes existing card reviews to identify weak/strong areas.
 */
async function computeMasteryContext(
  userId: string,
  courseName: string,
): Promise<string | undefined> {
  // Get all cards in this course with their review stats
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

  if (!doc) throw new Error("Document not found");
  if (doc.userId !== userId) throw new Error("Forbidden");
  if (doc.status !== "PROCESSED") throw new Error("Document not yet processed");
  if (!doc.courseName) throw new Error("Document has no course name");

  // Fetch chunks from this document
  const allChunks = await prisma.contentChunk.findMany({
    where: { documentId },
    orderBy: { ordinal: "asc" },
    select: { text: true },
  });

  if (allChunks.length === 0) {
    throw new Error("No content chunks found for this document");
  }

  const chunkTexts = sampleEvenly(allChunks, 12).map((c) => c.text);

  // Compute mastery context for adaptive difficulty
  const masteryContext = await computeMasteryContext(userId, doc.courseName!);

  const ctx: GatewayContext = { userId, provider: createProvider() };
  const prompt = getPrompt(AiTask.GENERATE_FLASHCARDS);

  const result = await runTask<{ cards: FlashcardGenerated[] }>(ctx, {
    task: AiTask.GENERATE_FLASHCARDS,
    promptVersion: prompt.version,
    model: FLASHCARD_MODEL,
    input: {
      title: doc.title,
      courseName: doc.courseName,
      examName: doc.examName || undefined,
      chunkTexts,
      masteryContext,
    },
    parseOutput: (raw: unknown) => {
      const data = raw as Record<string, unknown>;
      const cards = (data.cards as FlashcardGenerated[]) || [];
      return { cards };
    },
  });

  // Persist the deck and cards in a transaction
  const deck = await prisma.$transaction(async (tx) => {
    const newDeck = await tx.flashcardDeck.create({
      data: {
        userId,
        courseName: doc.courseName!,
        examName: doc.examName || null,
        documentId,
        title: `${doc.title} — Flashcards`,
        cardCount: result.output.cards.length,
      },
    });

    if (result.output.cards.length > 0) {
      await tx.flashcard.createMany({
        data: result.output.cards.map((card, i) => ({
          deckId: newDeck.id,
          front: card.front,
          back: card.back,
          tags: card.tags ? JSON.parse(JSON.stringify(card.tags)) : null,
          ordinal: i,
        })),
      });
    }

    return newDeck;
  });

  logger.info("flashcards.generated", {
    user_id: userId,
    deck_id: deck.id,
    document_id: documentId,
    card_count: result.output.cards.length,
  });

  return {
    id: deck.id,
    user_id: deck.userId,
    course_name: deck.courseName,
    exam_name: deck.examName,
    document_id: deck.documentId,
    title: deck.title,
    card_count: deck.cardCount,
    cards: result.output.cards.map((card, i) => ({
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
 * Generate flashcards from all documents in a course.
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
    throw new Error("No course materials found. Upload documents first.");
  }

  const chunkTexts = sampleEvenly(allChunks, 15).map((c) => c.text);

  // Compute mastery context for adaptive difficulty
  const masteryContext = await computeMasteryContext(userId, courseName);

  const ctx: GatewayContext = { userId, provider: createProvider() };
  const prompt = getPrompt(AiTask.GENERATE_FLASHCARDS);

  const result = await runTask<{ cards: FlashcardGenerated[] }>(ctx, {
    task: AiTask.GENERATE_FLASHCARDS,
    promptVersion: prompt.version,
    model: FLASHCARD_MODEL,
    input: {
      title: courseName,
      courseName,
      examName,
      chunkTexts,
      masteryContext,
    },
    parseOutput: (raw: unknown) => {
      const data = raw as Record<string, unknown>;
      return { cards: (data.cards as FlashcardGenerated[]) || [] };
    },
  });

  const deck = await prisma.$transaction(async (tx) => {
    const deckTitle = examName
      ? `${courseName} — ${examName} Flashcards`
      : `${courseName} Flashcards`;

    const newDeck = await tx.flashcardDeck.create({
      data: {
        userId,
        courseName,
        examName: examName || null,
        title: deckTitle,
        cardCount: result.output.cards.length,
      },
    });

    if (result.output.cards.length > 0) {
      await tx.flashcard.createMany({
        data: result.output.cards.map((card, i) => ({
          deckId: newDeck.id,
          front: card.front,
          back: card.back,
          tags: card.tags ? JSON.parse(JSON.stringify(card.tags)) : null,
          ordinal: i,
        })),
      });
    }

    return newDeck;
  });

  logger.info("flashcards.generated_from_course", {
    user_id: userId,
    deck_id: deck.id,
    course_name: courseName,
    card_count: result.output.cards.length,
  });

  return {
    id: deck.id,
    user_id: deck.userId,
    course_name: deck.courseName,
    exam_name: deck.examName,
    document_id: deck.documentId,
    title: deck.title,
    card_count: deck.cardCount,
    cards: result.output.cards.map((card, i) => ({
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
 * List flashcard decks for a user, optionally filtered by course.
 */
export async function listFlashcardDecks(
  userId: string,
  courseName?: string,
  examName?: string,
): Promise<FlashcardDeckData[]> {
  const where: Record<string, unknown> = { userId };
  if (courseName) where.courseName = courseName;
  if (examName) where.examName = examName;

  const decks = await prisma.flashcardDeck.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { cards: true } } },
  });

  return decks.map((d) => ({
    id: d.id,
    user_id: d.userId,
    course_name: d.courseName,
    exam_name: d.examName,
    document_id: d.documentId,
    title: d.title,
    card_count: d._count.cards,
    created_at: d.createdAt.toISOString(),
  }));
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
 * Get a deck with all its cards for studying.
 */
export async function getFlashcardDeck(
  userId: string,
  deckId: string,
): Promise<FlashcardDeckData | null> {
  const deck = await prisma.flashcardDeck.findUnique({
    where: { id: deckId },
    include: {
      cards: { orderBy: { ordinal: "asc" } },
    },
  });

  if (!deck || deck.userId !== userId) return null;

  return {
    id: deck.id,
    user_id: deck.userId,
    course_name: deck.courseName,
    exam_name: deck.examName,
    document_id: deck.documentId,
    title: deck.title,
    card_count: deck.cards.length,
    cards: deck.cards.map((c) => ({
      id: c.id,
      front: c.front,
      back: c.back,
      tags: c.tags as string[] | null,
      ordinal: c.ordinal,
    })),
    created_at: deck.createdAt.toISOString(),
  };
}
