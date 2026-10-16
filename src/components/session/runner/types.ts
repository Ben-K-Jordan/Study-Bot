/**
 * The shapes the runner reads. They mirror the session screen's RunData and
 * SessionData structurally (only the fields the runner uses), so the runner
 * does not import the parent's module and either side can change its own
 * extra fields freely.
 */

export type SelfScore = "CORRECT" | "PARTIAL" | "INCORRECT"

export type ErrorType = "MISCONCEPTION" | "PROCEDURE" | "CARELESS" | "MEMORY" | "UNKNOWN"

/** The one confidence scale, stored as 1, 3 and 5. */
export type Confidence = 1 | 3 | 5

export interface RunnerPrompt {
  prompt_index: number
  text: string
  objective_id?: string
  difficulty?: number
  source_type?: string
  format?: "FREE_RECALL" | "MCQ"
  choices?: string[]
  /** Served only while scoring an exam simulation. */
  correctIndex?: number
  meta?: {
    distractorRationales?: string[]
    original_prompt_text?: string
    pack?: string
    [key: string]: unknown
  }
}

export interface RunnerAttemptRecord {
  id: string
  prompt_index: number
  user_answer: string
  self_score: string | null
  confidence_rating?: number | null
}

export interface RunnerRun {
  run_id: string
  status: string
  mode: string
  phase: string
  current_index: number
  prompt_count: number
  current_prompt: RunnerPrompt | null
  /** Saved answers; present while scoring an exam simulation. */
  attempts?: RunnerAttemptRecord[]
  /**
   * The deck the run started with (redacted). Repair questions added during
   * the run are stored apart from it, so prompt_count minus its length is
   * how many were added, even after a refresh.
   */
  prompts?: readonly unknown[]
  break_state?: { on_break?: boolean } | null
}

export interface RunnerSession {
  session_id: string
  course_name: string
  mode: string
  mode_label: string
}

/** Server-graded multiple-choice outcome from POST /attempt. */
export interface McqResult {
  selected_index: number
  correct_index: number
  is_correct: boolean
  correct_choice: string
  rationale?: string
}

/** The attempt response; other fields are read through the guards below. */
export interface AttemptSubmitResult {
  attempt_id?: string
  status?: string
  mcq_result?: McqResult | null
  [key: string]: unknown
}

export interface ErrorLogPayload {
  error_type: ErrorType
  correction_rule: string
  variant_question?: string
}

/** Numbered source passage behind a piece of feedback. */
export interface FeedbackSource {
  chunk_id: string
  doc_title: string
  page_number: number | null
  snippet: string
  rank: number
}

export interface FeedbackPayload {
  status: string
  excerpts: FeedbackSource[]
  no_sources?: boolean
  explanation?: string
  key_takeaway?: string
  concept_connection?: string
  mnemonic?: string
  pattern_advice?: string
  reinforcement?: string
  deeper_insight?: string
  socratic_followup?: string
  socratic_purpose?: string
}

export interface RevealPayload {
  model_answer: string | null
  key_points: string[] | null
  committed_answer?: string | null
}

/** True when the run finished with this attempt (the last question). */
export function resultCompletesRun(result: AttemptSubmitResult | null | undefined): boolean {
  return result?.status === "COMPLETED"
}

/** True when a break starts after this attempt. */
export function resultStartsBreak(result: AttemptSubmitResult | null | undefined): boolean {
  const state = result?.break_state as { on_break?: unknown } | null | undefined
  return state?.on_break === true
}

/** The run phase the attempt moved to, when the server says. */
export function resultPhase(result: AttemptSubmitResult | null | undefined): string | null {
  return typeof result?.phase === "string" ? result.phase : null
}

/**
 * Exam scoring shows each question's saved answer, so the runner loads the
 * answers when the run payload lacks them. They stay needed while a scored
 * question is still on screen: its feedback outlasts the REVIEW phase once
 * the last score completes the run.
 */
export function needsSavedAnswers(input: {
  runPhase: string
  /** The phase of the question held on screen for its feedback, if any. */
  shownPhase: string | null | undefined
  hasAttempts: boolean
}): boolean {
  if (input.hasAttempts) return false
  return input.runPhase === "REVIEW" || input.shownPhase === "REVIEW"
}

/** Worked-example completion problems carry the solution's step count. */
export function promptStepCount(prompt: RunnerPrompt): number | null {
  const value = prompt.meta?.step_count
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null
}

/**
 * Repair questions added to this run so far. They are stored apart from the
 * starting deck, so the count survives a refresh; without the deck, fall
 * back to the growth seen since the screen opened.
 */
export function repairsAdded(run: Pick<RunnerRun, "prompt_count" | "prompts">, totalAtOpen: number): number {
  const base = Array.isArray(run.prompts) && run.prompts.length > 0 ? run.prompts.length : totalAtOpen
  return Math.max(0, run.prompt_count - base)
}
