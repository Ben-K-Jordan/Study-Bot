/**
 * Builders for the attempt payloads POST /api/runs/:runId/attempt accepts
 * (src/lib/validation.ts), plus the small rules around them. Pure, so the
 * contract is unit-tested without a browser.
 */
import { isSureRating } from "@/lib/confidence"
import type { Confidence, ErrorLogPayload, ErrorType, SelfScore } from "./types"

/** The server rejects time_to_answer_seconds above 7200; stay under it. */
export const MAX_ANSWER_SECONDS = 7199

/** Whole seconds between two timestamps (ms), clamped to 0..MAX_ANSWER_SECONDS. */
export function answerSeconds(startMs: number, endMs: number): number {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0
  const seconds = Math.round((endMs - startMs) / 1000)
  return Math.min(MAX_ANSWER_SECONDS, Math.max(0, seconds))
}

const LETTERS = ["A", "B", "C", "D"] as const

/** Letter for a choice index: 0 is "A". */
export function choiceLetter(index: number): string {
  return LETTERS[index] ?? String.fromCharCode(65 + index)
}

/** The stored form of a multiple-choice answer: "[B] The heap". */
export function formatMcqAnswer(index: number, text: string): string {
  return `[${choiceLetter(index)}] ${text}`
}

/** The choice index inside a stored answer ("[B] ..." is 1), or null. */
export function parseMcqAnswer(answer: string | null | undefined): number | null {
  const match = answer?.match(/^\[([A-D])\]/)
  return match ? match[1].charCodeAt(0) - 65 : null
}

/** Confidence is sent only when the student rated it; never a default. */
function withConfidence(confidence: Confidence | null): { confidence_rating?: Confidence } {
  return confidence === null ? {} : { confidence_rating: confidence }
}

/**
 * Whether a score needs the error log step before it can be saved.
 * Correct answers never do. Pretest questions (not studied yet) and repair
 * questions (they already carry a correction) skip it when scored right
 * away. Exam-simulation scoring always needs it: the server requires an
 * error log for every partly correct or incorrect exam answer.
 */
export function needsErrorLog(input: {
  score: SelfScore
  isPretest: boolean
  isRepair: boolean
  examScoring: boolean
}): boolean {
  if (input.score === "CORRECT") return false
  if (input.examScoring) return true
  return !input.isPretest && !input.isRepair
}

export function buildErrorLog(input: {
  errorType: ErrorType
  correctionRule: string
  similarQuestion: string
}): ErrorLogPayload {
  const similar = input.similarQuestion.trim()
  return {
    error_type: input.errorType,
    correction_rule: input.correctionRule.trim(),
    ...(similar ? { variant_question: similar } : {}),
  }
}

/** Exam simulation, answering phase: saved without a score. */
export function buildExamAnswer(input: {
  index: number
  answer: string
  seconds: number
  confidence: Confidence | null
  choiceIndex?: number
}): Record<string, unknown> {
  return {
    prompt_index: input.index,
    kind: "ANSWER",
    user_answer: input.answer,
    time_to_answer_seconds: input.seconds,
    ...(input.choiceIndex === undefined ? {} : { mcq_choice_index: input.choiceIndex }),
    ...withConfidence(input.confidence),
  }
}

/** Multiple choice outside an exam: the server grades the chosen index. */
export function buildMcqAttempt(input: {
  index: number
  choiceIndex: number
  choiceText: string
  seconds: number
  confidence: Confidence | null
}): Record<string, unknown> {
  return {
    prompt_index: input.index,
    user_answer: formatMcqAnswer(input.choiceIndex, input.choiceText),
    time_to_answer_seconds: input.seconds,
    mcq_choice_index: input.choiceIndex,
    ...withConfidence(input.confidence),
  }
}

/** Free recall outside an exam: the student's own score, with an error log when needed. */
export function buildRecallAttempt(input: {
  index: number
  answer: string
  score: SelfScore
  seconds: number
  confidence: Confidence | null
  isPretest: boolean
  isRepair: boolean
  errorLog: ErrorLogPayload | null
}): Record<string, unknown> {
  const attempt: Record<string, unknown> = {
    prompt_index: input.index,
    user_answer: input.answer,
    self_score: input.score,
    time_to_answer_seconds: input.seconds,
    ...withConfidence(input.confidence),
  }
  if (input.isPretest) attempt.is_pretest = true
  if (input.isRepair) attempt.is_repair = true
  if (input.score !== "CORRECT" && input.errorLog && !input.isPretest && !input.isRepair) {
    attempt.error_log = input.errorLog
  }
  return attempt
}

/** Exam simulation, scoring phase: scores the answer saved earlier. */
export function buildExamScore(input: {
  index: number
  score: SelfScore
  errorLog: ErrorLogPayload | null
}): Record<string, unknown> {
  return {
    prompt_index: input.index,
    kind: "SCORE",
    self_score: input.score,
    ...(input.score !== "CORRECT" && input.errorLog ? { error_log: input.errorLog } : {}),
  }
}

/**
 * The correction recorded for an incorrect multiple-choice exam answer.
 * Same wording as the server's for graded multiple choice (services/run.ts):
 * auto-flashcards looks for `The correct answer is "X"` to turn a "Which of
 * the following" stem into a card that can be answered without its options.
 */
export function mcqCorrectionRule(correctChoice: string): ErrorLogPayload {
  return { error_type: "MISCONCEPTION", correction_rule: `The correct answer is "${correctChoice.trim()}".` }
}

/**
 * A confident error: an answer marked Sure (legacy ratings of 4 count too)
 * that was partly or wholly wrong. Never for pretest questions, which are
 * expected to be wrong.
 */
export function isConfidentError(input: {
  score: SelfScore | null
  confidence: number | null | undefined
  isPretest: boolean
}): boolean {
  if (input.isPretest || input.score === null || input.score === "CORRECT") return false
  return isSureRating(input.confidence)
}
