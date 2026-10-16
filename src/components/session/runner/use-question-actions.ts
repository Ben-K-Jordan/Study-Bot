"use client"

import * as React from "react"

import { ApiError } from "@/lib/client-api"
import { formatNumber } from "@/lib/format"

import { failureMessage, needsReload, revealForAnswer, saveReflection } from "./api"
import {
  answerSeconds,
  buildErrorLog,
  buildExamAnswer,
  buildExamScore,
  buildMcqAttempt,
  buildRecallAttempt,
  formatMcqAnswer,
  mcqCorrectionRule,
  needsErrorLog,
} from "./attempt-payload"
import {
  MAX_ANSWER_LENGTH,
  hasReflection,
  type Outcome,
  type QuestionAction,
  type QuestionState,
} from "./question-reducer"
import { writeDraft } from "./storage"
import { resultCompletesRun, resultStartsBreak, type AttemptSubmitResult, type SelfScore } from "./types"

export interface QuestionActionsInput {
  state: QuestionState
  dispatch: React.Dispatch<QuestionAction>
  runId: string
  index: number
  storageKey: string
  mcq: boolean
  choices: readonly string[]
  examAnswering: boolean
  examScoring: boolean
  isPretest: boolean
  isRepair: boolean
  /** Exam scoring of a multiple-choice answer: the key and the saved pick are both known. */
  examMcq: { scorable: boolean; correct: boolean; key: number | null }
  submit: (attempt: Record<string, unknown>) => Promise<AttemptSubmitResult | null>
  onExamAnswered: (result: AttemptSubmitResult) => void
  onContinue: (outcome: Outcome) => void | Promise<void>
  announce: (message: string) => void
  answerRef: React.RefObject<HTMLTextAreaElement | null>
  correctionRef: React.RefObject<HTMLTextAreaElement | null>
}

/** Codes for an answer the server already has; a retry would only repeat the 409. */
const ALREADY_SAVED = new Set(["duplicate_attempt", "already_scored"])

/** The message a failed save shows, and whether only a reload can fix it. */
export function submitFailure(error: unknown): { message: string; reload: boolean } {
  if (error instanceof ApiError && error.code && ALREADY_SAVED.has(error.code)) {
    // Also what a retry after a timed-out save gets, so no other tab is blamed.
    return { message: "This answer is already saved. Reload to continue.", reload: true }
  }
  const message =
    error instanceof ApiError && error.message
      ? error.message
      : failureMessage(error, "Answer not saved. Your answer is still here.")
  return { message, reload: needsReload(error) }
}

/**
 * Everything the question screen does on a press: submit, reveal, score,
 * save the correction, move on, and retry what failed. The reducer holds
 * the state; this hook only talks to the server and dispatches.
 */
