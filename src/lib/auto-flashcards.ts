/**
 * Auto-generate flashcards from session errors.
 *
 * Research basis (Roediger & Butler 2011): Converting failed retrieval
 * attempts into spaced-repetition flashcards amplifies retention 2-3x
 * vs study-only. Automation captures high-priority knowledge gaps at
 * the moment they're identified.
 *
 * Called after a run completes. Creates one flashcard per
 * PARTIAL/INCORRECT attempt, added to the course's "Session errors" deck.
 * When a card with the same front already exists, its back is refreshed
 * with the newest correction (the newest correction supersedes older ones).
 *
 * Errorful-learning hygiene (Karpicke & Roediger retrieval specificity):
 * a card must present a retrievable question on the front and the
 * CORRECTION on the back. MCQ stems whose options are not on the card
 * are wrapped into an answerable open question, and the student's wrong
 * answer is never re-encoded as the primary content of the back.
 */

import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

/** Title of each course's deck of cards built from session errors. */
export const ERRORS_DECK_TITLE = "Session errors";
/** Earlier builds titled the deck "Error Repair", an em dash, then the course; those decks are reused and renamed. */
export const LEGACY_ERRORS_DECK_PREFIX = "Error Repair \u2014 ";

/** MCQ-stem fronts are unanswerable without their options. */
const MCQ_STEM_PATTERN = /which of the following/i;

/** Marker emitted by MCQ-sourced correction rules: The correct answer is "X". */
const CORRECT_ANSWER_MARKER = /the correct answer is\s*"[^"]+"/i;

/** Error types in the words the session's error log uses. */
const ERROR_TYPE_LABELS: Record<string, string> = {
  MISCONCEPTION: "Misconception",
  PROCEDURE: "Wrong steps",
  CARELESS: "Careless slip",
  MEMORY: "Memory gap",
  UNKNOWN: "Not sure",
};

function errorTypeLabel(errorType: string): string {
  const known = ERROR_TYPE_LABELS[errorType.toUpperCase()];
  if (known) return known;
  const words = errorType.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function isWrappable(promptText: string, correctionRule: string | undefined): boolean {
  return Boolean(
    correctionRule && MCQ_STEM_PATTERN.test(promptText) && CORRECT_ANSWER_MARKER.test(correctionRule),
  );
}

/**
 * Build an answerable card front. If the prompt is an MCQ stem (its
 * options are NOT on the card) and the correction rule carries the
 * `The correct answer is "..."` marker, wrap the stem into an open
 * question. Wrapping (rather than rewriting) is deliberate: no heuristic
 * can corrupt the stem's meaning.
 */
export function buildFront(promptText: string, correctionRule: string | undefined): string {
  if (isWrappable(promptText, correctionRule)) {
    return `From memory, with no options shown, give the correct answer to "${promptText}"`;
  }
  return promptText;
}

/** The wrapped front earlier builds wrote, so recurring errors still find their card. */
function legacyFront(promptText: string, correctionRule: string | undefined): string | null {
  if (!isWrappable(promptText, correctionRule)) return null;
  return `From memory: state the correct answer to \u2014 "${promptText}" (answer without options)`;
}

/**
 * Build the card back, correction-first: the correction rule carries
 * full weight at the top; any reference to the student's wrong answer
 * is a final de-emphasized line so the error is not re-encoded.
 */
export function buildBack(
  error: { errorType: string; correctionRule: string } | undefined,
  userAnswer: string | null,
): string {
  const backParts: string[] = [];

  if (error) {
    backParts.push(`Correction rule: ${error.correctionRule}`);
    backParts.push(`Error type: ${errorTypeLabel(error.errorType)}`);
  } else {
    backParts.push(
      "No correction rule was saved for this error. Look up the answer in your materials and edit this card.",
    );
  }

  if (userAnswer) {
    backParts.push("");
    backParts.push(`Your earlier answer: ${userAnswer}`);
  }

  return backParts.join("\n");
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
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

    const legacyDeckTitle = `${LEGACY_ERRORS_DECK_PREFIX}${courseName}`;
    const titles = [ERRORS_DECK_TITLE, legacyDeckTitle];

    // Deck lookup/creation, card inserts/refreshes, and the cardCount update
    // all run in one transaction so concurrent run completions can't
    // interleave and leave the deck with colliding ordinals or a stale
    // cardCount.
    const { deckId, created, refreshed } = await prisma.$transaction(async (tx) => {
      // Find or create the session-errors deck for this course. A deck with
      // the earlier title is reused and renamed.
      let deck = await tx.flashcardDeck.findFirst({
        where: { userId, courseName, title: { in: titles } },
        select: { id: true, title: true },
      });

      if (deck && deck.title === legacyDeckTitle) {
        try {
          await tx.flashcardDeck.update({ where: { id: deck.id }, data: { title: ERRORS_DECK_TITLE } });
        } catch (err: unknown) {
          // A deck with the new title already exists: keep using this one as is.
          if (!isUniqueViolation(err)) throw err;
        }
      }

      if (!deck) {
        try {
          deck = await tx.flashcardDeck.create({
            data: {
              userId,
              courseName,
              title: ERRORS_DECK_TITLE,
              cardCount: 0,
            },
            select: { id: true, title: true },
          });
        } catch (err: unknown) {
          // Unique constraint violation (P2002): a concurrent completion
          // created the deck first; re-fetch it and proceed.
          if (isUniqueViolation(err)) {
            deck = await tx.flashcardDeck.findFirst({
              where: { userId, courseName, title: { in: titles } },
              select: { id: true, title: true },
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

      // Derive the next ordinal from the deck's actual cards: the cached
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
        const oldFront = legacyFront(attempt.promptText, error?.correctionRule);

        const existingCardId =
          cardIdByFront.get(front) ?? (oldFront !== null ? cardIdByFront.get(oldFront) : undefined);
        if (existingCardId !== undefined) {
          // Recurring error: the newest correction supersedes the old back,
          // and a front in the earlier wording takes the current one. The
          // card's ordinal is deliberately untouched.
          await tx.flashcard.update({
            where: { id: existingCardId },
            data: { front, back },
          });
          cardIdByFront.set(front, existingCardId);
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
