import { cn } from "@/lib/utils"

const toneClass = {
  primary: "bg-primary",
  tertiary: "bg-tertiary",
  warning: "bg-warning",
  error: "bg-error",
} as const

/**
 * M3 linear progress indicator: a 4px active bar, a 4px gap, the remaining
 * track, and a stop dot at the end. Pass `value` from 0 to 100, or null for
 * an indeterminate bar (which stops moving under reduced motion).
 */
export function ProgressLinear({
  value,
  label,
  valueText,
  tone = "primary",
  className,
}: {
  value: number | null
  /** Accessible name: "Plan progress". */
  label: string
  /** Spoken value: "9 of 14 sessions done". Defaults to the percentage. */
  valueText?: string
  tone?: keyof typeof toneClass
  className?: string
}) {
  const clamped = value === null ? null : Math.min(100, Math.max(0, value))

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped === null ? undefined : Math.round(clamped)}
      aria-valuetext={valueText}
      data-slot="progress-linear"
      className={cn("relative flex h-1 w-full items-center gap-1 overflow-hidden", className)}
    >
      {clamped === null ? (
        <>
          <div className="absolute inset-0 rounded-full bg-secondary-container" />
          <div
            className={cn(
              "absolute inset-y-0 w-2/5 rounded-full motion-safe:animate-[progress-indeterminate_1.6s_var(--ease-standard)_infinite]",
              toneClass[tone]
            )}
          />
        </>
      ) : (
        <>
          {clamped > 0 ? (
            <div
              className={cn("h-full shrink-0 rounded-full transition-[width] duration-250 ease-standard", toneClass[tone])}
              style={{ width: `${clamped}%` }}
            />
          ) : null}
          {clamped < 100 ? (
            <div className="relative h-full min-w-1 flex-1 rounded-full bg-secondary-container">
              <span className={cn("absolute top-0 right-0 size-1 rounded-full", toneClass[tone])} />
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
