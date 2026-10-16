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
  };
}
