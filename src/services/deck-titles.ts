import { ERRORS_DECK_TITLE, LEGACY_ERRORS_DECK_PREFIX } from "@/lib/auto-flashcards";

/** "generated": written by AI from materials. "errors": built from the student's session errors. */
export type DeckKind = "generated" | "errors";

/** Session-error decks are rule-built; every other deck is written by AI. */
export function deckKind(title: string): DeckKind {
  return title === ERRORS_DECK_TITLE || title.startsWith(LEGACY_ERRORS_DECK_PREFIX) ? "errors" : "generated";
}

/**
 * Titles older builds stored (a file title, course and exam, or "Error
 * Repair" joined to "Flashcards" or the course with an em dash) shown the
 * way new decks are named.
 */
export function displayDeckTitle(title: string, courseName: string): string {
  if (title.startsWith(LEGACY_ERRORS_DECK_PREFIX)) return ERRORS_DECK_TITLE;
  const doc = /^(.+) \u2014 Flashcards$/.exec(title);
  if (doc) return doc[1];
  const exam = /^(.+) \u2014 (.+) Flashcards$/.exec(title);
  if (exam && exam[1] === courseName) return `All ${exam[2]} materials`;
  if (title === `${courseName} Flashcards`) return `All ${courseName} materials`;
  return title;
}
