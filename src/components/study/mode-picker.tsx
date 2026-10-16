"use client"

import { useId } from "react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { FieldLegend, FieldSet } from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { formatDuration } from "@/lib/format"
import {
  isSessionLength,
  isStudyModeKey,
  SESSION_LENGTHS,
  STUDY_MODES,
  type SessionLength,
  type StudyModeKey,
} from "@/lib/study-modes"

/**
 * The five study modes as an M3 list of radio rows, each with its one-line
 * description; the recommended one carries a badge. Arrow keys move between
 * modes (Radix radio group). Error repair is unavailable with no errors.
 */
export function ModePicker({
  value,
  onChange,
  recommended,
  unresolvedErrors,
  courseName,
  disabled = false,
}: {
  value: StudyModeKey
  onChange: (mode: StudyModeKey) => void
  recommended: StudyModeKey
  unresolvedErrors: number
  courseName: string
  disabled?: boolean
}) {
  const baseId = useId()
  const legendId = `${baseId}-legend`

  return (
    <FieldSet className="gap-2">
      <FieldLegend id={legendId} variant="label" className="mb-1 text-on-surface">
        Mode
      </FieldLegend>
      <RadioGroup
        value={value}
        onValueChange={(next) => {
          if (isStudyModeKey(next)) onChange(next)
        }}
        aria-labelledby={legendId}
        disabled={disabled}
        className="gap-1"
      >
        {STUDY_MODES.map((mode) => {
          const id = `${baseId}-${mode.key}`
          const unavailable = mode.key === "ERROR_REPAIR" && unresolvedErrors === 0
          const description = unavailable
            ? `No unresolved errors in ${courseName} to retest.`
            : mode.description
          return (
            <label
              key={mode.key}
              htmlFor={id}
              className={cn(
                "state-layer relative isolate flex items-start gap-3 rounded-xl px-3 py-3 sm:gap-4 sm:px-4 text-on-surface transition-colors duration-150 ease-standard",
                "has-data-checked:bg-secondary-container has-data-checked:text-on-secondary-container",
                unavailable || disabled ? "cursor-not-allowed before:hidden" : "cursor-pointer"
              )}
            >
              <RadioGroupItem
                id={id}
                value={mode.key}
                disabled={unavailable}
                aria-labelledby={`${id}-label`}
                aria-describedby={`${id}-description`}
                className="mt-0.5"
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                {/* Only the name dims: the description is the one place that
                    says why the mode is unavailable, so it keeps full contrast. */}
                <span
                  id={`${id}-label`}
                  className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 type-title-s", unavailable && "opacity-60")}
                >
                  {mode.label}
                  {/* The card heading already says so when this mode is picked. */}
                  {mode.key === recommended && value !== recommended ? (
                    <Badge variant="outline">Recommended</Badge>
                  ) : null}
                </span>
                <span id={`${id}-description`} className="type-body-m text-pretty text-on-surface-variant">
                  {description}
                </span>
              </span>
            </label>
          )
        })}
      </RadioGroup>
    </FieldSet>
  )
}

/** Session length as an M3 segmented button: 15, 30 or 45 minutes. */
export function LengthPicker({
  value,
  onChange,
  description,
  disabled = false,
}: {
  value: SessionLength
  onChange: (minutes: SessionLength) => void
  description?: string
  disabled?: boolean
}) {
  const baseId = useId()
  const legendId = `${baseId}-legend`
  const descriptionId = `${baseId}-description`

  return (
    <FieldSet className="gap-2">
      <FieldLegend id={legendId} variant="label" className="mb-1 text-on-surface">
        Length
      </FieldLegend>
      <ToggleGroup
        type="single"
        variant="outline"
        spacing={0}
        value={String(value)}
        onValueChange={(next) => {
          const minutes = Number(next)
          if (isSessionLength(minutes)) onChange(minutes)
        }}
        aria-labelledby={legendId}
        aria-describedby={description ? descriptionId : undefined}
        disabled={disabled}
      >
        {SESSION_LENGTHS.map((minutes) => (
          <ToggleGroupItem key={minutes} value={String(minutes)} className="min-w-20 tabular-nums">
            {formatDuration(minutes)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {description ? (
        <p id={descriptionId} className="type-body-s text-on-surface-variant">
          {description}
        </p>
      ) : null}
    </FieldSet>
  )
}
