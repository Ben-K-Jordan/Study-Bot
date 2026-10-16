/**
 * The one confidence scale (VOICE.md): "How sure are you?" with Guessing,
 * Unsure and Sure, stored as 1, 3 and 5. The picker, the end screen and
 * Progress all read ratings through this module, so a stored rating lands in
 * the same level on every screen.
 *
 * Answers saved before the scale was unified used five steps, labelled
 * Guessing (1), Unsure (2), Somewhat (3), Confident (4) and Very sure (5).
 * Each maps to the level with the same meaning: 2 and 3 read as Unsure, and
 * 4 and 5 as Sure.
 */

export type ConfidenceLevel = "guessing" | "unsure" | "sure";

/** The scale in picker order, with the value each level is stored as. */
export const CONFIDENCE_SCALE = [
  { value: 1, level: "guessing", label: "Guessing" },
  { value: 3, level: "unsure", label: "Unsure" },
  { value: 5, level: "sure", label: "Sure" },
] as const satisfies readonly { value: number; level: ConfidenceLevel; label: string }[];

/** A rating the picker stores: 1, 3 or 5. */
export type ConfidenceValue = (typeof CONFIDENCE_SCALE)[number]["value"];

/** The lowest stored rating that reads as Sure (a legacy 4, "Confident", included). */
export const SURE_MIN_RATING = 4;

/** The level a stored rating reads as; null when it is missing or outside 1 to 5. */
export function confidenceLevel(rating: number | null | undefined): ConfidenceLevel | null {
  if (rating == null || !Number.isFinite(rating) || rating < 1 || rating > 5) return null;
  if (rating >= SURE_MIN_RATING) return "sure";
  if (rating < 2) return "guessing";
  return "unsure";
}

/** True when the student marked the answer Sure: confident errors come first in Error repair. */
export function isSureRating(rating: number | null | undefined): boolean {
  return confidenceLevel(rating) === "sure";
}

/** "Guessing", "Unsure" or "Sure". */
export function confidenceLabel(level: ConfidenceLevel): string {
  return CONFIDENCE_SCALE.find((entry) => entry.level === level)!.label;
}
