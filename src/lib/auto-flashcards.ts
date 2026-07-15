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
 * deck for the course. When a card with the same front already exists,
 * its back is refreshed with the newest correction (the newest
 * correction supersedes older ones).
 *
 * Errorful-learning hygiene (Karpicke & Roediger retrieval specificity):
 * a card must present a retrievable question on the front and the
 * CORRECTION on the back. MCQ stems whose options are not on the card
 * are wrapped into an answerable open question, and the student's wrong
 * answer is never re-encoded as the primary content of the back.
 */

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

const AUTO_DECK_TITLE_PREFIX = "Error Repair";

/** MCQ-stem fronts are unanswerable without their options. */
const MCQ_STEM_PATTERN = /which of the following/i;

/** Marker emitted by MCQ-sourced correction rules: The correct answer is "X". */
const CORRECT_ANSWER_MARKER = /the correct answer is\s*"[^"]+"/i;

/**
 * Build an answerable card front. If the prompt is an MCQ stem (its
 * options are NOT on the card) and the correction rule carries the
 * `The correct answer is "..."` marker, wrap the stem into an open
 * question. Wrapping (rather than rewriting) is deliberate: no heuristic
 * can corrupt the stem's meaning.
 */
function buildFront(promptText: string, correctionRule: string | undefined): string {
  if (
    correctionRule &&
    MCQ_STEM_PATTERN.test(promptText) &&
    CORRECT_ANSWER_MARKER.test(correctionRule)
  ) {
    return `From memory: state the correct answer to — "${promptText}" (answer without options)`;
  }
  return promptText;
}

/**
 * Build the card back, correction-first: the correction rule carries
 * full weight at the top; any reference to the student's wrong answer
 * is a final de-emphasized line so the error is not re-encoded.
 */
function buildBack(
  error: { errorType: string; correctionRule: string } | undefined,
  userAnswer: string | null,
): string {
  const backParts: string[] = [];

  if (error) {
    backParts.push(`Correction: ${error.correctionRule}`);
    backParts.push(`Error type: ${error.errorType}`);
  } else {
    backParts.push("Review this concept and write the correct answer from memory.");
  }

  if (userAnswer) {
    backParts.push("");
    backParts.push(`Previously confused with: ${userAnswer}`);
  }

  return backParts.join("\n");
}

/**
 * Create flashcards from errors in a completed run.
 * Recurring errors refresh the existing card's back with the newest
 * correction instead of creating duplicates (ordinal untouched).
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

    // Deck lookup/creation, card inserts/refreshes, and the cardCount update
    // all run in one transaction so concurrent run completions can't
    // interleave and leave the deck with colliding ordinals or a stale
    // cardCount.
    const { deckId, created, refreshed } = await prisma.$transaction(async (tx) => {
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

      // Map existing card fronts to their ids. The (transformed) front is
      // the dedup key since we don't have a direct link; a recurring error
      // refreshes that card's back with the newest correction.
      const existingCards = await tx.flashcard.findMany({
        where: { deckId: deck.id },
        select: { id: true, front: true },
      });
      const cardIdByFront = new Map(existingCards.map((c) => [c.front, c.id]));

      // Derive the next ordinal from the deck's actual cards — the cached
      // cardCount can go stale if a previous invocation failed midway.
      const { _max } = await tx.flashcard.aggregate({
        where: { deckId: deck.id },
        _max: { ordinal: true },
      });
      let nextOrdinal = (_max.ordinal ?? -1) + 1;

      // Create flashcards for new errors; refresh backs for recurring ones
      let createdCount = 0;
      let refreshedCount = 0;

      for (const attempt of attempts) {
        const error = errorByIndex.get(attempt.promptIndex);
        const front = buildFront(attempt.promptText, error?.correctionRule);
        const back = buildBack(error, attempt.userAnswer);

        const existingCardId = cardIdByFront.get(front);
        if (existingCardId !== undefined) {
          // Recurring error: the newest correction supersedes the old back.
          // The card's ordinal is deliberately untouched.
          await tx.flashcard.update({
            where: { id: existingCardId },
            data: { back },
          });
          refreshedCount++;
          continue;
        }

        const card = await tx.flashcard.create({
          data: {
            deckId: deck.id,
            front,
            back,
            tags: error ? [error.errorType.toLowerCase(), "auto-repair"] : ["auto-repair"],
            ordinal: nextOrdinal,
          },
          select: { id: true },
        });

        cardIdByFront.set(front, card.id);
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

      return { deckId: deck.id, created: createdCount, refreshed: refreshedCount };
    });

    if (created > 0 || refreshed > 0) {
      logger.info("auto_flashcards.created", {
        user_id: userId,
        run_id: runId,
        course_name: courseName,
        deck_id: deckId,
        cards_created: created,
        cards_refreshed: refreshed,
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
