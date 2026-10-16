"use client"

import * as React from "react"
import Link from "next/link"
import { XIcon } from "lucide-react"

import { formatNumber, plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import { LessonAnnouncer } from "@/components/lesson/lesson-announcer"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/** "0 of 1 question done", "3 of 12 questions done": the bar's value text. */
export function lessonProgressText(done: number, total: number): string {
  return `${formatNumber(done)} of ${plural(total, { one: "# question", other: "# questions" })} done`
}

/**
 * Publishes the sticky footer's height (the action bar or the feedback
 * sheet) on the frame as --lesson-footer-h, so a field scrolled into view
 * stops above it (FIELD_SCROLL_MARGINS in the runner). 0 while the footer
 * sits in the page flow (short windows), where it covers nothing.
 */
function useFooterHeight(
  frameRef: React.RefObject<HTMLDivElement | null>,
  footerRef: React.RefObject<HTMLDivElement | null>,
) {
  React.useLayoutEffect(() => {
    const frame = frameRef.current
    const footer = footerRef.current
    if (!frame || !footer) return
    const update = () => {
      const covers = getComputedStyle(footer).position === "sticky"
      frame.style.setProperty("--lesson-footer-h", `${covers ? footer.offsetHeight : 0}px`)
    }
    update()
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update)
    observer?.observe(footer)
    window.addEventListener("resize", update)
    return () => {
      observer?.disconnect()
      window.removeEventListener("resize", update)
    }
  }, [frameRef, footerRef])
}

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
  const done = Math.min(current, total)
  return (
    <div
      role="progressbar"
      aria-label="Session progress"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-valuetext={lessonProgressText(done, total)}
      data-slot="lesson-progress"
      className={cn(
        "relative h-4 w-full overflow-hidden rounded-full bg-lesson-progress-track",
        // Forced colours drop both fills: outline the track, draw the bar in
        // a system colour
        "forced-colors:border forced-colors:border-[CanvasText]",
        className
      )}
    >
      <div
        className="relative h-full rounded-full bg-lesson-progress-fill transition-[width] duration-(--duration-long) ease-emphasized forced-colors:bg-[CanvasText]"
        style={{ width: `${ratio * 100}%` }}
      >
        {ratio > 0 ? (
          <span
            aria-hidden="true"
            className="absolute inset-x-2 top-[3px] h-[5px] rounded-full bg-white/30 forced-colors:hidden"
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
  headingLevel = "h1",
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
  /** h2 only when the frame is embedded in another page (the design page). */
  headingLevel?: "h1" | "h2"
  /** The answer area: options, a recall box, a confidence picker. */
  children: React.ReactNode
  /**
   * Actions before checking, secondary first: Skip (neutral), then Check.
   * Phones stack them in that order; wider windows put Skip on the left.
   */
  footer?: React.ReactNode
  /** A FeedbackSheet; when present it replaces the footer. */
  feedback?: React.ReactNode
  className?: string
}) {
  const shown = Math.min(questionNumber ?? current + 1, total)
  const Heading = headingLevel
  const frameRef = React.useRef<HTMLDivElement>(null)
  const footerRef = React.useRef<HTMLDivElement>(null)
  useFooterHeight(frameRef, footerRef)

  const closeButton = <XIcon className="size-6" strokeWidth={2.5} aria-hidden="true" />
  const closeClasses =
    "flex size-11 shrink-0 items-center justify-center rounded-full text-lesson-muted transition-colors hover:bg-lesson-option-hover hover:text-lesson-on-surface"

  return (
    <LessonAnnouncer>
      <div ref={frameRef} data-slot="lesson-frame" className={cn("flex min-h-dvh flex-1 flex-col", className)}>
        {/* The bars stay put while the question scrolls, except in short
            windows (zoomed in, or a phone in landscape), where they would
            cover the question and the focused option. */}
        <div className="sticky top-0 z-10 bg-lesson-surface short:static">
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
            {/* The phase or mode rides with the counter ("Question 3 of 12 ·
                Retrieval"), so nothing floats above the question. Under
                600px it drops to a second line inside the same block. */}
            <p className="flex max-w-[50%] shrink-0 flex-col items-end text-right type-label-l font-bold text-lesson-muted tabular-nums sm:flex-row sm:items-baseline sm:gap-1.5">
              <span className="whitespace-nowrap">
                <span className="sr-only sm:not-sr-only">Question </span>
                {formatNumber(shown)} of {formatNumber(total)}
              </span>
              {status ? (
                <>
                  <span aria-hidden="true" className="hidden sm:inline">
                    ·
                  </span>
                  <span className="sr-only">, </span>
                  <span>{status}</span>
                </>
              ) : null}
            </p>
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 pt-4 pb-10 sm:px-8 sm:pt-6">
          {question ? (
            <Heading
              id={questionId}
              className="type-headline-s font-bold text-pretty text-lesson-on-surface sm:type-headline-m sm:font-bold"
            >
              {question}
            </Heading>
          ) : null}
          {children}
        </div>

        <div ref={footerRef} className="sticky bottom-0 z-10 short:static">
          {feedback ?? (footer ? (
            <div className="border-t-2 border-lesson-option-border bg-lesson-surface">
              {/* Stacked in DOM order on phones (Skip above Check, the main
                  action nearest the thumb), side by side from 600px, so the
                  visual order always matches the Tab order. */}
              <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-6">
                {footer}
              </div>
            </div>
          ) : null)}
        </div>
      </div>
    </LessonAnnouncer>
  )
}
