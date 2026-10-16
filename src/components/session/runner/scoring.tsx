"use client"

import * as React from "react"
import { CheckIcon, ContrastIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { LessonButton } from "@/components/lesson/lesson-button"
import { FreeRecallInput } from "@/components/lesson/free-recall-input"

import { FIELD_SCROLL_MARGINS } from "./parts"
import type { ErrorType, SelfScore } from "./types"

export const SCORE_OPTIONS: readonly { score: SelfScore; label: string; key: string }[] = [
  { score: "CORRECT", label: "Correct", key: "1" },
  { score: "PARTIAL", label: "Partly correct", key: "2" },
  { score: "INCORRECT", label: "Incorrect", key: "3" },
]

const SCORE_ICONS: Record<SelfScore, { icon: typeof CheckIcon; className: string }> = {
  CORRECT: { icon: CheckIcon, className: "text-lesson-on-correct" },
  PARTIAL: { icon: ContrastIcon, className: "text-lesson-muted" },
  INCORRECT: { icon: XIcon, className: "text-lesson-on-wrong" },
}

/** The self-score buttons, in the footer where the next action lives. */
export function ScoreBar({
  prompt,
  pendingScore,
  disabled,
  showKeys,
  onScore,
}: {
  /** What the student is scoring against, said in one line. */
  prompt: string
  pendingScore: SelfScore | null
  disabled: boolean
  /** Single-key shortcuts are on: show 1, 2, 3 on the buttons. */
  showKeys: boolean
  onScore: (score: SelfScore) => void
}) {
  const labelId = React.useId()
  return (
    <div role="group" aria-labelledby={labelId} className="flex w-full min-w-0 flex-col gap-3 lg:flex-row lg:items-center">
      <p id={labelId} className="type-title-s font-bold text-lesson-neutral-text lg:mr-auto">
        {prompt}
      </p>
      {/* Three across at every width, like a lesson's answer row, so the
          bar stays about one button tall and the model answer it is scored
          against stays in view above it on a phone. */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3 lg:shrink-0">
        {SCORE_OPTIONS.map(({ score, label, key }) => {
          const { icon: Icon, className } = SCORE_ICONS[score]
          const loading = pendingScore === score
          return (
            <LessonButton
              key={score}
              variant="neutral"
              width="full"
              kbd={showKeys ? key : undefined}
              disabled={disabled && !loading}
              loading={loading}
              loadingLabel="Saving answer…"
              aria-keyshortcuts={showKeys ? key : undefined}
              onClick={() => onScore(score)}
              // Under 600px the icon sits over a smaller label that may wrap;
              // from 600px, icon beside label. Key hints only where they fit
              // (840px and up).
              className={cn(
                "min-w-0 sm:px-3 max-md:[&_[data-slot=kbd-group]]:hidden lg:min-w-44",
                "max-sm:min-h-14 max-sm:flex-col max-sm:gap-1 max-sm:px-1 max-sm:py-2 max-sm:text-center max-sm:whitespace-normal max-sm:type-label-l max-sm:font-bold"
              )}
            >
              {/* Off, the icon greys out with its label. */}
              <Icon aria-hidden="true" strokeWidth={3} className={disabled && !loading ? undefined : className} />
              {label}
            </LessonButton>
          )
        })}
      </div>
    </div>
  )
}

const ERROR_TYPE_OPTIONS: readonly { value: ErrorType; label: string }[] = [
  { value: "MISCONCEPTION", label: "Misconception" },
  { value: "PROCEDURE", label: "Wrong steps" },
  { value: "CARELESS", label: "Careless slip" },
  { value: "MEMORY", label: "Memory gap" },
  { value: "UNKNOWN", label: "Not sure" },
]

/** Tactile radio chips for the kind of error, in the lesson's grammar. */
function ErrorTypePicker({
  value,
  onChange,
  disabled,
}: {
  value: ErrorType
  onChange: (value: ErrorType) => void
  disabled: boolean
}) {
  const name = React.useId()
  const descriptionId = React.useId()
  return (
    <fieldset
      aria-describedby={descriptionId}
      disabled={disabled}
      className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0"
    >
      <legend className="mb-1 type-title-m font-bold">Error type</legend>
      <p id={descriptionId} className="-mt-2 type-body-m text-lesson-muted">
        The type you pick decides how the repair question asks about this again.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {ERROR_TYPE_OPTIONS.map((option) => {
          const checked = value === option.value
          const id = `${name}-${option.value}`
          return (
            <label
              key={option.value}
              htmlFor={id}
              data-state={checked ? "selected" : "idle"}
              data-disabled={disabled || undefined}
              className={cn(
                "lesson-lip relative flex min-h-12 cursor-pointer items-center justify-center rounded-2xl border-2 px-3 py-2 text-center text-base leading-5 font-bold select-none",
                "border-lesson-option-border bg-lesson-option text-lesson-on-surface [--lip:var(--lesson-option-border)] hover:bg-lesson-option-hover",
                "data-[state=selected]:border-lesson-selected-border data-[state=selected]:bg-lesson-selected data-[state=selected]:text-lesson-on-selected data-[state=selected]:[--lip:var(--lesson-selected-lip)]",
                "data-disabled:pointer-events-none data-disabled:opacity-60",
                "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-[6px] has-[input:focus-visible]:outline-ring"
              )}
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

/**
 * The error log: what kind of error, the correction rule (required), and a
 * similar question for next time. The correction rule field takes focus so
 * the student can start typing at once.
 */
export function ErrorLogForm({
  headingId,
  score,
  errorType,
  correctionRule,
  similarQuestion,
  correctionError,
  disabled,
  onErrorType,
  onCorrection,
  onSimilar,
  onSubmitShortcut,
  correctionRef,
}: {
  headingId: string
  score: SelfScore | null
  errorType: ErrorType
  correctionRule: string
  similarQuestion: string
  /** Shown beside the correction rule, such as when it was left empty. */
  correctionError?: string
  /** Saving: the choices lock and the text fields turn read-only, so focus stays put. */
  disabled: boolean
  onErrorType: (value: ErrorType) => void
  onCorrection: (text: string) => void
  onSimilar: (text: string) => void
  onSubmitShortcut: () => void
  correctionRef: React.Ref<HTMLTextAreaElement>
}) {
  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
      event.preventDefault()
      onSubmitShortcut()
    }
  }
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="scroll-mt-32 type-title-l font-bold">
          Log the error
        </h2>
        <p className="type-body-m text-lesson-muted">
          {score === "PARTIAL" ? "You scored this partly correct." : "You scored this incorrect."} Use the model
          answer above to write what makes the answer right.
        </p>
      </div>
      <ErrorTypePicker value={errorType} onChange={onErrorType} disabled={disabled} />
      <FreeRecallInput
        ref={correctionRef}
        className={FIELD_SCROLL_MARGINS}
        label="Correction rule"
        description="The rule or fact that makes the answer right, in your own words. It comes back in repair questions."
        value={correctionRule}
        onChange={(event) => onCorrection(event.target.value)}
        onKeyDown={onKeyDown}
        error={correctionError}
        required
        aria-required="true"
        readOnly={disabled}
      />
      <FreeRecallInput
        className={FIELD_SCROLL_MARGINS}
        label="Similar question (optional)"
        description="A question you'd ask yourself to check this next time. Repair questions can use it."
        value={similarQuestion}
        onChange={(event) => onSimilar(event.target.value)}
        onKeyDown={onKeyDown}
        showSubmitHint={false}
        readOnly={disabled}
      />
    </section>
  )
}
