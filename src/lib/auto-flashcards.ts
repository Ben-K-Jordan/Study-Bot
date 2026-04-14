/**
 * Auto-generate flashcards from session errors.
 *
 * Research basis (Roediger & Butler 2011): Converting failed retrieval
 * attempts into spaced-repetition flashcards amplifies retention 2-3x
 * vs study-only. Automation captures high-priority knowledge gaps at
 * the moment they're identified.
 *
 * Called after a run completes. Creates one flashcard per
 * PARTIAL/INCORRECT attempt, added to an auto-generated "Error Repair"
 * deck for the course.
 */

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

const AUTO_DECK_TITLE_PREFIX = "Error Repair";

/**
 * Create flashcards from errors in a completed run.
 * Idempotent: skips if flashcards were already created for this run.
 */
export async function createFlashcardsFromErrors(
  userId: string,
  runId: string,
  courseName: string,
): Promise<number> {
  try {
    // Fetch PARTIAL/INCORRECT attempts with their prompts
    const attempts = await prisma.sessionAttempt.findMany({
      where: {
        runId,
        selfScore: { in: ["PARTIAL", "INCORRECT"] },
      },
      select: {
        id: true,
        promptText: true,
        userAnswer: true,
        selfScore: true,
        promptIndex: true,
      },
    });

    if (attempts.length === 0) return 0;

    // Fetch associated error logs for correction rules
    const errorLogs = await prisma.sessionErrorLog.findMany({
      where: { runId },
      select: { promptIndex: true, errorType: true, correctionRule: true },
    });
    const errorByIndex = new Map(errorLogs.map((e) => [e.promptIndex, e]));

    // Find or create the auto-repair deck for this course
    const deckTitle = `${AUTO_DECK_TITLE_PREFIX} — ${courseName}`;
    let deck = await prisma.flashcardDeck.findFirst({
      where: { userId, courseName, title: deckTitle },
      select: { id: true, cardCount: true },
    });

    if (!deck) {
      deck = await prisma.flashcardDeck.create({
        data: {
          userId,
          courseName,
          title: deckTitle,
          cardCount: 0,
        },
        select: { id: true, cardCount: true },
      });
    }

    // Check which attempts already have flashcards (idempotency)
    // Use the promptText as a dedup key since we don't have a direct link
    const existingCards = await prisma.flashcard.findMany({
      where: { deckId: deck.id },
      select: { front: true },
    });
    const existingFronts = new Set(existingCards.map((c) => c.front));

    // Create flashcards for new errors
    let created = 0;
    let nextOrdinal = deck.cardCount;

    for (const attempt of attempts) {
      const front = attempt.promptText;
      if (existingFronts.has(front)) continue; // already exists

      const error = errorByIndex.get(attempt.promptIndex);
      const backParts: string[] = [];

      if (error) {
        backParts.push(`Error type: ${error.errorType}`);
        backParts.push(`Correction: ${error.correctionRule}`);
        backParts.push("");
      }

      if (attempt.userAnswer) {
        backParts.push(`Your answer: ${attempt.userAnswer}`);
        backParts.push("");
      }

      backParts.push(
        error
          ? `Remember: ${error.correctionRule}`
          : "Review this concept and write the correct answer from memory.",
      );

      await prisma.flashcard.create({
        data: {
          deckId: deck.id,
          front,
          back: backParts.join("\n"),
          tags: error ? [error.errorType.toLowerCase(), "auto-repair"] : ["auto-repair"],
          ordinal: nextOrdinal,
        },
      });

      nextOrdinal++;
      created++;
    }

    if (created > 0) {
      await prisma.flashcardDeck.update({
        where: { id: deck.id },
        data: { cardCount: nextOrdinal },
      });

      logger.info("auto_flashcards.created", {
        user_id: userId,
        run_id: runId,
        course_name: courseName,
        deck_id: deck.id,
        cards_created: created,
      });
    }

    return created;
  } catch (err) {
    logger.error("auto_flashcards.failed", {
      user_id: userId,
      run_id: runId,
      error: String(err),
    });
    return 0;
  }
}
