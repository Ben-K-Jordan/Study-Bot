"use client"

import * as React from "react"

import { ErrorState } from "@/components/app/error-state"
import { AnswerOption, AnswerOptionGroup, type AnswerOptionResult } from "@/components/lesson/answer-option"
import { ConfidencePicker } from "@/components/lesson/confidence-picker"
import { FreeRecallInput } from "@/components/lesson/free-recall-input"

import { CONFIDENCE_KEYS } from "./hotkeys"
import { AnswerEcho, ModelAnswerCard, ModelAnswerSkeleton } from "./parts"
import { InlineText } from "./rich-text"
import type { Confidence } from "./types"

/** The choices of an unanswered multiple-choice question, as real radios. */
export function McqOptions({
  optionsRef,
  name,
  labelledBy,
  choices,
  choice,
  submitting,
  showHints,
  onChoose,
}: {
  optionsRef: React.Ref<HTMLDivElement>
  name: string
  labelledBy: string
  choices: readonly string[]
  choice: number | null
  /** The pick is being saved: the options lock and the pick shows a spinner. */
  submitting: boolean
  showHints: boolean
  onChoose: (index: number) => void
}) {
  return (
    <div ref={optionsRef}>
      <AnswerOptionGroup labelledBy={labelledBy}>
        {choices.map((text, i) => (
          <AnswerOption
            key={i}
            name={name}
            value={String(i)}
            hint={showHints ? String(i + 1) : undefined}
            checked={choice === i}
            onSelect={() => onChoose(i)}
            pending={submitting && choice === i}
            disabled={submitting}
          >
            <InlineText>{text}</InlineText>
          </AnswerOption>
        ))}
      </AnswerOptionGroup>
    </div>
  )
}

/**
 * The answer box for a written answer. Its description starts with the
 * question, so a screen reader landing here after "Next question" hears
 * what to answer, then the helper text.
 */
export function RecallAnswer({
  answerRef,
  questionId,
  value,
  saving,
  error,
  onChange,
}: {
  answerRef: React.Ref<HTMLTextAreaElement>
  questionId: string
  value: string
  /** Saving: read-only, so focus stays in the box and comes back to it on failure. */
  saving: boolean
  error?: string
  onChange: (text: string) => void
}) {
  return (
    <FreeRecallInput
      ref={answerRef}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      readOnly={saving}
      error={error}
      describedBy={questionId}
      spellCheck
    />
  )
}

/** The options after the answer: locked, with the correct and the wrong choice marked. */
export function LockedOptions({
  name,
  labelledBy,
  choices,
  checked,
  result,
  savedChoice,
  showHints,
}: {
  name: string
  labelledBy: string
  choices: readonly string[]
  checked: (index: number) => boolean
  result: (index: number) => AnswerOptionResult | undefined
  /** Exam scoring: the choice saved during the exam. */
  savedChoice: number | null
  showHints: boolean
}) {
  return (
    <AnswerOptionGroup labelledBy={labelledBy}>
      {choices.map((text, i) => (
        <AnswerOption
          key={i}
          name={name}
          value={String(i)}
          checked={checked(i)}
          onSelect={() => undefined}
          hint={showHints ? String(i + 1) : undefined}
          result={result(i)}
          disabled
        >
          <InlineText>{text}</InlineText>
          {savedChoice === i ? <span className="sr-only"> (your answer)</span> : null}
        </AnswerOption>
      ))}
    </AnswerOptionGroup>
  )
}

/** "How sure are you?", rated before anything is revealed, then shown locked. */
export function ConfidenceRow({
  confidenceRef,
  value,
  locked,
  saving,
  showHints,
  onChange,
}: {
  confidenceRef: React.Ref<HTMLDivElement>
  value: Confidence | null
  /** The answer is committed: the rating is read-only from here. */
  locked: boolean
  saving: boolean
  showHints: boolean
  onChange: (value: Confidence) => void
}) {
  return (
    <div ref={confidenceRef}>
      <ConfidencePicker
        value={value}
        onChange={onChange}
        hints={showHints ? CONFIDENCE_KEYS : undefined}
        disabled={locked || saving}
        description={locked ? (value ? "Rated before you checked." : "Not rated.") : "Optional. Rate before you check."}
      />
    </div>
  )
}

export interface SavedAnswerView {
  status: "ready" | "loading" | "failed"
  answer: string | null
  retry: () => void
}

/**
 * A written answer after it's committed: the student's answer, then the
 * model answer (or its loading and failed states) to score against.
 */
export function RecallReview({
  scoringRef,
  answer,
  saved,
  reveal,
  modelAnswer,
  keyPoints,
  ownRule,
  pretestNote,
}: {
  scoringRef: React.Ref<HTMLDivElement>
  answer: string | null
  /** Exam scoring: the answer saved during the exam, which may still be loading. */
  saved: SavedAnswerView | null
  reveal: { loading: boolean; failed: boolean; retry: () => void; retrying: boolean }
  modelAnswer: string | null
  keyPoints: string[]
  /** A repair question: the standard is the student's own correction rule. */
  ownRule: boolean
  pretestNote: boolean
}) {
  return (
    <div ref={scoringRef} tabIndex={-1} className="flex flex-col gap-6 rounded-2xl outline-none">
      <AnswerEcho
        answer={answer}
        missingText={saved?.status === "loading" ? "Loading your saved answer…" : "Your saved answer didn't load."}
      />
      {saved?.status === "failed" ? (
        <ErrorState title="Your saved answer didn't load." description="Retry to see it." onRetry={saved.retry} />
      ) : null}
      {reveal.loading ? <ModelAnswerSkeleton /> : null}
      {reveal.failed ? (
        <ErrorState
          title="The model answer didn't load."
          description="Your answer is saved."
          onRetry={reveal.retry}
          retrying={reveal.retrying}
        />
      ) : null}
      <ModelAnswerCard modelAnswer={modelAnswer} keyPoints={keyPoints} ownRule={ownRule} />
      {!reveal.loading && !reveal.failed && !modelAnswer && keyPoints.length === 0 ? (
        <p className="type-body-l font-medium text-lesson-neutral-text">
          This question has no model answer. Score it against your materials.
        </p>
      ) : null}
      {pretestNote ? (
        <p className="type-body-m text-lesson-muted">
          Pretest questions don&apos;t count toward accuracy. Score how close you were.
        </p>
      ) : null}
    </div>
  )
}

/** Exam scoring of a multiple-choice answer: the result is known before it's saved. */
export function ExamMcqScoring({
  scoringRef,
  saved,
  savedChoiceText,
  correctChoiceText,
  correct,
}: {
  scoringRef: React.Ref<HTMLDivElement>
  saved: SavedAnswerView | null
  /** The saved pick, when it could be read. */
  savedChoiceText: string | null
  /** The correct choice, when the question carries its key; null means score by hand. */
  correctChoiceText: string | null
  correct: boolean
}) {
  return (
    <div ref={scoringRef} tabIndex={-1} className="flex flex-col gap-2 rounded-2xl outline-none">
      {saved?.status === "failed" ? (
        <ErrorState title="Your saved answer didn't load." description="Retry to see it." onRetry={saved.retry} />
      ) : correctChoiceText !== null && savedChoiceText !== null ? (
        <p className="type-body-l font-bold">
          {correct ? "Your answer is correct." : `Correct answer: ${correctChoiceText}`}
        </p>
      ) : (
        <p className="type-body-l font-medium text-lesson-neutral-text">
          {savedChoiceText !== null ? `Your answer: ${savedChoiceText}. ` : ""}
          This question has no model answer here. Score it against your materials.
        </p>
      )}
    </div>
  )
}
