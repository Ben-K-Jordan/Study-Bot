/**
 * What the session loads after an answer is saved. Feedback for the answer
 * never waits on the next question, except in exam answering, which has no
 * feedback: there the next question replaces the answered one at once, so
 * it is loaded before the answer resolves.
 */
export interface NextLoads {
  /** The question due next, or null when the run is done with questions. */
  nextIndex: number | null;
  /** Load the next question before the answer resolves. */
  awaitNext: boolean;
  /** The last exam answer is in: scoring starts and needs the saved answers. */
  scoringBegins: boolean;
  /**
   * The start-time deck may stand in when the next question fails to load.
   * Only in exam answering: there the deck matches the server, and no
   * question needs its answer key yet. Everywhere else the deck is a stale
   * copy without keys (scoring needs them), and difficulty adaptation may
   * have swapped the question the server will grade. A failed load there
   * leaves the question unset, so the runner loads it and offers Retry.
   */
  deckFallback: boolean;
}

export function nextLoads(input: {
  /** The run finished with this answer. */
  completed: boolean;
  /** The run's index and phase after the answer, and before it. */
  index: number;
  promptCount: number;
  phase: string;
  previousPhase: string;
}): NextLoads {
  const nextIndex = !input.completed && input.index < input.promptCount ? input.index : null;
  return {
    nextIndex,
    awaitNext: nextIndex !== null && input.phase === "EXAM",
    scoringBegins: input.phase === "REVIEW" && input.previousPhase === "EXAM",
    deckFallback: nextIndex !== null && input.phase === "EXAM",
  };
}
