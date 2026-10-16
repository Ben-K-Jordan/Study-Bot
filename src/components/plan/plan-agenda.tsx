import Link from "next/link"
import {
  CalendarClockIcon,
  CalendarIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CirclePlayIcon,
  CircleSlashIcon,
  GraduationCapIcon,
  PlayIcon,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import {
  formatDateWeekday,
  formatDayHeading,
  formatDuration,
  formatList,
  formatTimeRange,
  plural,
} from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  buildAgenda,
  dayKeyToDate,
  DAY_KEY_ZONE,
  modeLabel,
  type AgendaDay,
  type AgendaSession,
  type PlanView,
  type SessionDisplay,
} from "@/components/plan/plan-model"
import { AgendaEarlier } from "@/components/plan/agenda-earlier"
import { RescheduleRowButton } from "@/components/plan/plan-actions"

// The badge carries the status in words and an icon. No empty circle: in
// Google Tasks and Calendar that is the "mark complete" control.
const STATUS: Record<
  SessionDisplay,
  { label: string; icon: LucideIcon; badge: "success" | "warning" | "secondary" | "outline" | "default" }
> = {
  done: { label: "Done", icon: CircleCheckIcon, badge: "success" },
  in_progress: { label: "In progress", icon: CirclePlayIcon, badge: "secondary" },
  missed: { label: "Missed", icon: CircleAlertIcon, badge: "warning" },
  skipped: { label: "Skipped", icon: CircleSlashIcon, badge: "outline" },
  today: { label: "Today", icon: CalendarClockIcon, badge: "default" },
  scheduled: { label: "Scheduled", icon: CalendarIcon, badge: "outline" },
}

function DayLabel({ day, showMonth }: { day: AgendaDay; showMonth: boolean }) {
  // "Thu, Oct 15" gives the weekday and month; the day number is in the key
  const date = dayKeyToDate(day.key)
  const [weekday, monthDay] = formatDateWeekday(date, { timeZone: DAY_KEY_ZONE }).split(", ")
  const month = monthDay?.split(" ")[0] ?? ""
  const dayNumber = String(Number(day.key.slice(8, 10)))

  return (
    <div aria-hidden="true" className="flex flex-col items-center gap-0.5 pt-2.5">
      <span className={cn("type-label-m", day.isToday ? "text-primary" : "text-on-surface-variant")}>{weekday}</span>
      <span
        className={cn(
          "flex size-10 items-center justify-center rounded-full type-title-l tabular-nums",
          day.isToday ? "bg-primary text-primary-foreground" : day.isPast ? "text-on-surface-variant" : "text-on-surface"
        )}
      >
        {dayNumber}
      </span>
      {showMonth ? <span className="type-label-s text-on-surface-variant">{month}</span> : null}
    </div>
  )
}

