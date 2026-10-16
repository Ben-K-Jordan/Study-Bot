/**
 * One question's state, from answering to feedback. The screen keys a fresh
 * reducer on every question, so nothing has to be reset by hand.
 *
 *   answering ──submit──▶ scoring ──score──▶ (error_log) ──save──▶ feedback
 *        │  (free recall: the model answer is revealed on the way)   ▲
 *        └──── multiple choice: submit is graded by the server ──────┘
 *
 * Exam simulation answers leave the screen right after saving; exam scoring
 * starts in `scoring`.
 */
import type { Confidence, ErrorType, McqResult, RevealPayload, SelfScore } from "./types"

export type Step = "answering" | "scoring" | "error_log" | "feedback"

export interface Outcome {
  /** The recorded score; null when a multiple-choice result didn't come back. */
  score: SelfScore | null
  mcq: McqResult | null
  attemptId: string | null
  /** This was the run's last question. */
  completes: boolean
  /** A break starts after this question. */
  startsBreak: boolean
}

export type RevealState =
  | { status: "none" }
  | { status: "ready"; modelAnswer: string | null; keyPoints: string[] }

export interface Draft {
  answer?: string
  /** The multiple-choice pick, as a zero-based index. */
  choice?: number
  /** The confidence rating: 1, 3 or 5. */
  confidence?: number
  correction_rule?: string
  variant_question?: string
  error_type?: string
}

/** A field the student has to fix before the action can go ahead. */
export interface FieldError {
  field: "answer" | "correction"
  message: string
}

/** The longest written answer POST /reveal accepts, counted after trimming. */
export const MAX_ANSWER_LENGTH = 20_000

export interface QuestionState {
  step: Step
  answer: string
  choice: number | null
  confidence: Confidence | null
  /** Answering time in seconds, fixed when the answer is committed. */
  seconds: number | null
  reveal: RevealState
  score: SelfScore | null
  errorType: ErrorType
  correctionRule: string
  similarQuestion: string
  pending: "reveal" | "submit" | null
  /** What the last action failed with; the input stays as typed. */
  error: string | null
  /** Only a reload fixes the failure (another tab moved the session on); Retry would repeat it. */
  errorReload: boolean
  /** A field to fix before the action can go ahead, shown beside that field. */
  fieldError: FieldError | null
  outcome: Outcome | null
  reflectionOpen: boolean
  selfExplanation: string
  socraticAnswer: string
  generatedExample: string
  reflection: "idle" | "saving" | "failed"
}

export type QuestionAction =
  | { type: "answer"; text: string }
  | { type: "choose"; index: number }
  | { type: "rate"; value: Confidence }
  | { type: "reveal_start"; seconds: number }
  | { type: "reveal_done"; reveal: RevealPayload }
  | { type: "score"; score: SelfScore; errorLog: boolean }
  | { type: "change_score" }
  | { type: "error_type"; value: ErrorType }
  | { type: "correction"; text: string }
  | { type: "similar"; text: string }
  | { type: "submit_start"; seconds?: number }
  | { type: "submit_blocked" }
  | { type: "submit_done"; outcome: Outcome }
  | { type: "failed"; message: string; reload?: boolean }
  | { type: "field_error"; error: FieldError }
  | { type: "toggle_reflection" }
  | { type: "reflection_field"; field: "selfExplanation" | "socraticAnswer" | "generatedExample"; text: string }
  | { type: "reflection_status"; status: QuestionState["reflection"] }

const ERROR_TYPES: readonly ErrorType[] = ["MISCONCEPTION", "PROCEDURE", "CARELESS", "MEMORY", "UNKNOWN"]

function isErrorType(value: unknown): value is ErrorType {
  return typeof value === "string" && (ERROR_TYPES as readonly string[]).includes(value)
}

function isConfidence(value: unknown): value is Confidence {
  return value === 1 || value === 3 || value === 5
}

/** A saved pick that still points at one of this question's choices, else null. */
function restoredChoice(value: unknown, choiceCount: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < choiceCount ? value : null
}

export function initialQuestionState(options: {
  examScoring: boolean
  draft?: Draft | null
  /** How many choices a multiple-choice question has; 0 (the default) for free recall. */
  choiceCount?: number
}): QuestionState {
  const draft = options.draft ?? null
  // Exam scoring reads the answer saved during the exam, never a draft.
  const answering = options.examScoring ? null : draft
  return {
    step: options.examScoring ? "scoring" : "answering",
    answer: answering?.answer ?? "",
    choice: restoredChoice(answering?.choice, options.choiceCount ?? 0),
    confidence: isConfidence(answering?.confidence) ? answering.confidence : null,
    seconds: null,
    reveal: { status: "none" },
    score: null,
    errorType: isErrorType(draft?.error_type) ? draft.error_type : "MISCONCEPTION",
    correctionRule: draft?.correction_rule ?? "",
    similarQuestion: draft?.variant_question ?? "",
    pending: null,
    error: null,
    errorReload: false,
    fieldError: null,
    outcome: null,
    reflectionOpen: false,
    selfExplanation: "",
    socraticAnswer: "",
    generatedExample: "",
    reflection: "idle",
  }
}

