"use client"

import * as React from "react"
import { CheckIcon, InfoIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { useLessonAnnounce } from "@/components/lesson/lesson-announcer"
import { LessonButton } from "@/components/lesson/lesson-button"

export type FeedbackTone = "correct" | "wrong" | "neutral"

/** Matches the `short` variant in globals.css. */
const SHORT_WINDOW = "(max-height: 32rem)"

const toneStyles: Record<FeedbackTone, { sheet: string; badge: string; icon: typeof CheckIcon }> = {
  correct: {
    sheet: "bg-lesson-correct text-lesson-on-correct",
    badge: "bg-lesson-check text-lesson-on-check",
    icon: CheckIcon,
  },
  wrong: {
    sheet: "bg-lesson-wrong text-lesson-on-wrong",
    badge: "bg-lesson-wrong-button text-lesson-on-wrong-button",
    icon: XIcon,
  },
  neutral: {
    sheet: "bg-surface-container text-on-surface",
    badge: "bg-secondary-container text-on-secondary-container",
    icon: InfoIcon,
  },
}

/**
 * The bar that slides up after an answer, in place of LessonFrame's footer.
 * The heading ("Correct", "Incorrect", or a neutral line such as "Model
 * answer shown") is announced through the lesson's live region (role
 * status); the body holds a short note such as the takeaway (longer
 * feedback belongs in the page below the question); Continue is the one
 * action and takes focus so Enter moves on. The question stays visible
 * above it.
 */
export function FeedbackSheet({
  tone,
  title,
  children,
  continueLabel = "Continue",
  onContinue,
  continueDisabled = false,
  continueLoading = false,
  secondaryAction,
  autoFocusContinue = true,
  className,
}: {
  tone: FeedbackTone
  /** "Correct", "Incorrect", or a short neutral line. */
  title: string
  /** A short note: the takeaway or one sentence. Scrolls when long. */
  children?: React.ReactNode
  continueLabel?: string
  onContinue: () => void
  continueDisabled?: boolean
  continueLoading?: boolean
  /** One quieter action on the left, such as "Log the error". */
  secondaryAction?: React.ReactNode
  autoFocusContinue?: boolean
  className?: string
}) {
  const styles = toneStyles[tone]
  const Icon = styles.icon
  const titleId = React.useId()
  const continueRef = React.useRef<HTMLButtonElement>(null)
  const sheetRef = React.useRef<HTMLElement>(null)
  const announce = useLessonAnnounce()

  React.useEffect(() => {
    announce?.(title)
  }, [announce, title])

  React.useEffect(() => {
    // In short windows the frame's bars are not sticky, so the sheet sits at
    // the end of the page; bring it into view before Continue takes focus.
    if (window.matchMedia(SHORT_WINDOW).matches) {
      sheetRef.current?.scrollIntoView({ block: "nearest" })
    }
    if (autoFocusContinue) continueRef.current?.focus({ preventScroll: true })
  }, [autoFocusContinue])

  return (
    <section
      ref={sheetRef}
      aria-labelledby={titleId}
      data-slot="feedback-sheet"
      data-tone={tone}
      className={cn(
        "w-full animate-[feedback-sheet-in_var(--duration-long)_var(--ease-emphasized)]",
        styles.sheet,
        className
      )}
    >
      <div
        className={cn(
          "mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:px-8 md:flex-row md:items-end md:gap-8 md:pt-6 md:pb-6",
          // A backstop for long notes: at most about a third of a laptop
          // screen. In short windows the whole page scrolls instead (see
          // LessonFrame).
          "max-h-[60dvh] overflow-y-auto md:max-h-[35dvh] short:max-h-none short:overflow-visible"
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className={cn("flex size-10 shrink-0 items-center justify-center rounded-full", styles.badge)}
            >
              <Icon className="size-6" strokeWidth={3} />
            </span>
            {/* Inside LessonFrame the frame's live region announces the title;
                on its own the heading is its own status message. */}
            <h2 id={titleId} className="type-headline-s font-bold">
              <span role={announce ? undefined : "status"}>{title}</span>
            </h2>
          </div>
          {children ? <div className="flex flex-col gap-3 type-body-l font-medium">{children}</div> : null}
        </div>
        <div className="flex shrink-0 flex-col-reverse gap-3 sm:flex-row sm:items-center">
          {secondaryAction}
          <LessonButton
            ref={continueRef}
            variant={tone === "wrong" ? "wrong" : tone === "correct" ? "correct" : "primary"}
            onClick={onContinue}
            disabled={continueDisabled}
            loading={continueLoading}
            kbd="Enter"
            className="w-full sm:w-auto sm:min-w-40"
          >
            {continueLabel}
          </LessonButton>
        </div>
      </div>
    </section>
  )
}
