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
  correction_rule?: string
  variant_question?: string
  error_type?: string
}

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
  | { type: "failed"; message: string }
  | { type: "toggle_reflection" }
  | { type: "reflection_field"; field: "selfExplanation" | "socraticAnswer" | "generatedExample"; text: string }
  | { type: "reflection_status"; status: QuestionState["reflection"] }

const ERROR_TYPES: readonly ErrorType[] = ["MISCONCEPTION", "PROCEDURE", "CARELESS", "MEMORY", "UNKNOWN"]

function isErrorType(value: unknown): value is ErrorType {
  return typeof value === "string" && (ERROR_TYPES as readonly string[]).includes(value)
}

export function initialQuestionState(options: { examScoring: boolean; draft?: Draft | null }): QuestionState {
  const draft = options.draft ?? null
  return {
    step: options.examScoring ? "scoring" : "answering",
    answer: options.examScoring ? "" : draft?.answer ?? "",
    choice: null,
    confidence: null,
    seconds: null,
    reveal: { status: "none" },
    score: null,
    errorType: isErrorType(draft?.error_type) ? draft.error_type : "MISCONCEPTION",
    correctionRule: draft?.correction_rule ?? "",
    similarQuestion: draft?.variant_question ?? "",
    pending: null,
    error: null,
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

export function questionReducer(state: QuestionState, action: QuestionAction): QuestionState {
  switch (action.type) {
    case "answer":
      return canEditAnswer(state) ? { ...state, answer: action.text, error: null } : state
    case "choose":
      return canEditAnswer(state) ? { ...state, choice: action.index, error: null } : state
    case "rate":
      return canEditAnswer(state) ? { ...state, confidence: action.value } : state
    case "reveal_start":
      if (state.step !== "answering" || state.pending) return state
      return { ...state, pending: "reveal", error: null, seconds: action.seconds }
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
        ? { ...state, score: action.score, step: "error_log", error: null }
        : { ...state, score: action.score, error: null }
    case "change_score":
      if (state.step !== "error_log" || state.pending) return state
      return { ...state, step: "scoring", score: null, error: null }
    case "error_type":
      return state.pending ? state : { ...state, errorType: action.value }
    case "correction":
      return state.pending ? state : { ...state, correctionRule: action.text, error: null }
    case "similar":
      return state.pending ? state : { ...state, similarQuestion: action.text }
    case "submit_start":
      if (state.pending || state.step === "feedback") return state
      return {
        ...state,
        pending: "submit",
        error: null,
        seconds: action.seconds ?? state.seconds,
      }
    case "submit_blocked":
      // A break started and nothing was recorded: everything typed stays.
      return { ...state, pending: null }
    case "submit_done":
      return { ...state, step: "feedback", pending: null, error: null, outcome: action.outcome }
    case "failed":
      return { ...state, pending: null, error: action.message }
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

/** What to keep in localStorage for this question, or null to clear it. */
export function draftOf(state: QuestionState): Draft | null {
  if (state.step === "feedback") return null
  const draft: Draft = {}
  if (state.answer.trim()) draft.answer = state.answer
  if (state.correctionRule.trim()) draft.correction_rule = state.correctionRule
  if (state.similarQuestion.trim()) draft.variant_question = state.similarQuestion
  if (state.errorType !== "MISCONCEPTION") draft.error_type = state.errorType
  return Object.keys(draft).length > 0 ? draft : null
}
