"use client"

import * as React from "react"
import { flushSync } from "react-dom"

import { ErrorState } from "@/components/app/error-state"
import type { AnswerOptionResult } from "@/components/lesson/answer-option"
import { LessonFrame } from "@/components/lesson/lesson-frame"
import { useApi } from "@/lib/swr"

import { revealUrl } from "./api"
import { isConfidentError, parseMcqAnswer } from "./attempt-payload"
import { KeyboardHelp } from "./keyboard-help"
import { ConfidenceRow, ExamMcqScoring, LockedOptions, McqOptions, RecallAnswer, RecallReview } from "./question-body"
import {
  FeedbackProvider,
  QuestionFeedbackDetails,
  QuestionFeedbackSheet,
  pretestNote,
  verdictFor,
} from "./question-feedback"
import { QuestionFooter } from "./question-footer"
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
import { draftOf, initialQuestionState, questionReducer, type Outcome } from "./question-reducer"
import { InlineText, RichText } from "./rich-text"
import { ErrorLogForm } from "./scoring"
import { draftKey, readDraft, writeDraftJson } from "./storage"
import type { AttemptSubmitResult, Confidence, RevealPayload, RunnerPrompt } from "./types"
import { useQuestionActions } from "./use-question-actions"
import { useQuestionHotkeys } from "./use-question-hotkeys"

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

/** "Answer not saved." + "Your answer is still here. Retry in a moment." */
function splitMessage(message: string): { title: string; description?: string } {
  const match = message.match(/^(.+?[.?])\s+(.+)$/)
  return match ? { title: match[1], description: match[2] } : { title: message }
}

