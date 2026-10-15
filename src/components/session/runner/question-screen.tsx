"use client"

import * as React from "react"
import { RotateCcwIcon } from "lucide-react"

import { ErrorState } from "@/components/app/error-state"
import { AnswerOption, AnswerOptionGroup, type AnswerOptionResult } from "@/components/lesson/answer-option"
import { ConfidencePicker } from "@/components/lesson/confidence-picker"
import { FeedbackSheet, type FeedbackTone } from "@/components/lesson/feedback-sheet"
import { FreeRecallInput } from "@/components/lesson/free-recall-input"
import { LessonButton } from "@/components/lesson/lesson-button"
import { LessonFrame } from "@/components/lesson/lesson-frame"
import { ApiError } from "@/lib/client-api"
import { useApi } from "@/lib/swr"

import { failureMessage, revealForAnswer, revealUrl, saveReflection } from "./api"
import {
  answerSeconds,
  buildErrorLog,
  buildExamAnswer,
  buildExamScore,
  buildMcqAttempt,
  buildRecallAttempt,
  formatMcqAnswer,
  isConfidentError,
  mcqCorrectionRule,
  needsErrorLog,
  parseMcqAnswer,
} from "./attempt-payload"
import { FeedbackBody } from "./feedback-body"
import { CONFIDENCE_KEYS, matchHotkey, type Binding } from "./hotkeys"
import { KeyboardHelp } from "./keyboard-help"
import { AnswerEcho, ModelAnswerCard, ModelAnswerSkeleton } from "./parts"
import { QuestionFraming, WorkedSteps } from "./question-framing"
import {
  isMcqPrompt,
  isPretestKind,
  isRepairKind,
  parseWorkedExample,
  questionKind,
  splitQuestion,
  stripCompletionTrailer,
} from "./question-kind"
import { draftOf, hasReflection, initialQuestionState, questionReducer, type Outcome } from "./question-reducer"
import { InlineText, RichText } from "./rich-text"
import { ErrorLogForm, ScoreBar } from "./scoring"
import { draftKey, readDraft, writeDraft, writeDraftJson } from "./storage"
import {
  resultCompletesRun,
  resultStartsBreak,
  type AttemptSubmitResult,
  type Confidence,
  type RevealPayload,
  type RunnerPrompt,
  type SelfScore,
} from "./types"
import { useFeedback } from "./use-feedback"

export interface SavedAnswer {
  status: "ready" | "loading" | "failed"
  answer: string | null
  confidence: number | null
  retry: () => void
}

export interface QuestionScreenProps {
  runId: string
  mode: string
  /** Phase the question belongs to: ACTIVE, EXAM or REVIEW. */
  phase: string
  index: number
  prompt: RunnerPrompt
  total: number
  /** Status beside the counter: "Answering", "Scoring", a repair note. */
  status?: React.ReactNode
  /** Exam simulation scoring: the answer saved during the exam. */
  saved: SavedAnswer | null
  submit: (attempt: Record<string, unknown>) => Promise<AttemptSubmitResult | null>
  /** Exam simulation answer saved: show the next question, or the break it started. */
  onExamAnswered: (result: AttemptSubmitResult) => void
  /** After feedback: the next question, the results, or the break. */
  onContinue: (outcome: Outcome) => void | Promise<void>
  announce: (message: string) => void
  shortcutsEnabled: boolean
  onShortcutsEnabledChange: (enabled: boolean) => void
}

const SCORE_TITLES: Record<SelfScore, { title: string; tone: FeedbackTone }> = {
  CORRECT: { title: "Correct", tone: "correct" },
  PARTIAL: { title: "Partly correct", tone: "neutral" },
  INCORRECT: { title: "Incorrect", tone: "wrong" },
}

function confidenceKeyValue(key: string): Confidence | null {
  if (key === "q") return 1
  if (key === "w") return 3
  if (key === "e") return 5
  return null
}

/** "Answer not saved." + "Your text is still here. Retry in a moment." */
function splitMessage(message: string): { title: string; description?: string } {
  const match = message.match(/^(.+?[.?])\s+(.+)$/)
  return match ? { title: match[1], description: match[2] } : { title: message }
}

/**
 * One question, one screen: answer, check, score, fix, feedback. Keyed by
 * the session screen on every question, so its state starts fresh each
 * time and the answered question stays on screen until the student moves
 * on, even after the run has already advanced underneath.
 */
