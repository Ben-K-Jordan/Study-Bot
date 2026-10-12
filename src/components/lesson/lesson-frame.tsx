"use client"

import * as React from "react"
import Link from "next/link"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { LessonAnnouncer } from "@/components/lesson/lesson-announcer"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/**
 * The thick lesson progress bar: a rounded grey track, a green fill, and a
 * soft highlight along the top third of the fill.
 */
export function LessonProgress({
  current,
  total,
  className,
}: {
  /** Questions finished so far. */
  current: number
  total: number
  className?: string
}) {
  const ratio = total > 0 ? Math.min(1, Math.max(0, current / total)) : 0
  return (
    <div
      role="progressbar"
      aria-label="Session progress"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={Math.min(current, total)}
      aria-valuetext={`${Math.min(current, total)} of ${total} questions done`}
      data-slot="lesson-progress"
      className={cn("relative h-4 w-full overflow-hidden rounded-full bg-lesson-progress-track", className)}
    >
      <div
        className="relative h-full rounded-full bg-lesson-progress-fill transition-[width] duration-(--duration-long) ease-emphasized"
        style={{ width: `${ratio * 100}%` }}
      >
        {ratio > 0 ? (
          <span
            aria-hidden="true"
            className="absolute inset-x-2 top-[3px] h-[5px] rounded-full bg-white/30"
          />
        ) : null}
      </div>
    </div>
  )
}

/**
 * Full-screen frame for one question at a time, in Duolingo's grammar:
 * a top bar with Leave session, the thick progress bar and "Question 3 of
 * 12"; the question as the page's h1, the largest thing on screen; the
 * answer area; and a footer bar for Skip and Check that FeedbackSheet
 * replaces after an answer. Provides the live region primitives announce
 * through. Use inside the /s/[sessionId] lesson layout.
 */
export function LessonFrame({
  current,
  total,
  questionNumber,
  status,
  closeHref = "/",
  onClose,
  closeLabel = "Leave session",
  question,
  questionId,
  children,
  footer,
  feedback,
  className,
}: {
  /** Questions finished, for the progress bar. */
  current: number
  total: number
  /** The question on screen, for "Question 3 of 12". Defaults to current + 1. */
  questionNumber?: number
  /** Phase or mode beside the counter, such as "Answering" in exam simulation. */
  status?: React.ReactNode
  closeHref?: string
  /** Called instead of following closeHref, for example to save first. */
  onClose?: () => void
  closeLabel?: string
  /** The question text, rendered as the page's h1. */
  question?: React.ReactNode
  /** Id for the h1, so AnswerOptionGroup can point at it with labelledBy. */
  questionId?: string
  /** The answer area: options, a recall box, a confidence picker. */
  children: React.ReactNode
  /** Actions before checking: Skip (neutral) on the left, Check on the right. */
  footer?: React.ReactNode
  /** A FeedbackSheet; when present it replaces the footer. */
  feedback?: React.ReactNode
  className?: string
}) {
  const shown = Math.min(questionNumber ?? current + 1, total)

  const closeButton = <XIcon className="size-6" strokeWidth={2.5} aria-hidden="true" />
  const closeClasses =
    "flex size-11 shrink-0 items-center justify-center rounded-full text-lesson-muted transition-colors hover:bg-lesson-option-hover hover:text-lesson-on-surface"

  return (
    <LessonAnnouncer>
      <div data-slot="lesson-frame" className={cn("flex min-h-dvh flex-1 flex-col", className)}>
        <div className="sticky top-0 z-10 bg-lesson-surface">
          <div className="mx-auto flex w-full max-w-4xl items-center gap-3 px-4 py-4 sm:gap-4 sm:px-8 sm:py-6">
            <Tooltip>
              <TooltipTrigger asChild>
                {onClose ? (
                  <button type="button" onClick={onClose} aria-label={closeLabel} className={closeClasses}>
                    {closeButton}
                  </button>
                ) : (
                  <Link href={closeHref} aria-label={closeLabel} className={closeClasses}>
                    {closeButton}
                  </Link>
                )}
              </TooltipTrigger>
              <TooltipContent side="bottom">{closeLabel}. Your answers are saved.</TooltipContent>
            </Tooltip>
            <LessonProgress current={current} total={total} className="flex-1" />
            <p className="shrink-0 type-label-l font-bold text-lesson-muted tabular-nums">
              <span className="sr-only sm:not-sr-only">Question </span>
              {shown} of {total}
            </p>
          </div>
          {status ? (
            <div className="mx-auto -mt-2 w-full max-w-4xl px-4 pb-2 type-label-l font-bold text-lesson-muted sm:px-8">
              {status}
            </div>
          ) : null}
        </div>

        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 pt-4 pb-10 sm:px-8 sm:pt-8">
          {question ? (
            <h1
              id={questionId}
              className="type-headline-s font-bold text-pretty text-lesson-on-surface sm:type-headline-m sm:font-bold"
            >
              {question}
            </h1>
          ) : null}
          {children}
        </div>

        <div className="sticky bottom-0 z-10">
          {feedback ?? (footer ? (
            <div className="border-t-2 border-lesson-option-border bg-lesson-surface">
              <div className="mx-auto flex w-full max-w-4xl flex-col-reverse gap-3 px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-6">
                {footer}
              </div>
            </div>
          ) : null)}
        </div>
      </div>
    </LessonAnnouncer>
  )
}
