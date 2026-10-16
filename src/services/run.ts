/**
 * The study-session run service. The code lives in ./run/ by concern; this
 * file re-exports the public API so routes, scripts and tests import
 * "@/services/run" as before.
 *
 * - run/start.ts: startOrResumeRun (deck building)
 * - run/prompt-view.ts: getRunPrompt and the client question views
 * - run/get-run.ts: getRun
 * - run/scoring.ts: submitAttempt and the scoring handlers
 * - run/generators.ts: pretest, spaced review and repair questions
 * - run/complete.ts: completeRun, its side effects, endBreak
 * - run/reveal.ts: revealGate, getAnswerReveal, updateAttemptMeta
 * - run/deck-preview.ts: getDeckPreview
 * - run/shared.ts: types and helpers
 */
export type { RunPolicies, RunMetrics, PromptView } from "./run/shared";
export { humanizeObjectiveKey, prependBudget } from "./run/shared";
export { startOrResumeRun, assembleDeck } from "./run/start";
export { getRunPrompt } from "./run/prompt-view";
export { getRun } from "./run/get-run";
export { submitAttempt, variantSourceFor } from "./run/scoring";
export { pretestQuestionText, crossSessionRepairText, reviewQuestionText } from "./run/generators";
export { completeRun, endBreak } from "./run/complete";
export type { DeckComposition } from "./run/deck-preview";
export { getDeckPreview } from "./run/deck-preview";
export type { RevealGate } from "./run/reveal";
export { committedAnswerOf, revealGate, getAnswerReveal, updateAttemptMeta } from "./run/reveal";
