"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/** The one confidence scale, stored as 1, 3 and 5. */
export const CONFIDENCE_LEVELS = [
  { value: 1, label: "Guessing" },
  { value: 3, label: "Unsure" },
  { value: 5, label: "Sure" },
] as const

export type ConfidenceValue = (typeof CONFIDENCE_LEVELS)[number]["value"]

/**
 * "How sure are you?" as three tactile chips (real radio inputs). Rated
 * before anything is revealed. The screen owns the shortcut keys and passes
 * their labels in `hints`.
 */
export function ConfidencePicker({
  value,
  onChange,
  hints,
  disabled = false,
  label = "How sure are you?",
  description = "Optional. Rate before you check.",
  className,
}: {
  value: ConfidenceValue | null
  onChange: (value: ConfidenceValue) => void
  /** Key hints for Guessing, Unsure and Sure, such as ["Q", "W", "E"]. */
  hints?: readonly [string, string, string]
  disabled?: boolean
  label?: string
  description?: string
  className?: string
}) {
  const name = React.useId()
  const descriptionId = React.useId()

  return (
    <fieldset
      data-slot="confidence-picker"
      aria-describedby={description ? descriptionId : undefined}
      disabled={disabled}
      className={cn("m-0 flex min-w-0 flex-col gap-3 border-0 p-0", className)}
    >
      <legend className="mb-1 type-title-m font-bold">{label}</legend>
      {description ? (
        <p id={descriptionId} className="-mt-2 type-body-m text-lesson-muted">
          {description}
        </p>
      ) : null}
      <div className="grid grid-cols-3 gap-3">
        {CONFIDENCE_LEVELS.map((level, index) => {
          const checked = value === level.value
          const id = `${name}-${level.value}`
          return (
            <label
              key={level.value}
              htmlFor={id}
              data-state={checked ? "selected" : "idle"}
              data-disabled={disabled || undefined}
              className={cn(
                "lesson-lip relative flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 px-3 py-2 text-base font-bold select-none",
                "border-lesson-option-border bg-lesson-option text-lesson-on-surface [--lip:var(--lesson-option-border)] hover:bg-lesson-option-hover",
                "data-[state=selected]:border-lesson-selected-border data-[state=selected]:bg-lesson-selected data-[state=selected]:text-lesson-on-selected data-[state=selected]:[--lip:var(--lesson-selected-lip)]",
                "data-disabled:pointer-events-none data-disabled:opacity-60",
                "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-[6px] has-[input:focus-visible]:outline-ring data-[preview~=focus]:outline-2 data-[preview~=focus]:outline-offset-[6px] data-[preview~=focus]:outline-ring"
              )}
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={level.value}
                checked={checked}
                onChange={() => onChange(level.value)}
                className="sr-only"
              />
              {hints?.[index] ? (
                <span
                  aria-hidden="true"
                  className="flex size-6 items-center justify-center rounded-md border-2 border-current/25 text-xs font-bold pointer-coarse:hidden"
                >
                  {hints[index]}
                </span>
              ) : null}
              {level.label}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
