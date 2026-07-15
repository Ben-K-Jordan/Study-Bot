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

    const deckTitle = `${AUTO_DECK_TITLE_PREFIX} — ${courseName}`;

    // Deck lookup/creation, card inserts, and the cardCount update all run
    // in one transaction so concurrent run completions can't interleave and
    // leave the deck with colliding ordinals or a stale cardCount.
    const { deckId, created } = await prisma.$transaction(async (tx) => {
      // Find or create the auto-repair deck for this course
      let deck = await tx.flashcardDeck.findFirst({
        where: { userId, courseName, title: deckTitle },
        select: { id: true },
      });

      if (!deck) {
        try {
          deck = await tx.flashcardDeck.create({
            data: {
              userId,
              courseName,
              title: deckTitle,
              cardCount: 0,
            },
            select: { id: true },
          });
        } catch (err: unknown) {
          // Unique constraint violation (P2002) — a concurrent completion
          // created the deck first; re-fetch it and proceed.
          if (
            typeof err === "object" &&
            err !== null &&
            "code" in err &&
            (err as { code: string }).code === "P2002"
          ) {
            deck = await tx.flashcardDeck.findFirst({
              where: { userId, courseName, title: deckTitle },
              select: { id: true },
            });
          }
          if (!deck) throw err;
        }
      }

      // Check which attempts already have flashcards (idempotency)
      // Use the promptText as a dedup key since we don't have a direct link
      const existingCards = await tx.flashcard.findMany({
        where: { deckId: deck.id },
        select: { front: true },
      });
      const existingFronts = new Set(existingCards.map((c) => c.front));

      // Derive the next ordinal from the deck's actual cards — the cached
      // cardCount can go stale if a previous invocation failed midway.
      const { _max } = await tx.flashcard.aggregate({
        where: { deckId: deck.id },
        _max: { ordinal: true },
      });
      let nextOrdinal = (_max.ordinal ?? -1) + 1;

      // Create flashcards for new errors
      let createdCount = 0;

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

        await tx.flashcard.create({
          data: {
            deckId: deck.id,
            front,
            back: backParts.join("\n"),
            tags: error ? [error.errorType.toLowerCase(), "auto-repair"] : ["auto-repair"],
            ordinal: nextOrdinal,
          },
        });

        nextOrdinal++;
        createdCount++;
      }

      if (createdCount > 0) {
        // Set cardCount from the real number of cards in the deck
        const totalCards = await tx.flashcard.count({
          where: { deckId: deck.id },
        });
        await tx.flashcardDeck.update({
          where: { id: deck.id },
          data: { cardCount: totalCards },
        });
      }

      return { deckId: deck.id, created: createdCount };
    });

    if (created > 0) {
      logger.info("auto_flashcards.created", {
        user_id: userId,
        run_id: runId,
        course_name: courseName,
        deck_id: deckId,
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
