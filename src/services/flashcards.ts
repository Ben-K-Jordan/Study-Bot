import { prisma } from "@/lib/db";
import { runTask, type GatewayContext } from "@/lib/ai/gateway";
import { AiTask } from "@/lib/ai/types";
import { getPrompt } from "@/lib/ai/prompt-registry";
import { createProvider } from "@/lib/ai/provider-factory";
import { logger } from "@/lib/logger";

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

  // Sample evenly across the document (max 12 chunks for token budget)
  const MAX_CHUNKS = 12;
  let sampled: { text: string }[];
  if (allChunks.length <= MAX_CHUNKS) {
    sampled = allChunks;
  } else {
    const step = (allChunks.length - 1) / (MAX_CHUNKS - 1);
    sampled = Array.from({ length: MAX_CHUNKS }, (_, i) =>
      allChunks[Math.round(i * step)]
    );
  }

  const chunkTexts = sampled.map((c) => c.text);

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

  const allChunks = await prisma.contentChunk.findMany({
    where: { document: { is: docWhere } },
    orderBy: [{ documentId: "asc" }, { ordinal: "asc" }],
    select: { text: true },
  });

  if (allChunks.length === 0) {
    throw new Error("No course materials found. Upload documents first.");
  }

  // Sample evenly (max 15 chunks for broader coverage)
  const MAX_CHUNKS = 15;
  let sampled: { text: string }[];
  if (allChunks.length <= MAX_CHUNKS) {
    sampled = allChunks;
  } else {
    const step = (allChunks.length - 1) / (MAX_CHUNKS - 1);
    sampled = Array.from({ length: MAX_CHUNKS }, (_, i) =>
      allChunks[Math.round(i * step)]
    );
  }

  const chunkTexts = sampled.map((c) => c.text);

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