export function useQuestionActions(input: QuestionActionsInput) {
  const { state, dispatch, index, choices, examMcq } = input
  const startedAt = React.useRef(0)
  const busy = React.useRef(false)
  const [leaving, setLeaving] = React.useState(false)

  // Answering time starts when the question appears.
  React.useEffect(() => {
    startedAt.current = performance.now()
  }, [])

  function elapsed(): number {
    return answerSeconds(startedAt.current, performance.now())
  }

  function finishOutcome(result: AttemptSubmitResult, score: SelfScore | null) {
    writeDraft(input.storageKey, null)
    dispatch({
      type: "submit_done",
      outcome: {
        score,
        mcq: result.mcq_result ?? null,
        attemptId: typeof result.attempt_id === "string" ? result.attempt_id : null,
        completes: resultCompletesRun(result),
        startsBreak: resultStartsBreak(result),
      },
    })
  }

  async function send(attempt: Record<string, unknown>): Promise<AttemptSubmitResult | null | "failed"> {
    busy.current = true
    try {
      return await input.submit(attempt)
    } catch (error) {
      dispatch({ type: "failed", ...submitFailure(error) })
      return "failed"
    } finally {
      busy.current = false
    }
  }

  async function submitAnswer() {
    if (busy.current || state.pending || state.step !== "answering") return
    const answer = state.answer.trim()

    if (input.examAnswering) {
      if (input.mcq ? state.choice === null : !answer) return
      const seconds = elapsed()
      dispatch({ type: "submit_start", seconds })
      const payload =
        input.mcq && state.choice !== null
          ? buildExamAnswer({
              index,
              answer: formatMcqAnswer(state.choice, choices[state.choice] ?? ""),
              seconds,
              confidence: state.confidence,
              choiceIndex: state.choice,
            })
          : buildExamAnswer({ index, answer: state.answer, seconds, confidence: state.confidence })
      const result = await send(payload)
      if (result === "failed") return
      if (result === null) {
        dispatch({ type: "submit_blocked" })
        return
      }
      writeDraft(input.storageKey, null)
      input.announce("Answer saved.")
      input.onExamAnswered(result)
      return
    }

    if (input.mcq) {
      if (state.choice === null) return
      const seconds = elapsed()
      dispatch({ type: "submit_start", seconds })
      const result = await send(
        buildMcqAttempt({
          index,
          choiceIndex: state.choice,
          choiceText: choices[state.choice] ?? "",
          seconds,
          confidence: state.confidence,
        })
      )
      if (result === "failed") return
      if (result === null) {
        dispatch({ type: "submit_blocked" })
        return
      }
      const graded = result.mcq_result ?? null
      // A missing result is never shown as correct.
      finishOutcome(result, graded ? (graded.is_correct ? "CORRECT" : "INCORRECT") : null)
      return
    }

    if (!answer) return
    if (answer.length > MAX_ANSWER_LENGTH) {
      dispatch({
        type: "field_error",
        error: {
          field: "answer",
          message: `Shorten your answer to ${formatNumber(MAX_ANSWER_LENGTH)} characters or fewer. It has ${formatNumber(answer.length)}.`,
        },
      })
      input.answerRef.current?.focus()
      return
    }
    dispatch({ type: "reveal_start", seconds: elapsed() })
    busy.current = true
    try {
      const reveal = await revealForAnswer(input.runId, index, answer)
      dispatch({ type: "reveal_done", reveal })
      input.announce(
        reveal.model_answer || reveal.key_points?.length
          ? "Model answer shown. Score your answer against it."
          : "This question has no model answer. Score it against your materials."
      )
    } catch (error) {
      dispatch({
        type: "failed",
        message: failureMessage(error, "The model answer didn't load. Your answer is still here."),
        reload: needsReload(error),
      })
    } finally {
      busy.current = false
    }
  }

  async function saveScore(score: SelfScore, errorLog: ReturnType<typeof buildErrorLog> | null) {
    dispatch({ type: "submit_start" })
    const payload = input.examScoring
      ? buildExamScore({ index, score, errorLog })
      : buildRecallAttempt({
          index,
          answer: state.answer,
          score,
          seconds: state.seconds ?? elapsed(),
          confidence: state.confidence,
          isPretest: input.isPretest,
          isRepair: input.isRepair,
          errorLog,
        })
    const result = await send(payload)
    if (result === "failed") return
    if (result === null) {
      dispatch({ type: "submit_blocked" })
      return
    }
    finishOutcome(result, score)
  }

  function chooseScore(score: SelfScore) {
    if (busy.current || state.pending || state.step !== "scoring") return
    const errorLog = needsErrorLog({
      score,
      isPretest: input.isPretest,
      isRepair: input.isRepair,
      examScoring: input.examScoring,
    })
    dispatch({ type: "score", score, errorLog })
    if (!errorLog) void saveScore(score, null)
  }

  function saveExamMcqScore() {
    if (busy.current || state.pending || state.step !== "scoring" || !examMcq.scorable) return
    if (examMcq.correct) {
      dispatch({ type: "score", score: "CORRECT", errorLog: false })
      void saveScore("CORRECT", null)
    } else {
      dispatch({ type: "score", score: "INCORRECT", errorLog: false })
      void saveScore("INCORRECT", mcqCorrectionRule(examMcq.key === null ? "" : (choices[examMcq.key] ?? "")))
    }
  }

  function saveCorrection() {
    if (busy.current || state.pending || state.step !== "error_log" || !state.score) return
    if (!state.correctionRule.trim()) {
      // Shown beside the field (role="alert" there), not only announced.
      dispatch({ type: "field_error", error: { field: "correction", message: "Write the correction rule first." } })
      input.correctionRef.current?.focus()
      return
    }
    void saveScore(
      state.score,
      buildErrorLog({
        errorType: state.errorType,
        correctionRule: state.correctionRule,
        similarQuestion: state.similarQuestion,
      })
    )
  }

  async function continueOn() {
    const outcome = state.outcome
    if (!outcome || leaving || state.reflection === "saving") return
    if (hasReflection(state) && outcome.attemptId) {
      dispatch({ type: "reflection_status", status: "saving" })
      try {
        await saveReflection(outcome.attemptId, {
          self_explanation: state.selfExplanation.trim() || undefined,
          generated_example: state.generatedExample.trim() || undefined,
          socratic_answer: state.socraticAnswer.trim() || undefined,
        })
        dispatch({ type: "reflection_status", status: "idle" })
      } catch {
        dispatch({ type: "reflection_status", status: "failed" })
        return
      }
    }
    setLeaving(true)
    try {
      await input.onContinue(outcome)
    } finally {
      setLeaving(false)
    }
  }

  /** Retry repeats whatever failed on this step. */
  function retryFailedAction() {
    if (state.step === "answering") void submitAnswer()
    else if (state.step === "error_log") saveCorrection()
    else if (examMcq.scorable) saveExamMcqScore()
    else if (state.score && !busy.current) void saveScore(state.score, null)
  }

  return { submitAnswer, chooseScore, saveExamMcqScore, saveCorrection, continueOn, retryFailedAction, leaving }
}