function SessionRow({
  session,
  timeZone,
  examName,
  canReschedule,
}: {
  session: AgendaSession
  timeZone: string
  examName: string
  canReschedule: boolean
}) {
  const { item, display } = session
  const status = STATUS[display]
  const StatusIcon = status.icon
  const label = modeLabel(item.mode)
  const time = formatTimeRange(item.start_time, item.end_time, { timeZone })
  const minutes = item.planned_minutes || Math.round((Date.parse(item.end_time) - Date.parse(item.start_time)) / 60000)
  const topics = item.topics.length > 0 ? formatList(item.topics) : null
  const skipped = display === "skipped"
  const href = `/s/${encodeURIComponent(item.session_id)}`
  const movedFrom =
    item.original_start_time && item.original_start_time !== item.start_time
      ? formatDateWeekday(item.original_start_time, { timeZone })
      : null

  return (
    <li
      className={cn(
        "group/session relative flex flex-col gap-3 rounded-2xl px-4 py-3 sm:flex-row sm:items-center sm:gap-4",
        !skipped && "has-[a[data-session-link]:hover]:bg-on-surface/4"
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className={cn("type-title-s", skipped ? "text-on-surface-variant line-through decoration-1" : "text-on-surface")}>
          {skipped ? (
            label
          ) : (
            <Link
              href={href}
              data-session-link
              aria-label={`${label}, ${time}`}
              className="rounded-sm outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:outline-2 focus-visible:after:outline-ring focus-visible:after:outline-offset-[-2px]"
            >
              {label}
            </Link>
          )}
        </p>
        <p className="type-body-m text-on-surface-variant tabular-nums">
          {time} <span aria-hidden="true">·</span> {formatDuration(minutes)}
        </p>
        {topics ? <p className="type-body-m text-pretty text-on-surface-variant">{topics}</p> : null}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <Badge variant={status.badge}>
            <StatusIcon data-icon="inline-start" aria-hidden="true" />
            {status.label}
          </Badge>
          {movedFrom && !skipped ? (
            <span className="type-body-s text-on-surface-variant">Moved from {movedFrom}</span>
          ) : null}
          {session.afterExam && !skipped && display !== "done" ? (
            <span className="type-body-s text-warning">After {examName}</span>
          ) : null}
        </div>
      </div>

      <div className="relative z-10 flex shrink-0 flex-wrap gap-2">
        {display === "today" ? (
          <Button asChild>
            <Link href={href}>
              <PlayIcon data-icon="inline-start" aria-hidden="true" />
              Start session
            </Link>
          </Button>
        ) : display === "in_progress" ? (
          <Button asChild>
            <Link href={href}>
              <PlayIcon data-icon="inline-start" aria-hidden="true" />
              Resume session
            </Link>
          </Button>
        ) : display === "missed" && canReschedule ? (
          <RescheduleRowButton sessionLabel={`${label}, ${formatDateWeekday(item.start_time, { timeZone })}`} />
        ) : null}
      </div>
    </li>
  )
}

function ExamRow({ examName, courseName }: { examName: string; courseName: string }) {
  return (
    <li className="flex items-center gap-3 rounded-2xl bg-primary-container px-4 py-3 text-on-primary-container">
      <GraduationCapIcon className="size-5 shrink-0" aria-hidden="true" />
      <div className="flex min-w-0 flex-col">
        <p className="type-title-s">Exam day: {examName}</p>
        <p className="type-body-m">{courseName}</p>
      </div>
    </li>
  )
}

export function AgendaDayGroup({
  day,
  showMonth,
  timeZone,
  view,
  canReschedule,
}: {
  day: AgendaDay
  showMonth: boolean
  timeZone: string
  view: Pick<PlanView, "exam_name" | "course_name">
  canReschedule: boolean
}) {
  const heading = formatDayHeading(dayKeyToDate(day.key), { timeZone: DAY_KEY_ZONE })
  const headingId = `day-${day.key}`

  return (
    <li aria-labelledby={headingId} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-2 border-t border-outline-variant py-3 first:border-t-0 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:gap-x-4">
      <DayLabel day={day} showMonth={showMonth} />
      <div className="flex min-w-0 flex-col gap-1">
        <h4 id={headingId} className="sr-only">
          {heading}
          {day.isToday ? ", today" : ""}
          {day.isExamDay ? ", exam day" : ""}
        </h4>
        <ul className="flex flex-col gap-1">
          {day.isExamDay ? <ExamRow examName={view.exam_name} courseName={view.course_name} /> : null}
          {day.sessions.map((session) => (
            <SessionRow
              key={session.item.id}
              session={session}
              timeZone={timeZone}
              examName={view.exam_name}
              canReschedule={canReschedule}
            />
          ))}
        </ul>
      </div>
    </li>
  )
}

/**
 * The plan as dated days, like Google Calendar's schedule view: the day on
 * the left (today filled), sessions on the right with time range, mode,
 * topics and a status in words, and the exam day in date order. Finished
 * days before the first one that needs attention fold into "Earlier".
 */
export function PlanAgenda({
  view,
  timeZone,
  canReschedule,
  now = new Date(),
}: {
  view: PlanView
  timeZone: string
  canReschedule: boolean
  now?: Date
}) {
  const agenda = buildAgenda(view, { timeZone, now })
  const sessionCount = view.items.length

  const monthOf = (key: string) => key.slice(0, 7)
  const firstVisible = agenda.days[0]?.key

  return (
    <section aria-labelledby="plan-sessions" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id="plan-sessions" className="type-title-m text-on-surface">
          Sessions
        </h3>
        <p className="type-body-m text-on-surface-variant">
          {plural(sessionCount, {
            zero: "No sessions in this plan",
            one: "# session in this plan",
            other: "# sessions in this plan",
          })}
        </p>
      </div>

      {sessionCount === 0 ? (
        <p className="flex items-start gap-2 rounded-2xl bg-surface-container-low px-4 py-3 type-body-m text-on-surface-variant">
          <CircleDashedIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Nothing is scheduled in this plan. Replace it to schedule sessions up to {view.exam_name}.
        </p>
      ) : null}

      {agenda.earlier.length > 0 ? (
        <AgendaEarlier count={agenda.earlier.reduce((n, day) => n + day.sessions.length, 0)}>
          <ol className="flex flex-col">
            {agenda.earlier.map((day, index) => (
              <AgendaDayGroup
                key={day.key}
                day={day}
                showMonth={index === 0 || monthOf(day.key) !== monthOf(agenda.earlier[index - 1].key)}
                timeZone={timeZone}
                view={view}
                canReschedule={canReschedule}
              />
            ))}
          </ol>
        </AgendaEarlier>
      ) : null}

      <ol className="flex flex-col" aria-label={`${view.exam_name} sessions by day`}>
        {agenda.days.map((day, index) => (
          <AgendaDayGroup
            key={day.key}
            day={day}
            showMonth={day.key === firstVisible || monthOf(day.key) !== monthOf(agenda.days[index - 1]?.key ?? "")}
            timeZone={timeZone}
            view={view}
            canReschedule={canReschedule}
          />
        ))}
      </ol>
    </section>
  )
}