export function QuestionScreen({
  runId,
  mode,
  phase,
  index,
  prompt,
  total,
  status,
  saved,
  submit,
  onExamAnswered,
  onContinue,
  announce,
  shortcutsEnabled,
  onShortcutsEnabledChange,
}: QuestionScreenProps) {
  const examAnswering = mode === "EXAM_SIM" && phase === "EXAM"
  const examScoring = phase === "REVIEW"
  const kind = questionKind(prompt)
  const isPretest = isPretestKind(kind)
  const isRepair = isRepairKind(kind)
  const mcq = isMcqPrompt(prompt)
  const choices = mcq ? prompt.choices ?? [] : []
  const storageKey = draftKey(runId, phase, index)

  const [state, dispatch] = React.useReducer(questionReducer, undefined, () =>
    initialQuestionState({ examScoring, draft: readDraft(storageKey) })
  )
  const [helpOpen, setHelpOpen] = React.useState(false)
  const [leaving, setLeaving] = React.useState(false)

  const questionId = React.useId()
  const errorLogHeadingId = React.useId()
  const stepsHeadingId = React.useId()
  const startedAt = React.useRef(0)
  const busy = React.useRef(false)
  const answerRef = React.useRef<HTMLTextAreaElement>(null)
  const correctionRef = React.useRef<HTMLTextAreaElement>(null)
  const optionsRef = React.useRef<HTMLDivElement>(null)
  const scoringRef = React.useRef<HTMLDivElement>(null)

  // Answering time starts when the question appears.
  React.useEffect(() => {
    startedAt.current = performance.now()
  }, [])

  // Keep the typed work until the server accepts it (refreshes, crashes,
  // a break that interrupts the save). Cleared once the answer is saved.
  const draft = draftOf(state)
  const draftJson = draft ? JSON.stringify(draft) : null
  React.useEffect(() => {
    writeDraftJson(storageKey, draftJson)
  }, [storageKey, draftJson])

  // Focus follows the step: the answer box, the options, the scoring area,
  // the correction rule. The feedback sheet focuses its own button.
  React.useEffect(() => {
    // preventScroll keeps the question in view: on a phone the answer box
    // can sit below the fold, and jumping to it would hide the question.
    if (state.step === "answering") {
      if (mcq) optionsRef.current?.querySelector<HTMLInputElement>("input[type=radio]")?.focus({ preventScroll: true })
      else answerRef.current?.focus({ preventScroll: true })
    } else if (state.step === "scoring") {
      scoringRef.current?.focus({ preventScroll: true })
    } else if (state.step === "error_log") {
      // Start typing at once, with the form's heading at the top of the view.
      correctionRef.current?.focus({ preventScroll: true })
      document.getElementById(errorLogHeadingId)?.scrollIntoView({ block: "start" })
    }
  }, [state.step, mcq, errorLogHeadingId])

  // Exam scoring: the model answer is shown for the saved answer.
  const examReveal = useApi<RevealPayload>(examScoring && !mcq ? revealUrl(runId, index) : null)

  const savedAnswer = examScoring ? saved?.answer ?? null : null
  const savedChoice = examScoring && mcq ? parseMcqAnswer(savedAnswer) : null
  const examKey = examScoring && mcq && typeof prompt.correctIndex === "number" ? prompt.correctIndex : null
  const examMcqScorable = examKey !== null && savedChoice !== null
  const examMcqCorrect = examMcqScorable && savedChoice === examKey

  const outcome = state.outcome
  const feedback = useFeedback(state.step === "feedback" ? outcome?.attemptId ?? null : null)

  // ---------------------------------------------------------------- actions

  function elapsed(): number {
    return answerSeconds(startedAt.current, performance.now())
  }

  function finishOutcome(result: AttemptSubmitResult, score: SelfScore | null) {
    writeDraft(storageKey, null)
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

  function submitFailed(error: unknown) {
    const message =
      error instanceof ApiError && error.message
        ? error.message
        : failureMessage(error, "Answer not saved. Your text is still here.")
    dispatch({ type: "failed", message })
  }

  async function send(attempt: Record<string, unknown>): Promise<AttemptSubmitResult | null | "failed"> {
    busy.current = true
    try {
      return await submit(attempt)
    } catch (error) {
      submitFailed(error)
      return "failed"
    } finally {
      busy.current = false
    }
  }

  async function submitAnswer() {
    if (busy.current || state.pending || state.step !== "answering") return
    const answer = state.answer.trim()

    if (examAnswering) {
      if (mcq ? state.choice === null : !answer) return
      const seconds = elapsed()
      dispatch({ type: "submit_start", seconds })
      const payload = mcq
        ? buildExamAnswer({
            index,
            answer: formatMcqAnswer(state.choice!, choices[state.choice!] ?? ""),
            seconds,
            confidence: state.confidence,
            choiceIndex: state.choice!,
          })
        : buildExamAnswer({ index, answer: state.answer, seconds, confidence: state.confidence })
      const result = await send(payload)
      if (result === "failed") return
      if (result === null) {
        dispatch({ type: "submit_blocked" })
        return
      }
      writeDraft(storageKey, null)
      announce("Answer saved.")
      onExamAnswered(result)
      return
    }

    if (mcq) {
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
    dispatch({ type: "reveal_start", seconds: elapsed() })
    busy.current = true
    try {
      const reveal = await revealForAnswer(runId, index, answer)
      dispatch({ type: "reveal_done", reveal })
      announce(
        reveal.model_answer || reveal.key_points?.length
          ? "Model answer shown. Score your answer against it."
          : "This question has no model answer. Score it against your materials."
      )
    } catch (error) {
      dispatch({
        type: "failed",
        message: failureMessage(error, "The model answer didn't load. Your answer is still here."),
      })
    } finally {
      busy.current = false
    }
  }

  async function saveScore(score: SelfScore, errorLog: ReturnType<typeof buildErrorLog> | null) {
    dispatch({ type: "submit_start" })
    const payload = examScoring
      ? buildExamScore({ index, score, errorLog })
      : buildRecallAttempt({
          index,
          answer: state.answer,
          score,
          seconds: state.seconds ?? elapsed(),
          confidence: state.confidence,
          isPretest,
          isRepair,
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
    const errorLog = needsErrorLog({ score, isPretest, isRepair, examScoring })
    dispatch({ type: "score", score, errorLog })
    if (!errorLog) void saveScore(score, null)
  }

  function saveExamMcqScore() {
    if (busy.current || state.pending || state.step !== "scoring" || !examMcqScorable) return
    if (examMcqCorrect) {
      dispatch({ type: "score", score: "CORRECT", errorLog: false })
      void saveScore("CORRECT", null)
    } else {
      dispatch({ type: "score", score: "INCORRECT", errorLog: false })
      void saveScore("INCORRECT", mcqCorrectionRule(choices[examKey!] ?? ""))
    }
  }

  function saveCorrection() {
    if (busy.current || state.pending || state.step !== "error_log" || !state.score) return
    if (!state.correctionRule.trim()) {
      correctionRef.current?.focus()
      announce("Write the correction rule first.")
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
      await onContinue(outcome)
    } finally {
      setLeaving(false)
    }
  }

  // --------------------------------------------------------------- keyboard

  function bindings(): Binding[] {
    const list: Binding[] = []
    const single = shortcutsEnabled
    if (single) list.push({ key: "?", run: () => setHelpOpen((open) => !open) })

    if (state.step === "answering") {
      if (mcq) {
        if (single) {
          choices.forEach((_, i) => list.push({ key: String(i + 1), run: () => dispatch({ type: "choose", index: i }) }))
        }
        list.push({ key: "enter", run: () => void submitAnswer() })
      } else {
        list.push({ key: "enter", mod: true, run: () => void submitAnswer() })
      }
      if (single) {
        for (const key of ["q", "w", "e"]) {
          const value = confidenceKeyValue(key)
          if (value) list.push({ key, run: () => dispatch({ type: "rate", value }) })
        }
      }
    } else if (state.step === "scoring") {
      if (examMcqScorable) {
        list.push({ key: "enter", run: saveExamMcqScore })
      } else if (single) {
        list.push({ key: "1", run: () => chooseScore("CORRECT") })
        list.push({ key: "2", run: () => chooseScore("PARTIAL") })
        list.push({ key: "3", run: () => chooseScore("INCORRECT") })
      }
    } else if (state.step === "error_log") {
      list.push({ key: "enter", mod: true, run: saveCorrection })
    } else if (state.step === "feedback") {
      // Enter moves on, except while reading or citing inside the feedback.
      list.push({ key: "enter", run: () => void continueOn() })
    }
    return list
  }

  const onKeyDown = React.useEffectEvent((event: KeyboardEvent) => {
    if (helpOpen && event.key !== "?") return
    if (
      event.key === "Enter" &&
      event.target instanceof Element &&
      event.target.closest("[data-feedback-details]")
    ) {
      return
    }
    const binding = matchHotkey(event, bindings())
    if (!binding) return
    event.preventDefault()
    binding.run()
  })

  React.useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event)
    document.addEventListener("keydown", listener)
    return () => document.removeEventListener("keydown", listener)
  }, [])

  // ------------------------------------------------------------------ view

  const worked = kind.type === "worked-study" ? parseWorkedExample(prompt.text) : null
  const questionText =
    kind.type === "worked-completion" ? stripCompletionTrailer(prompt.text) : worked ? worked.problem : prompt.text
  const { heading, body } = splitQuestion(questionText)

  const pending = state.pending !== null
  const locked = state.step !== "answering"
  const showFraming = !(examScoring && kind.type === "standard")

  // Exam scoring reads the model answer from GET /reveal; immediate modes got it on submit.
  const examRevealData = examScoring ? examReveal.data ?? null : null
  const modelAnswer =
    state.reveal.status === "ready"
      ? state.reveal.modelAnswer
      : examRevealData?.model_answer?.trim() || null
  const keyPoints =
    state.reveal.status === "ready" ? state.reveal.keyPoints : (examRevealData?.key_points ?? []).filter(Boolean)
  const examRevealMissing =
    examScoring && !mcq && examReveal.error && examReveal.error.status === 409 && !examReveal.data
  const revealLoading = examScoring && !mcq && examReveal.isLoading
  const revealFailed = examScoring && !mcq && !!examReveal.error && !examRevealMissing && !examReveal.data

  const confidenceForFeedback = examScoring ? saved?.confidence ?? null : state.confidence
  const confidentError = outcome
    ? isConfidentError({ score: outcome.score, confidence: confidenceForFeedback, isPretest })
    : false

  function optionResult(i: number): AnswerOptionResult | undefined {
    if (examMcqScorable) {
      if (i === examKey) return "correct"
      if (i === savedChoice) return "wrong"
      return undefined
    }
    const graded = outcome?.mcq
    if (!graded) return undefined
    if (i === graded.correct_index) return "correct"
    if (i === graded.selected_index) return "wrong"
    return undefined
  }

  const showOptions = mcq
  const optionChecked = (i: number) => (examScoring ? savedChoice === i : state.choice === i)

  const answerArea = (() => {
    if (state.step === "answering" && !examScoring) {
      return mcq ? (
        <div ref={optionsRef}>
          <AnswerOptionGroup labelledBy={questionId}>
            {choices.map((choice, i) => (
              <AnswerOption
                key={i}
                name={`question-${index}`}
                value={String(i)}
                hint={shortcutsEnabled ? String(i + 1) : undefined}
                checked={state.choice === i}
                onSelect={() => dispatch({ type: "choose", index: i })}
                pending={state.pending === "submit" && state.choice === i}
                disabled={pending}
              >
                <InlineText>{choice}</InlineText>
              </AnswerOption>
            ))}
          </AnswerOptionGroup>
        </div>
      ) : (
        <FreeRecallInput
          ref={answerRef}
          value={state.answer}
          onChange={(event) => dispatch({ type: "answer", text: event.target.value })}
          disabled={pending}
          spellCheck
        />
      )
    }
    return null
  })()

  const confidencePicker =
    !examScoring && (state.step === "answering" || mcq) ? (
      <ConfidencePicker
        value={state.confidence}
        onChange={(value) => dispatch({ type: "rate", value })}
        hints={shortcutsEnabled ? CONFIDENCE_KEYS : undefined}
        disabled={locked || pending}
        description={locked ? (state.confidence ? "Rated before you checked." : "Not rated.") : "Optional. Rate before you check."}
      />
    ) : null

  const lockedOptions =
    showOptions && (locked || examScoring) ? (
      <AnswerOptionGroup labelledBy={questionId}>
        {choices.map((choice, i) => (
          <AnswerOption
            key={i}
            name={`question-${index}-result`}
            value={String(i)}
            checked={optionChecked(i)}
            onSelect={() => undefined}
            hint={shortcutsEnabled ? String(i + 1) : undefined}
            result={optionResult(i)}
            disabled
          >
            <InlineText>{choice}</InlineText>
            {examScoring && savedChoice === i ? <span className="sr-only"> (your answer)</span> : null}
          </AnswerOption>
        ))}
      </AnswerOptionGroup>
    ) : null

  const recallReview =
    !mcq && (examScoring || state.step !== "answering") ? (
      <div ref={scoringRef} tabIndex={-1} className="flex flex-col gap-6 rounded-2xl outline-none">
        <AnswerEcho
          answer={examScoring ? savedAnswer : state.answer}
          missingText={saved?.status === "loading" ? "Loading your saved answer…" : "Your saved answer didn't load."}
        />
        {examScoring && saved?.status === "failed" ? (
          <ErrorState title="Your saved answer didn't load." description="Retry to see it." onRetry={saved.retry} />
        ) : null}
        {revealLoading ? <ModelAnswerSkeleton /> : null}
        {revealFailed ? (
          <ErrorState
            title="The model answer didn't load."
            description="Your answer is saved."
            onRetry={() => void examReveal.mutate()}
            retrying={examReveal.isValidating}
          />
        ) : null}
        <ModelAnswerCard modelAnswer={modelAnswer} keyPoints={keyPoints} ownRule={isRepair} />
        {!revealLoading && !revealFailed && !modelAnswer && keyPoints.length === 0 ? (
          <p className="type-body-l font-medium text-lesson-neutral-text">
            This question has no model answer. Score it against your materials.
          </p>
        ) : null}
        {isPretest && state.step === "scoring" ? (
          <p className="type-body-m text-lesson-muted">
            Pretest questions don&apos;t count toward accuracy. Score how close you were.
          </p>
        ) : null}
      </div>
    ) : null

  const mcqScoringFocus =
    mcq && examScoring && state.step === "scoring" ? (
      <div ref={scoringRef} tabIndex={-1} className="flex flex-col gap-2 rounded-2xl outline-none">
        {saved?.status === "failed" ? (
          <ErrorState title="Your saved answer didn't load." description="Retry to see it." onRetry={saved.retry} />
        ) : examMcqScorable ? (
          <p className="type-body-l font-bold">
            {examMcqCorrect ? "Your answer is right." : `Right answer: ${choices[examKey!] ?? ""}`}
          </p>
        ) : (
          <p className="type-body-l font-medium text-lesson-neutral-text">
            {savedChoice !== null ? `Your answer: ${choices[savedChoice] ?? ""}. ` : ""}
            This question has no answer key here. Score it against your materials.
          </p>
        )}
      </div>
    ) : null

  const errorLog =
    state.step === "error_log" ? (
      <ErrorLogForm
        headingId={errorLogHeadingId}
        score={state.score}
        errorType={state.errorType}
        correctionRule={state.correctionRule}
        similarQuestion={state.similarQuestion}
        disabled={pending}
        onErrorType={(value) => dispatch({ type: "error_type", value })}
        onCorrection={(text) => dispatch({ type: "correction", text })}
        onSimilar={(text) => dispatch({ type: "similar", text })}
        onSubmitShortcut={saveCorrection}
        correctionRef={correctionRef}
      />
    ) : null

  function retryFailedAction() {
    if (state.step === "answering") void submitAnswer()
    else if (state.step === "error_log") saveCorrection()
    else if (examMcqScorable) saveExamMcqScore()
    else if (state.score && !busy.current) void saveScore(state.score, null)
  }

  const actionError =
    state.error && state.step !== "feedback" ? (
      <ErrorState {...splitMessage(state.error)} onRetry={retryFailedAction} />
    ) : null

  // ----------------------------------------------------------------- footer

  const help = (
    <KeyboardHelp
      open={helpOpen}
      onOpenChange={setHelpOpen}
      shortcutsEnabled={shortcutsEnabled}
      onShortcutsEnabledChange={onShortcutsEnabledChange}
    />
  )

  let footer: React.ReactNode = null
  if (state.step === "answering") {
    footer = (
      <>
        {help}
        <LessonButton
          variant="check"
          kbd={mcq ? "Enter" : ["Mod", "Enter"]}
          disabled={mcq ? state.choice === null : !state.answer.trim()}
          loading={pending}
          loadingLabel={examAnswering ? "Saving answer…" : "Checking answer…"}
          onClick={() => void submitAnswer()}
          className="w-full sm:w-auto sm:min-w-44"
        >
          Submit answer
        </LessonButton>
      </>
    )
  } else if (state.step === "scoring") {
    footer = examMcqScorable ? (
      <>
        {help}
        <LessonButton
          variant="check"
          kbd="Enter"
          loading={pending}
          loadingLabel="Saving score…"
          onClick={saveExamMcqScore}
          className="w-full sm:w-auto sm:min-w-44"
        >
          Save score
        </LessonButton>
      </>
    ) : (
      <>
        {help}
        <ScoreBar
          prompt={isPretest ? "How close were you?" : "Score your answer"}
          pendingScore={state.pending === "submit" ? state.score : null}
          disabled={pending}
          showKeys={shortcutsEnabled}
          onScore={chooseScore}
        />
      </>
    )
  } else if (state.step === "error_log") {
    footer = (
      <>
        <LessonButton
          variant="neutral"
          disabled={pending}
          onClick={() => dispatch({ type: "change_score" })}
          className="w-full sm:w-auto"
        >
          <RotateCcwIcon aria-hidden="true" />
          Change score
        </LessonButton>
        <LessonButton
          variant="check"
          kbd={["Mod", "Enter"]}
          disabled={!state.correctionRule.trim()}
          loading={pending}
          loadingLabel="Saving answer…"
          onClick={saveCorrection}
          className="w-full sm:w-auto sm:min-w-44"
        >
          Save correction
        </LessonButton>
      </>
    )
  }

  let sheet: React.ReactNode = null
  if (state.step === "feedback" && outcome) {
    const verdict = isPretest
      ? { title: "Pretest done", tone: "neutral" as FeedbackTone }
      : outcome.score
        ? SCORE_TITLES[outcome.score]
        : { title: "Answer saved", tone: "neutral" as FeedbackTone }
    const continueLabel = outcome.completes ? "See results" : outcome.startsBreak ? "Take a break" : "Next question"
    sheet = (
      <FeedbackSheet
        tone={verdict.tone}
        title={verdict.title}
        continueLabel={continueLabel}
        onContinue={() => void continueOn()}
        continueLoading={leaving || state.reflection === "saving"}
        // The body scrolls on its own so Continue never scrolls out of reach.
        scrollBody
      >
        <div
          data-feedback-details=""
          tabIndex={0}
          role="group"
          aria-label="Feedback details"
          className="-mx-1 max-h-[34dvh] overflow-y-auto overscroll-contain rounded-xl px-1 py-1 [--focus-ring-offset:-2px] sm:max-h-[40dvh] md:max-h-[46dvh]"
        >
          <FeedbackBody
            score={outcome.score}
            mcq={outcome.mcq}
            mcqMissing={mcq && !examScoring && outcome.mcq === null}
            isPretest={isPretest}
            modelAnswerShown={Boolean(modelAnswer || keyPoints.length > 0)}
            confidentError={confidentError}
            status={feedback.status}
            feedback={feedback.feedback}
            onRetry={feedback.retry}
            retrying={feedback.retrying}
            correctionRule={state.score && state.score !== "CORRECT" ? state.correctionRule : ""}
            similarQuestion={state.score && state.score !== "CORRECT" ? state.similarQuestion : ""}
            reflection={
              outcome.attemptId
                ? {
                    open: state.reflectionOpen,
                    onToggle: () => dispatch({ type: "toggle_reflection" }),
                    correct: outcome.score === "CORRECT",
                    socraticQuestion: feedback.feedback?.socratic_followup ?? null,
                    selfExplanation: state.selfExplanation,
                    socraticAnswer: state.socraticAnswer,
                    generatedExample: state.generatedExample,
                    onChange: (field, text) => dispatch({ type: "reflection_field", field, text }),
                    status: state.reflection,
                    continueLabel,
                  }
                : null
            }
          />
        </div>
      </FeedbackSheet>
    )
  }

  return (
    <LessonFrame
      current={Math.min(total, index + (state.step === "feedback" ? 1 : 0))}
      total={total}
      questionNumber={index + 1}
      status={status}
      question={<InlineText>{heading}</InlineText>}
      questionId={questionId}
      footer={footer}
      feedback={sheet}
    >
      {showFraming ? <QuestionFraming kind={kind} /> : null}
      {body ? <RichText className="type-body-l font-medium">{body}</RichText> : null}
      {worked && worked.steps.length > 0 ? <WorkedSteps steps={worked.steps} labelledBy={stepsHeadingId} /> : null}
      {worked?.question ? <p className="type-title-m font-bold">{worked.question}</p> : null}
      {answerArea}
      {lockedOptions}
      {mcqScoringFocus}
      {confidencePicker}
      {recallReview}
      {errorLog}
      {actionError}
    </LessonFrame>
  )
}
