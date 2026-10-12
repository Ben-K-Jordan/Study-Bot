"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"
import { KbdHint } from "@/components/app/kbd-hint"
import { Spinner } from "@/components/ui/spinner"

/**
 * The tactile lesson button: 16px corners, a 2px border and a 4px bottom
 * lip that shrinks when pressed. `check` submits an answer, `correct` and
 * `wrong` continue after feedback, `neutral` is for Skip and secondary
 * actions, `primary` starts or resumes a session.
 */
export const lessonButtonVariants = cva(
  [
    "lesson-lip relative inline-flex min-h-12 min-w-32 shrink-0 items-center justify-center gap-2 rounded-2xl border-2 px-6 py-2 text-base leading-6 font-bold tracking-[0.2px] whitespace-nowrap select-none outline-none",
    "[--focus-ring-offset:6px] hover:brightness-[1.08]",
    "disabled:pointer-events-none disabled:border-lesson-disabled disabled:bg-lesson-disabled disabled:text-lesson-on-disabled disabled:[--lip:var(--lesson-disabled)]",
    // Busy keeps its colours: the spinner and label say what is happening.
    "aria-busy:pointer-events-none aria-busy:cursor-progress",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  ],
  {
    variants: {
      variant: {
        check:
          "border-lesson-check bg-lesson-check text-lesson-on-check [--lip:var(--lesson-check-lip)]",
        correct:
          "border-lesson-check bg-lesson-check text-lesson-on-check [--lip:var(--lesson-check-lip)]",
        wrong:
          "border-lesson-wrong-button bg-lesson-wrong-button text-lesson-on-wrong-button [--lip:var(--lesson-wrong-lip)]",
        neutral:
          "border-lesson-option-border bg-lesson-option text-lesson-neutral-text [--lip:var(--lesson-option-border)] hover:bg-lesson-option-hover hover:brightness-100",
        primary:
          "border-lesson-primary bg-lesson-primary text-lesson-on-primary [--lip:var(--lesson-primary-lip)]",
      },
      width: {
        auto: "",
        full: "w-full",
      },
    },
    defaultVariants: { variant: "check", width: "auto" },
  }
)

export function LessonButton({
  className,
  variant,
  width,
  loading = false,
  loadingLabel,
  kbd,
  asChild = false,
  disabled,
  onClick,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof lessonButtonVariants> & {
    /** Shows a spinner, ignores presses, and swaps in `loadingLabel`. */
    loading?: boolean
    /** In-progress label that reuses the verb: "Checking…". */
    loadingLabel?: string
    /** Key hint drawn inside the button on fine pointers: "Enter". */
    kbd?: string | readonly string[]
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"
  return (
    <Comp
      data-slot="lesson-button"
      data-variant={variant ?? "check"}
      className={cn(lessonButtonVariants({ variant, width }), className)}
      disabled={asChild ? undefined : disabled}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
        if (loading) {
          event.preventDefault()
          return
        }
        onClick?.(event)
      }}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <Spinner aria-hidden="true" role={undefined} /> : null}
          {loading && loadingLabel ? loadingLabel : children}
          {kbd && !loading ? (
            <KbdHint
              keys={kbd}
              className="ml-1 *:data-[slot=kbd]:border-current/30 *:data-[slot=kbd]:bg-transparent *:data-[slot=kbd]:text-current"
            />
          ) : null}
        </>
      )}
    </Comp>
  )
}
