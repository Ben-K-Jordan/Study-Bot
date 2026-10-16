"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { useModKey } from "@/components/app/kbd-hint"

/**
 * The answer box for recall questions: a large textarea with a real label
 * and helper text, and no placeholder. Shows "Ctrl+Enter to submit" (Cmd on
 * a Mac) on fine pointers; the screen handles the shortcut itself.
 */
export function FreeRecallInput({
  label = "Your answer",
  description = "Answer from memory before you check anything.",
  error,
  showSubmitHint = true,
  describedBy,
  className,
  id: idProp,
  disabled,
  ...props
}: Omit<React.ComponentProps<"textarea">, "placeholder" | "aria-describedby"> & {
  label?: string
  description?: string
  /** Shown under the field and linked with aria-describedby. */
  error?: string
  showSubmitHint?: boolean
  /**
   * Ids of other text that describes the field, such as the question. They
   * come first, before the helper text and the error.
   */
  describedBy?: string
}) {
  const generatedId = React.useId()
  const id = idProp ?? generatedId
  const descriptionId = `${id}-description`
  const errorId = `${id}-error`
  const mod = useModKey()

  return (
    <div data-slot="free-recall-input" className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="type-title-m font-bold text-lesson-on-surface">
        {label}
      </label>
      {description ? (
        <p id={descriptionId} className="type-body-m text-lesson-muted">
          {description}
        </p>
      ) : null}
      <textarea
        id={id}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          [describedBy, description ? descriptionId : null, error ? errorId : null].filter(Boolean).join(" ") ||
          undefined
        }
        className={cn(
          "field-sizing-content min-h-28 w-full resize-none rounded-2xl border-2 border-lesson-option-border bg-lesson-option px-4 py-3 text-lg leading-7 font-medium text-lesson-on-surface outline-none",
          // Grows with the answer (field-sizing), so it starts short enough to
          // keep the confidence chips above the footer on a laptop screen.
          "md:min-h-32",
          "transition-colors duration-150 ease-standard hover:border-lesson-muted",
          "focus-visible:border-lesson-selected-border data-[preview~=focus]:border-lesson-selected-border",
          "aria-invalid:border-lesson-wrong-button",
          "disabled:cursor-not-allowed disabled:bg-lesson-disabled disabled:text-lesson-on-disabled"
        )}
        {...props}
      />
      {error ? (
        <p id={errorId} role="alert" className="type-body-m font-medium text-lesson-on-wrong">
          {error}
        </p>
      ) : null}
      {showSubmitHint && !disabled ? (
        <p aria-hidden="true" className="self-end type-label-m text-lesson-muted pointer-coarse:hidden">
          {mod}+Enter to submit
        </p>
      ) : null}
    </div>
  )
}
