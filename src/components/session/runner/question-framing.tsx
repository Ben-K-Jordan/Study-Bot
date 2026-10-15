"use client"

import * as React from "react"
import { BookOpenCheckIcon, HistoryIcon, ListChecksIcon, RepeatIcon, SproutIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { plural } from "@/lib/format"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

import { LessonNote } from "./parts"
import type { QuestionKind, WorkedStep } from "./question-kind"

/**
 * The line under the question that says what kind of question it is, in
 * the student's terms. Standard questions get none.
 */
export function QuestionFraming({ kind }: { kind: QuestionKind }) {
  switch (kind.type) {
    case "pretest":
      return (
        <LessonNote icon={SproutIcon}>
          <p>
            Pretest. You haven&apos;t studied this topic yet, so answer what you can. Wrong answers are expected and
            don&apos;t count toward accuracy.
          </p>
        </LessonNote>
      )
    case "repair":
      return (
        <LessonNote icon={RepeatIcon}>
          <p>
            {kind.inSession
              ? "Repair question. It retests an error from earlier in this session."
              : "Repair question. It retests an error from an earlier session."}
          </p>
          {kind.original ? <OriginalQuestion text={kind.original} /> : null}
        </LessonNote>
      )
    case "review":
      return (
        <LessonNote icon={HistoryIcon}>
          <p>Due for review. You studied this topic before, and recalling it again after a gap helps you keep it.</p>
        </LessonNote>
      )
    case "worked-study":
      return (
        <LessonNote icon={BookOpenCheckIcon}>
          <p>Worked example. Study the full solution, then answer the question under it.</p>
        </LessonNote>
      )
    case "worked-completion":
      return (
        <LessonNote icon={ListChecksIcon}>
          <p>
            {kind.missing === 1
              ? "The last step is missing. Write it and say why it follows."
              : "The last two steps are missing. Write them and say why each follows."}
          </p>
          {kind.stepCount ? <StepTrack total={kind.stepCount} missing={kind.missing} /> : null}
        </LessonNote>
      )
    case "worked-full":
      return (
        <LessonNote icon={ListChecksIcon}>
          <p>Solve the whole problem. No steps are given this time.</p>
        </LessonNote>
      )
    default:
      return null
  }
}

/** The question a repair retests, one tap away. */
function OriginalQuestion({ text }: { text: string }) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="w-fit rounded-sm font-bold underline decoration-current/40 underline-offset-4 hover:decoration-current">
        Show the original question
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        <p className="whitespace-pre-line">{text}</p>
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * Backward fading made visible: the solution's steps as a row of segments,
 * given ones filled and missing ones outlined, with the same fact in words.
 */
export function StepTrack({ total, missing }: { total: number; missing: number }) {
  const given = Math.max(0, total - missing)
  const summary = `${plural(given, { zero: "No steps given", one: "# step given", other: "# steps given" })}, ${plural(
    missing,
    { one: "# missing", other: "# missing" }
  )}`
  return (
    <div className="flex flex-col gap-1.5 pt-1">
      <div aria-hidden="true" className="flex gap-1.5">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-2.5 flex-1 rounded-full",
              i < given ? "bg-lesson-progress-fill" : "border-2 border-dashed border-lesson-muted"
            )}
          />
        ))}
      </div>
      <p className="type-label-m text-lesson-muted">{summary}</p>
    </div>
  )
}

/** A worked example's solution: each step with the reason it is allowed. */
export function WorkedSteps({ steps, labelledBy }: { steps: WorkedStep[]; labelledBy: string }) {
  return (
    <section aria-labelledby={labelledBy} className="flex flex-col gap-3">
      <h2 id={labelledBy} className="type-title-m font-bold">
        Solution
      </h2>
      <ol className="flex flex-col gap-3">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3 rounded-2xl border-2 border-lesson-option-border px-4 py-3">
            <span
              aria-hidden="true"
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-lesson-progress-fill type-label-l font-bold text-lesson-on-check tabular-nums"
            >
              {i + 1}
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <p className="type-body-l font-bold">
                <span className="sr-only">Step {i + 1}: </span>
                {step.action}
              </p>
              <p className="type-body-m text-lesson-muted">
                <span className="sr-only">Why: </span>
                {step.why}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
