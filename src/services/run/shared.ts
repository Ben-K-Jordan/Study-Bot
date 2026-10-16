/**
 * Types, sentinel errors and small helpers shared by the run modules.
 */
import { plural } from "@/lib/format";

// ---- Sentinel errors for transaction control flow ----

export class DuplicateAttemptError extends Error {
  constructor() { super("duplicate_attempt"); }
}

export class WrongIndexError extends Error {
  expected: number;
  constructor(expected: number) { super("wrong_index"); this.expected = expected; }
}

export class RunCompletedError extends Error {
  constructor() { super("run_completed"); }
}

// ---- Types ----

export interface RunPolicies {
  scoring: "IMMEDIATE" | "DELAYED";
  requiresErrorLogOn: string[];
  allowHintsBeforeAnswer: boolean;
  allowEndBreakEarly: boolean;
}

export interface RunMetrics {
  attempts_count: number;
  correct_count: number;
  partial_count: number;
  incorrect_count: number;
  accuracy: number;
  time_spent_seconds: number;
  // Pretest items are diagnostic (Richland 2009) — tracked separately so
  // expected pre-study errors never contaminate accuracy or mastery.
  pretest_count?: number;
  pretest_correct?: number;
  recommended_followups?: { label: string; days_from_now: number; date: string }[];
}

export interface PromptView {
  prompt_index: number;
  text: string;
  objective_id?: string;
  difficulty?: number;
  source_type?: string;
  format?: "FREE_RECALL" | "MCQ";
  choices?: string[];
  correctIndex?: number;
  meta?: {
    distractorRationales?: string[];
    /** Deck-pack marker (PRE_TEST, WORKED_EXAMPLE, WE_*) — drives UI framing. */
    pack?: string;
    /** Worked-example completion problems: how many steps the full solution has. */
    step_count?: number;
    [key: string]: unknown;
  };
}

export { humanizeObjectiveKey } from "@/lib/objective-keys";

/** How long ago something happened, as a whole phrase: "today", "1 day ago". */
export function daysAgoPhrase(days: number): string {
  return plural(Math.max(0, days), { zero: "today", one: "# day ago", other: "# days ago" });
}

export function emptyMetrics(): RunMetrics {
  return {
    attempts_count: 0,
    correct_count: 0,
    partial_count: 0,
    incorrect_count: 0,
    accuracy: 0,
    time_spent_seconds: 0,
  };
}

export function policiesForMode(mode: string): RunPolicies {
  switch (mode) {
    case "EXAM_SIM":
      return {
        scoring: "DELAYED",
        requiresErrorLogOn: ["PARTIAL", "INCORRECT"],
        allowHintsBeforeAnswer: false,
        allowEndBreakEarly: true,
      };
    case "ERROR_REPAIR":
    case "INTERLEAVED_PRACTICE":
    case "RETRIEVAL":
    default:
      return {
        scoring: "IMMEDIATE",
        requiresErrorLogOn: ["PARTIAL", "INCORRECT"],
        allowHintsBeforeAnswer: false,
        allowEndBreakEarly: true,
      };
  }
}

export function initialPhaseForMode(mode: string): string {
  return mode === "EXAM_SIM" ? "EXAM" : "ACTIVE";
}

/**
 * How many deck slots review/diagnostic/repair injections may occupy.
 * Scales with session size, capped at 3 — the deck total never exceeds
 * what the student asked for.
 */
export function prependBudget(promptCount: number): number {
  if (promptCount < 2) return 0;
  return Math.min(3, Math.ceil(promptCount / 4));
}
