"use client"

import * as React from "react"
import { CheckIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Spinner } from "@/components/ui/spinner"

export type AnswerOptionResult = "correct" | "wrong"

/** The square marker at the start of an option: key hint, spinner or result icon. */
const MARKER =
  "flex size-8 shrink-0 items-center justify-center rounded-lg border-2 border-current/25 text-sm font-bold tabular-nums"

/**
 * A group of answer options: a fieldset of real radio inputs, so Tab enters
 * the group, arrow keys move between options, and screen readers announce
 * "3 of 4". Name it with the question's id (`labelledBy`) or a `legend`.
 * Number keys are the screen's job; each option only draws its key hint.
 */
export function AnswerOptionGroup({
  labelledBy,
  legend,
  className,
  children,
}: {
  labelledBy?: string
  /** Visually hidden legend when there is no question id to point at. */
  legend?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <fieldset
      aria-labelledby={labelledBy}
      data-slot="answer-option-group"
      className={cn("m-0 flex min-w-0 flex-col gap-3 border-0 p-0", className)}
    >
      {legend ? <legend className="sr-only">{legend}</legend> : null}
      {children}
    </fieldset>
  )
}

/**
 * One tactile answer card. Selected turns it blue and fills its marker, so
 * the choice shows by shape as well as colour (and in forced colours): the
 * key hint chip on fine pointers, a radio dot on touch screens or when the
 * screen shows no hints. After checking, the chosen or right answer shows
 * `result` (correct in green with a check, wrong in red with a cross) and
 * the rest are disabled.
 */
export function AnswerOption({
  name,
  value,
  checked,
  onSelect,
  hint,
  result,
  disabled = false,
  pending = false,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"label">, "onSelect"> & {
  /** Shared by every option in the question. */
  name: string
  value: string
  checked: boolean
  onSelect: (value: string) => void
  /** Key hint shown on fine pointers: "1", "2"… */
  hint?: string
  /** Set after the answer is checked. */
  result?: AnswerOptionResult
  disabled?: boolean
  /** The selected answer is being submitted. */
  pending?: boolean
  className?: string
  children: React.ReactNode
}) {
  const id = React.useId()
  const state = result ?? (checked ? "selected" : "idle")
  const locked = disabled || result !== undefined

  return (
    <label
      htmlFor={id}
      data-slot="answer-option"
      data-state={state}
      data-disabled={locked || undefined}
      className={cn(
        "group/option lesson-lip relative flex min-h-16 w-full cursor-pointer items-center gap-4 rounded-2xl border-2 px-4 py-3 text-left text-lg leading-7 font-medium text-pretty select-none",
        // Idle
        "border-lesson-option-border bg-lesson-option text-lesson-on-surface [--lip:var(--lesson-option-border)] hover:bg-lesson-option-hover",
        // Selected
        "data-[state=selected]:border-lesson-selected-border data-[state=selected]:bg-lesson-selected data-[state=selected]:text-lesson-on-selected data-[state=selected]:[--lip:var(--lesson-selected-lip)]",
        // Results
        "data-[state=correct]:border-lesson-check data-[state=correct]:bg-lesson-correct data-[state=correct]:text-lesson-on-correct data-[state=correct]:[--lip:var(--lesson-check-lip)]",
        "data-[state=wrong]:border-lesson-wrong-button data-[state=wrong]:bg-lesson-wrong data-[state=wrong]:text-lesson-on-wrong data-[state=wrong]:[--lip:var(--lesson-wrong-lip)]",
        // Locked after checking: no press, quieter unless it carries a result
        "data-disabled:pointer-events-none data-[disabled]:data-[state=idle]:opacity-60 data-[disabled]:data-[state=selected]:opacity-60",
        // Focus ring on the card for the hidden radio
        "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-[6px] has-[input:focus-visible]:outline-ring data-[preview~=focus]:outline-2 data-[preview~=focus]:outline-offset-[6px] data-[preview~=focus]:outline-ring",
        // Forced colours keep only borders and text: the chosen card gets a
        // Highlight border
        "forced-colors:data-[state=selected]:border-[Highlight]",
        className
      )}
      {...props}
    >
      <input
        id={id}
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={locked}
        onChange={() => onSelect(value)}
        className="peer sr-only"
      />
      {pending || result ? (
        <span aria-hidden="true" className={MARKER}>
          {pending ? (
            <Spinner className="size-4" aria-hidden="true" role={undefined} />
          ) : result === "correct" ? (
            <CheckIcon className="size-5" strokeWidth={3} />
          ) : (
            <XIcon className="size-5" strokeWidth={3} />
          )}
        </span>
      ) : (
        <>
          {hint ? (
            <span
              aria-hidden="true"
              data-slot="answer-option-hint"
              className={cn(
                MARKER,
                "pointer-coarse:hidden",
                "group-data-[state=selected]/option:border-transparent group-data-[state=selected]/option:bg-lesson-on-selected group-data-[state=selected]/option:text-lesson-selected",
                "forced-colors:group-data-[state=selected]/option:border-[Highlight] forced-colors:group-data-[state=selected]/option:bg-[Highlight] forced-colors:group-data-[state=selected]/option:text-[HighlightText]"
              )}
            >
              {hint}
            </span>
          ) : null}
          <span
            aria-hidden="true"
            data-slot="answer-option-radio"
            className={cn(
              "size-6 shrink-0 items-center justify-center rounded-full border-2 border-current/40 group-data-[state=selected]/option:border-current",
              hint ? "hidden pointer-coarse:flex" : "flex"
            )}
          >
            <span className="size-3 scale-0 rounded-full bg-current transition-transform duration-150 ease-standard group-data-[state=selected]/option:scale-100 forced-colors:bg-[Highlight]" />
          </span>
        </>
      )}
      <span className="min-w-0 flex-1">{children}</span>
      {result ? (
        <span className="sr-only">{result === "correct" ? "Correct answer" : "Incorrect"}</span>
      ) : null}
    </label>
  )
}
