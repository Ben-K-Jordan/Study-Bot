import Link from "next/link"
import { CalendarClockIcon } from "lucide-react"
import { cva } from "class-variance-authority"

import { cn } from "@/lib/utils"
import {
  daysUntil,
  formatCountdown,
  formatDateWeekday,
  formatNumber,
  plural,
  type DateInput,
} from "@/lib/format"
import { ProgressLinear } from "@/components/app/progress-linear"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

const cardVariants = cva(
  "relative flex min-w-0 flex-col gap-4 rounded-2xl p-5 transition-shadow duration-150 ease-standard",
  {
    variants: {
      featured: {
        // The nearest exam: tonal primary container.
        true: "bg-primary-container text-on-primary-container",
        false: "bg-card text-on-surface ring-1 ring-border",
      },
      interactive: {
        // The card link stretches over the whole card, so the card draws the
        // focus ring: the link itself sits in a truncating heading that
        // would clip a ring drawn around its text.
        true: "has-[a[data-card-link]:hover]:shadow-sm has-[a[data-card-link]:focus-visible]:outline-2 has-[a[data-card-link]:focus-visible]:outline-offset-2 has-[a[data-card-link]:focus-visible]:outline-ring",
        false: "",
      },
    },
    defaultVariants: { featured: false, interactive: false },
  }
)

/**
 * One exam: how many days are left, the date, plan progress, and missed
 * sessions with a Reschedule action. The nearest exam is `featured`.
 * Pass the student's time zone so server and browser count the same days.
 */
export function CountdownCard({
  examName,
  courseName,
  examDate,
  timeZone,
  now,
  sessionsDone,
  sessionsTotal,
  missedCount = 0,
  href,
  rescheduleHref,
  onReschedule,
  featured = false,
  className,
}: {
  examName: string
  courseName: string
  examDate: DateInput
  timeZone?: string
  now?: DateInput
  sessionsDone?: number
  sessionsTotal?: number
  missedCount?: number
  /** Opens the exam's plan. Makes the whole card clickable. */
  href?: string
  rescheduleHref?: string
  onReschedule?: () => void
  featured?: boolean
  className?: string
}) {
  const days = daysUntil(examDate, { timeZone, now })
  const message = formatCountdown(examName, examDate, { timeZone, now })
  const bigNumber = days > 0 ? days : days === 0 ? "Today" : null
  // The number is drawn large on its own, so the unit is the plural form alone
  const unit = days > 0 ? plural(days, { one: "day", other: "days" }) : null
  const hasProgress = sessionsTotal !== undefined && sessionsTotal > 0
  const progress = hasProgress ? Math.round(((sessionsDone ?? 0) / sessionsTotal) * 100) : 0
  const progressText = hasProgress
    ? `${formatNumber(sessionsDone ?? 0)} of ${plural(sessionsTotal, { one: "# session", other: "# sessions" })} done`
    : null

  return (
    <article
      data-slot="countdown-card"
      aria-label={message}
      className={cn(cardVariants({ featured, interactive: !!href }), className)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="truncate type-title-m">
            {href ? (
              <Link
                href={href}
                data-card-link
                className="outline-none [--focus-ring-color:transparent] after:absolute after:inset-0 after:rounded-2xl"
              >
                {examName}
              </Link>
            ) : (
              examName
            )}
          </h3>
          <p
            className={cn(
              "truncate type-body-m",
              featured ? "text-on-primary-container" : "text-on-surface-variant"
            )}
          >
            {courseName}
          </p>
        </div>
        <CalendarClockIcon
          className={cn("size-5 shrink-0", featured ? "text-on-primary-container" : "text-on-surface-variant")}
          aria-hidden="true"
        />
      </div>

      <div className="flex items-baseline gap-2" aria-hidden="true">
        {bigNumber !== null ? (
          <>
            <span
              className={cn(
                "tabular-nums",
                typeof bigNumber === "number" ? "type-display-m" : "type-headline-l"
              )}
              suppressHydrationWarning
            >
              {bigNumber}
            </span>
            {unit ? <span className="type-title-m">{unit}</span> : null}
          </>
        ) : (
          <span className="type-title-l">Done</span>
        )}
      </div>
      <p
        className={cn(
          "-mt-2 type-body-m",
          featured ? "text-on-primary-container" : "text-on-surface-variant"
        )}
        suppressHydrationWarning
      >
        <span className="sr-only">{message}. </span>
        {formatDateWeekday(examDate, { timeZone })}
      </p>

      {hasProgress ? (
        <div className="flex flex-col gap-2">
          <ProgressLinear value={progress} label={`${examName} plan progress`} valueText={progressText ?? undefined} />
          <p
            className={cn(
              "type-label-m tabular-nums",
              featured ? "text-on-primary-container" : "text-on-surface-variant"
            )}
          >
            {progressText}
          </p>
        </div>
      ) : null}

      {missedCount > 0 ? (
        <div className="relative z-10 flex flex-wrap items-center gap-2">
          <Badge variant="warning">{plural(missedCount, { one: "# missed", other: "# missed" })}</Badge>
          {rescheduleHref ? (
            <Button asChild variant="text" size="sm" className={featured ? "text-on-primary-container" : undefined}>
              <Link href={rescheduleHref}>Reschedule</Link>
            </Button>
          ) : onReschedule ? (
            <Button
              variant="text"
              size="sm"
              onClick={onReschedule}
              className={featured ? "text-on-primary-container" : undefined}
            >
              Reschedule
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}