/** Answer edits are only accepted before anything is committed. */
function canEditAnswer(state: QuestionState): boolean {
  return state.step === "answering" && state.pending === null
}

/** Clears the error shown beside `field` once the student edits it. */
function clearFieldError(state: QuestionState, field: FieldError["field"]): FieldError | null {
  return state.fieldError?.field === field ? null : state.fieldError
}

export function questionReducer(state: QuestionState, action: QuestionAction): QuestionState {
  switch (action.type) {
    case "answer":
      return canEditAnswer(state)
        ? { ...state, answer: action.text, error: null, errorReload: false, fieldError: clearFieldError(state, "answer") }
        : state
    case "choose":
      return canEditAnswer(state) ? { ...state, choice: action.index, error: null, errorReload: false } : state
    case "rate":
      return canEditAnswer(state) ? { ...state, confidence: action.value } : state
    case "reveal_start":
      if (state.step !== "answering" || state.pending) return state
      return { ...state, pending: "reveal", error: null, errorReload: false, fieldError: null, seconds: action.seconds }
    case "reveal_done": {
      if (state.pending !== "reveal") return state
      const committed = action.reveal.committed_answer?.trim()
      return {
        ...state,
        step: "scoring",
        pending: null,
        // The server keeps the first answer committed for this question.
        answer: committed || state.answer,
        reveal: {
          status: "ready",
          modelAnswer: action.reveal.model_answer?.trim() || null,
          keyPoints: (action.reveal.key_points ?? []).filter((p) => p.trim().length > 0),
        },
      }
    }
    case "score":
      if (state.step !== "scoring" || state.pending) return state
      return action.errorLog
        ? { ...state, score: action.score, step: "error_log", error: null, errorReload: false }
        : { ...state, score: action.score, error: null, errorReload: false }
    case "change_score":
      if (state.step !== "error_log" || state.pending) return state
      return { ...state, step: "scoring", score: null, error: null, errorReload: false, fieldError: null }
    case "error_type":
      return state.pending ? state : { ...state, errorType: action.value }
    case "correction":
      return state.pending
        ? state
        : {
            ...state,
            correctionRule: action.text,
            error: null,
            errorReload: false,
            fieldError: clearFieldError(state, "correction"),
          }
    case "similar":
      return state.pending ? state : { ...state, similarQuestion: action.text }
    case "submit_start":
      if (state.pending || state.step === "feedback") return state
      return {
        ...state,
        pending: "submit",
        error: null,
        errorReload: false,
        fieldError: null,
        seconds: action.seconds ?? state.seconds,
      }
    case "submit_blocked":
      // A break started and nothing was recorded: everything typed stays.
      return { ...state, pending: null }
    case "submit_done":
      return { ...state, step: "feedback", pending: null, error: null, errorReload: false, outcome: action.outcome }
    case "failed":
      return { ...state, pending: null, error: action.message, errorReload: action.reload === true }
    case "field_error":
      return state.pending ? state : { ...state, fieldError: action.error }
    case "toggle_reflection":
      return { ...state, reflectionOpen: !state.reflectionOpen }
    case "reflection_field":
      return { ...state, [action.field]: action.text, reflection: state.reflection === "failed" ? "failed" : "idle" }
    case "reflection_status":
      return { ...state, reflection: action.status }
  }
}

/** True when there is reflection text to save with the attempt. */
export function hasReflection(state: QuestionState): boolean {
  return Boolean(state.selfExplanation.trim() || state.socraticAnswer.trim() || state.generatedExample.trim())
}

/**
 * What to keep in localStorage for this question, or null to clear it:
 * everything the student typed or picked, so a refresh, a crash or a break
 * that interrupts the save costs nothing.
 */
export function draftOf(state: QuestionState): Draft | null {
  if (state.step === "feedback") return null
  const draft: Draft = {}
  if (state.answer.trim()) draft.answer = state.answer
  if (state.choice !== null) draft.choice = state.choice
  if (state.confidence !== null) draft.confidence = state.confidence
  if (state.correctionRule.trim()) draft.correction_rule = state.correctionRule
  if (state.similarQuestion.trim()) draft.variant_question = state.similarQuestion
  if (state.errorType !== "MISCONCEPTION") draft.error_type = state.errorType
  return Object.keys(draft).length > 0 ? draft : null
}
