import type { RatedAnswer, SelfScore } from "./types";

/**
 * Confidence results for the end screen: how sure the student was before
 * checking, against how the answer scored. One scale everywhere (VOICE.md):
 * Guessing, Unsure, Sure, stored as 1, 3 and 5. Runs saved before the scale
 * was unified hold 2 ("Unsure") and 4 ("Confident"); they map to the nearest
 * level.
 *
 * The rules stay honest about what one session can show:
 * - Unsure matches any result. Saying you're unsure is never a mismatch.
 * - Sure on an answer that wasn't fully correct is overconfident: those
 *   errors are the ones Error repair brings back first.
 * - A correct answer after Guessing may be luck, so it is never called
 *   underconfident on its own. Underconfidence is reported only as a pattern:
 *   at least MIN_GUESSES_FOR_PATTERN guesses, half or more of them correct.
 * - Nothing is summarised until MIN_RATED answers are rated.
 */

export type ConfidenceLevel = "guessing" | "unsure" | "sure";

export const CONFIDENCE_LEVELS: readonly { level: ConfidenceLevel; label: string }[] = [
  { level: "guessing", label: "Guessing" },
  { level: "unsure", label: "Unsure" },
  { level: "sure", label: "Sure" },
];

/** Rated answers needed before the screen compares confidence with results. */
export const MIN_RATED = 3;
/** Guesses needed before correct guesses count as a pattern. */
export const MIN_GUESSES_FOR_PATTERN = 3;

/** Map a stored rating to a level; null for missing or out-of-range values. */
export function confidenceLevel(rating: number | null | undefined): ConfidenceLevel | null {
  if (rating == null || !Number.isFinite(rating)) return null;
  if (rating < 1 || rating > 5) return null;
  if (rating < 2) return "guessing";
  if (rating < 4) return "unsure";
  return "sure";
}

export interface LevelSummary {
  level: ConfidenceLevel;
  label: string;
  /** Rated answers at this level. */
  count: number;
  correct: number;
  partial: number;
  incorrect: number;
  /** correct / count, the same measure as accuracy; null when count is 0. */
  correctRate: number | null;
}

export type AnswerFit = "matched" | "overconfident" | "guessed-right";

export interface CalibrationSummary {
  levels: LevelSummary[];
  rated: number;
  unrated: number;
  /** True when enough answers are rated to say anything. */
  enough: boolean;
  matched: number;
  overconfident: number;
  /** Correct answers marked Guessing (not a judgement by themselves). */
  guessedRight: number;
  /** guessedRight when it forms a pattern, else 0. */
  underconfident: number;
  /** Question indexes marked Sure that weren't fully correct. */
  overconfidentQuestions: number[];
}

/** How one rated answer compares with its confidence. */
export function answerFit(level: ConfidenceLevel, score: SelfScore): AnswerFit {
  if (level === "sure") return score === "CORRECT" ? "matched" : "overconfident";
  if (level === "guessing") return score === "CORRECT" ? "guessed-right" : "matched";
  return "matched";
}

export function summarizeCalibration(answers: readonly RatedAnswer[]): CalibrationSummary {
  const levels: LevelSummary[] = CONFIDENCE_LEVELS.map(({ level, label }) => ({
    level,
    label,
    count: 0,
    correct: 0,
    partial: 0,
    incorrect: 0,
    correctRate: null,
  }));
  const byLevel = new Map(levels.map((entry) => [entry.level, entry]));

  let unrated = 0;
  let matched = 0;
  let overconfident = 0;
  let guessedRight = 0;
  const overconfidentQuestions: number[] = [];

  for (const answer of answers) {
    const level = confidenceLevel(answer.confidence);
    if (!level) {
      unrated += 1;
      continue;
    }
    const entry = byLevel.get(level)!;
    entry.count += 1;
    if (answer.score === "CORRECT") entry.correct += 1;
    else if (answer.score === "PARTIAL") entry.partial += 1;
    else entry.incorrect += 1;

    const fit = answerFit(level, answer.score);
    if (fit === "matched") matched += 1;
    else if (fit === "overconfident") {
      overconfident += 1;
      overconfidentQuestions.push(answer.prompt_index);
    } else guessedRight += 1;
  }

  for (const entry of levels) {
    entry.correctRate = entry.count > 0 ? entry.correct / entry.count : null;
  }

  const rated = answers.length - unrated;
  const guesses = byLevel.get("guessing")!.count;
  const underconfident =
    guesses >= MIN_GUESSES_FOR_PATTERN && guessedRight * 2 >= guesses ? guessedRight : 0;

  return {
    levels,
    rated,
    unrated,
    enough: rated >= MIN_RATED,
    matched,
    overconfident,
    guessedRight,
    underconfident,
    overconfidentQuestions,
  };
}