/**
 * One question, one screen: answer, check, score, fix, feedback. Keyed by
 * the session screen on every question, so its state starts fresh each
 * time and the answered question stays on screen until the student moves
 * on, even after the run has already advanced underneath. Owns the state
 * and the layout; the actions, keys, parts and feedback live beside it.
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
    initialQuestionState({ examScoring, draft: readDraft(storageKey), choiceCount: choices.length })
  )
  const [helpOpen, setHelpOpen] = React.useState(false)

  const questionId = React.useId()
  const errorLogHeadingId = React.useId()
  const stepsHeadingId = React.useId()
  const answerRef = React.useRef<HTMLTextAreaElement>(null)
  const correctionRef = React.useRef<HTMLTextAreaElement>(null)
  const optionsRef = React.useRef<HTMLDivElement>(null)
  const confidenceRef = React.useRef<HTMLDivElement>(null)
  const scoringRef = React.useRef<HTMLDivElement>(null)
  const actionErrorRef = React.useRef<HTMLDivElement>(null)
  const helpReturnFocus = React.useRef<HTMLElement | null>(null)

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
      if (mcq) radioFor(optionsRef.current, null)?.focus({ preventScroll: true })
      else answerRef.current?.focus({ preventScroll: true })
    } else if (state.step === "scoring") {
      scoringRef.current?.focus({ preventScroll: true })
    } else if (state.step === "error_log") {
      // Start typing at once, with the form's heading at the top of the view.
      correctionRef.current?.focus({ preventScroll: true })
      document.getElementById(errorLogHeadingId)?.scrollIntoView({ block: "start" })
      // On a short screen that leaves the focused field under the footer
      // (WCAG 2.4.11): bring the whole field up above it, heading or not.
      fieldOf(correctionRef.current)?.scrollIntoView({ block: "nearest" })
    }
  }, [state.step, mcq, errorLogHeadingId])

  // A field's error shows under it, below the box that keeps focus, so
  // focus alone never scrolls it into view: bring the field and its error
  // up above the footer.
  React.useEffect(() => {
    const field = state.fieldError?.field
    if (!field) return
    fieldOf(field === "correction" ? correctionRef.current : answerRef.current)?.scrollIntoView({ block: "nearest" })
  }, [state.fieldError])

  // A failed save can leave focus nowhere: the options and the error-type
  // choices lock while saving, and a locked control drops focus. Put it back
  // where the student was, or on Retry (Reload) when that's the only way on.
  React.useEffect(() => {
    if (!state.error) return
    // The message sits under the form, often below the fold on a phone.
    actionErrorRef.current?.scrollIntoView({ block: "nearest" })
    const active = document.activeElement
    if (active && active !== document.body) return
    if (state.errorReload || state.step === "scoring") {
      actionErrorRef.current?.querySelector<HTMLButtonElement>("button")?.focus()
    } else if (state.step === "answering") {
      if (mcq) radioFor(optionsRef.current, null)?.focus()
      else answerRef.current?.focus()
    } else if (state.step === "error_log") {
      correctionRef.current?.focus({ preventScroll: true })
      fieldOf(correctionRef.current)?.scrollIntoView({ block: "nearest" })
    }
  }, [state.error, state.errorReload, state.step, mcq])

  // Exam scoring: the model answer is shown for the saved answer.
  const examReveal = useApi<RevealPayload>(examScoring && !mcq ? revealUrl(runId, index) : null)

  const savedAnswer = examScoring ? saved?.answer ?? null : null
  const savedChoice = examScoring && mcq ? parseMcqAnswer(savedAnswer) : null
  const examKey = examScoring && mcq && typeof prompt.correctIndex === "number" ? prompt.correctIndex : null
  const examMcqScorable = examKey !== null && savedChoice !== null
  const examMcqCorrect = examMcqScorable && savedChoice === examKey
  // Exam scoring scores the answer saved during the exam. Until it has
  // loaded there is nothing to score, and a multiple-choice pick can't be
  // checked against its key, so no score can be recorded (a failed load
  // stays blocked behind its Retry).
  const scoringReady = !examScoring || saved?.status === "ready"
  const scoringWait = scoringReady
    ? null
    : saved?.status === "failed"
      ? "Your saved answer didn't load."
      : "Loading your saved answer…"

  const actions = useQuestionActions({
    state,
    dispatch,
    runId,
    index,
    storageKey,
    mcq,
    choices,
    examAnswering,
    examScoring,
    isPretest,
    isRepair,
    examMcq: { scorable: examMcqScorable, correct: examMcqCorrect, key: examKey },
    scoringReady,
    submit,
    onExamAnswered,
    onContinue,
    announce,
    answerRef,
    correctionRef,
  })

  // ------------------------------------------------------------- keyboard

  /** A number key picks the option and moves focus to it, so the ring, Space and the arrows follow. */
  function chooseByKey(choice: number) {
    if (state.pending) return
    flushSync(() => dispatch({ type: "choose", index: choice }))
    radioFor(optionsRef.current, choice)?.focus()
  }

  /** Q, W and E rate and move focus to the rating, which a screen reader then reads as checked. */
  function rateByKey(value: Confidence) {
    if (state.pending) return
    flushSync(() => dispatch({ type: "rate", value }))
    confidenceRef.current?.querySelector<HTMLInputElement>(`input[type=radio][value="${value}"]`)?.focus()
  }

  function toggleHelp() {
    if (!helpOpen) {
      // Opened from the keyboard: closing it returns here, not to its button.
      const active = document.activeElement
      helpReturnFocus.current = active instanceof HTMLElement && active !== document.body ? active : null
    }
    setHelpOpen((open) => !open)
  }

  useQuestionHotkeys({
    step: state.step,
    mcq,
    choiceCount: choices.length,
    examMcqScorable,
    scoringReady,
    shortcutsEnabled,
    helpOpen,
    onToggleHelp: toggleHelp,
    onChoose: chooseByKey,
    onRate: rateByKey,
    onSubmit: () => void actions.submitAnswer(),
    onScore: actions.chooseScore,
    onSaveExamMcqScore: actions.saveExamMcqScore,
    onSaveCorrection: actions.saveCorrection,
    onContinue: () => void actions.continueOn(),
  })

  // ----------------------------------------------------------------- view

  const worked = kind.type === "worked-study" ? parseWorkedExample(prompt.text) : null
  const questionText =
    kind.type === "worked-completion" ? stripCompletionTrailer(prompt.text) : worked ? worked.problem : prompt.text
  const { heading, body } = splitQuestion(questionText)

  const pending = state.pending !== null
  const locked = state.step !== "answering"
  const outcome = state.outcome

  // Exam scoring reads the model answer from GET /reveal; immediate modes got it on submit.
  const examRevealData = examScoring ? examReveal.data ?? null : null
  const modelAnswer =
    state.reveal.status === "ready" ? state.reveal.modelAnswer : examRevealData?.model_answer?.trim() || null
  const keyPoints =
    state.reveal.status === "ready" ? state.reveal.keyPoints : (examRevealData?.key_points ?? []).filter(Boolean)
  const examRevealMissing =
    examScoring && !mcq && examReveal.error && examReveal.error.status === 409 && !examReveal.data

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

  const actionError =
    state.error && state.step !== "feedback" ? (
      <div ref={actionErrorRef} className="scroll-mt-28 scroll-mb-[max(18rem,40dvh)]">
        <ErrorState
          {...splitMessage(state.error)}
          retryLabel={state.errorReload ? "Reload" : "Retry"}
          onRetry={state.errorReload ? () => window.location.reload() : actions.retryFailedAction}
        />
      </div>
    ) : null

  const help = (
    <KeyboardHelp
      open={helpOpen}
      onOpenChange={setHelpOpen}
      returnFocusRef={helpReturnFocus}
      shortcutsEnabled={shortcutsEnabled}
      onShortcutsEnabledChange={onShortcutsEnabledChange}
    />
  )

  const footer = (
    <QuestionFooter
      step={state.step}
      help={help}
      mcq={mcq}
      examAnswering={examAnswering}
      examMcqScorable={examMcqScorable}
      scoringReady={scoringReady}
      scoringWait={scoringWait}
      isPretest={isPretest}
      canSubmit={mcq ? state.choice !== null : state.answer.trim().length > 0}
      pending={pending}
      pendingScore={state.pending === "submit" ? state.score : null}
      shortcutsEnabled={shortcutsEnabled}
      onSubmit={() => void actions.submitAnswer()}
      onScore={actions.chooseScore}
      onSaveExamMcqScore={actions.saveExamMcqScore}
      onChangeScore={() => dispatch({ type: "change_score" })}
      onSaveCorrection={actions.saveCorrection}
    />
  )

  let sheet: React.ReactNode = null
  let details: React.ReactNode = null
  if (state.step === "feedback" && outcome) {
    const correct = outcome.score === "CORRECT"
    const continueLabel = outcome.completes ? "See results" : outcome.startsBreak ? "Take a break" : "Next question"
    const correctChoice =
      outcome.mcq && !outcome.mcq.is_correct
        ? outcome.mcq.correct_choice
        : examMcqScorable && !examMcqCorrect && examKey !== null
          ? choices[examKey] ?? null
          : null
    const note = isPretest
      ? pretestNote(correct, Boolean(modelAnswer || keyPoints.length > 0))
      : mcq && !examScoring && outcome.mcq === null
        ? "Your answer is saved, but its result didn't load. You'll see it with your session results."
        : null
    const showCorrection = Boolean(state.score && state.score !== "CORRECT")
    sheet = (
      <QuestionFeedbackSheet
        verdict={verdictFor(outcome, isPretest)}
        correct={correct}
        correctChoice={correctChoice}
        note={note}
        continueLabel={continueLabel}
        continueLoading={actions.leaving || state.reflection === "saving"}
        onContinue={() => void actions.continueOn()}
      />
    )
    details = (
      <QuestionFeedbackDetails
        score={outcome.score}
        mcq={outcome.mcq}
        confidentError={isConfidentError({
          score: outcome.score,
          confidence: examScoring ? saved?.confidence ?? null : state.confidence,
          isPretest,
        })}
        correctionRule={showCorrection ? state.correctionRule : ""}
        similarQuestion={showCorrection ? state.similarQuestion : ""}
        reflection={
          outcome.attemptId
            ? {
                open: state.reflectionOpen,
                onToggle: () => dispatch({ type: "toggle_reflection" }),
                correct,
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
    )
  }

  return (
    <FeedbackProvider attemptId={state.step === "feedback" ? outcome?.attemptId ?? null : null}>
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
        {!(examScoring && kind.type === "standard") ? <QuestionFraming kind={kind} /> : null}
        {body ? <RichText className="type-body-l font-medium">{body}</RichText> : null}
        {worked && worked.steps.length > 0 ? <WorkedSteps steps={worked.steps} labelledBy={stepsHeadingId} /> : null}
        {worked?.question ? <p className="type-title-m font-bold">{worked.question}</p> : null}

        {state.step === "answering" && !examScoring ? (
          mcq ? (
            <McqOptions
              optionsRef={optionsRef}
              name={`question-${index}`}
              labelledBy={questionId}
              choices={choices}
              choice={state.choice}
              submitting={pending}
              showHints={shortcutsEnabled}
              onChoose={(i) => dispatch({ type: "choose", index: i })}
            />
          ) : (
            <RecallAnswer
              answerRef={answerRef}
              questionId={questionId}
              value={state.answer}
              saving={pending}
              error={state.fieldError?.field === "answer" ? state.fieldError.message : undefined}
              onChange={(text) => dispatch({ type: "answer", text })}
            />
          )
        ) : null}

        {mcq && (locked || examScoring) ? (
          <LockedOptions
            name={`question-${index}-result`}
            labelledBy={questionId}
            choices={choices}
            checked={(i) => (examScoring ? savedChoice === i : state.choice === i)}
            result={optionResult}
            savedChoice={examScoring ? savedChoice : null}
            showHints={shortcutsEnabled}
          />
        ) : null}

        {mcq && examScoring && state.step === "scoring" ? (
          <ExamMcqScoring
            scoringRef={scoringRef}
            saved={saved}
            savedChoiceText={savedChoice !== null ? choices[savedChoice] ?? "" : null}
            correctChoiceText={examMcqScorable && examKey !== null ? choices[examKey] ?? "" : null}
            correct={examMcqCorrect}
          />
        ) : null}

        {!examScoring && (state.step === "answering" || mcq) ? (
          <ConfidenceRow
            confidenceRef={confidenceRef}
            value={state.confidence}
            locked={locked}
            saving={pending}
            showHints={shortcutsEnabled}
            onChange={(value) => dispatch({ type: "rate", value })}
          />
        ) : null}

        {!mcq && (examScoring || state.step !== "answering") ? (
          <RecallReview
            scoringRef={scoringRef}
            answer={examScoring ? savedAnswer : state.answer}
            saved={examScoring ? saved : null}
            reveal={{
              loading: examScoring && !mcq && examReveal.isLoading,
              failed: examScoring && !mcq && !!examReveal.error && !examRevealMissing && !examReveal.data,
              retry: () => void examReveal.mutate(),
              retrying: examReveal.isValidating,
            }}
            modelAnswer={modelAnswer}
            keyPoints={keyPoints}
            ownRule={isRepair}
            pretestNote={isPretest && state.step === "scoring"}
          />
        ) : null}

        {state.step === "error_log" ? (
          <ErrorLogForm
            headingId={errorLogHeadingId}
            score={state.score}
            errorType={state.errorType}
            correctionRule={state.correctionRule}
            similarQuestion={state.similarQuestion}
            correctionError={state.fieldError?.field === "correction" ? state.fieldError.message : undefined}
            disabled={pending}
            onErrorType={(value) => dispatch({ type: "error_type", value })}
            onCorrection={(text) => dispatch({ type: "correction", text })}
            onSimilar={(text) => dispatch({ type: "similar", text })}
            onSubmitShortcut={actions.saveCorrection}
            correctionRef={correctionRef}
          />
        ) : null}

        {details}
        {actionError}
      </LessonFrame>
    </FeedbackProvider>
  )
}

/** The whole labelled field around a text box: label, helper, box and error. */
function fieldOf(input: HTMLElement | null): HTMLElement | null {
  return input?.closest<HTMLElement>("[data-slot=free-recall-input]") ?? null
}

/** The radio for `choice`, else the checked one, else the first. */
function radioFor(container: HTMLElement | null, choice: number | null): HTMLInputElement | null {
  if (!container) return null
  const radios = container.querySelectorAll<HTMLInputElement>("input[type=radio]")
  if (choice !== null) return radios[choice] ?? null
  return Array.from(radios).find((radio) => radio.checked) ?? radios[0] ?? null
}
