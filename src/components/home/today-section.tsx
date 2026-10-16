import Link from "next/link"
import { CalendarCheck2Icon, CalendarPlusIcon, PlayIcon } from "lucide-react"

import { EmptyState } from "@/components/app/empty-state"
import { SectionHeader } from "@/components/app/section-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { isOpenPlanStatus, todayPlan, type ScheduledItem } from "@/components/home/home-model"
import { modeLabel } from "@/components/progress/modes"
import { SectionError } from "@/components/progress/section-error"
import { loadPlans, loadSafely, loadSessions, loadTimeZone, type SessionInfo } from "@/services/progress-data"
import { formatDateTime, formatDateWeekday, formatList, formatTimeRange } from "@/lib/format"

const HEADING_ID = "home-today"

const STATUS_BADGE: Record<string, { label: string; variant: "success" | "warning" | "secondary" | "outline" }> = {
  DONE: { label: "Done", variant: "success" },
  MISSED: { label: "Missed", variant: "warning" },
  SKIPPED: { label: "Skipped", variant: "outline" },
  RESCHEDULED: { label: "Rescheduled", variant: "outline" },
  IN_PROGRESS: { label: "In progress", variant: "secondary" },
}

function SessionCard({
  item,
  session,
  timeZone,
  isToday,
}: {
  item: ScheduledItem
  session: SessionInfo | undefined
  timeZone: string
  isToday: boolean
}) {
  const inProgress = item.status === "IN_PROGRESS"
  const when = formatTimeRange(item.startTime, item.endTime, { timeZone })
  const topics = session?.topics ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <h3 className="type-title-l">{modeLabel(session?.mode)}</h3>
          {inProgress ? <Badge variant="secondary">In progress</Badge> : null}
        </CardTitle>
        <CardDescription className="flex flex-col gap-0.5">
          <span className="tabular-nums text-on-surface">
            {isToday ? when : `${formatDateWeekday(item.startTime, { timeZone })}, ${when}`}
          </span>
          <span>
            {item.courseName}, {item.examName}
          </span>
        </CardDescription>
      </CardHeader>
      {topics.length > 0 ? (
        <CardContent className="type-body-m text-on-surface-variant">
          {topics.length === 1 ? "Topic" : "Topics"}: {formatList(topics)}
        </CardContent>
      ) : null}
      <CardFooter>
        <Button asChild size="lg" className="w-full sm:w-auto">
          <Link href={`/s/${encodeURIComponent(item.sessionId)}`}>
            <PlayIcon data-icon="inline-start" aria-hidden="true" />
            {inProgress ? "Resume session" : "Start session"}
          </Link>
        </Button>
      </CardFooter>
    </Card>
  )
}

function OtherSessions({
  items,
  sessions,
  timeZone,
}: {
  items: readonly ScheduledItem[]
  sessions: Map<string, SessionInfo>
  timeZone: string
}) {
  if (items.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <h3 className="type-title-s text-on-surface">Also today</h3>
      <ul role="list" className="flex flex-col divide-y divide-border rounded-2xl bg-card px-4 ring-1 ring-border">
        {items.map((item) => {
          const badge = STATUS_BADGE[item.status]
          const open = isOpenPlanStatus(item.status)
          const label = `${modeLabel(sessions.get(item.sessionId)?.mode)}, ${item.courseName}`
          return (
            <li key={item.id} className="flex min-h-12 items-center gap-3 py-2">
              <span className="w-28 shrink-0 type-body-m tabular-nums text-on-surface-variant">
                {formatTimeRange(item.startTime, item.endTime, { timeZone })}
              </span>
              {open ? (
                <Link
                  href={`/s/${encodeURIComponent(item.sessionId)}`}
                  className="min-w-0 flex-1 truncate type-body-m text-primary underline-offset-4 hover:underline"
                >
                  {label}
                </Link>
              ) : (
                <span className="min-w-0 flex-1 truncate type-body-m text-on-surface">{label}</span>
              )}
              {badge ? <Badge variant={badge.variant}>{badge.label}</Badge> : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export async function TodaySection({ userId, now }: { userId: string; now: Date }) {
  const data = await loadSafely("home.today_failed", userId, async () => {
    const [plans, timeZone] = await Promise.all([loadPlans(userId), loadTimeZone(userId)])
    const plan = todayPlan(plans, timeZone, now)
    const shown = plan.current ?? plan.next
    const sessions = await loadSessions(userId, [
      ...plan.today.map((i) => i.sessionId),
      ...(shown ? [shown.sessionId] : []),
    ])
    return { ...plan, sessions, timeZone, hasPlans: plans.length > 0 }
  })

  let description: string | null = null
  let content: React.ReactNode
  if (!data) {
    content = <SectionError title="Today's sessions didn't load." />
  } else {
    const { today, current, next, sessions, timeZone } = data
    const others = today.filter((i) => i.id !== current?.id)
    if (current) {
      content = (
        <>
          <SessionCard
            item={current}
            session={sessions.get(current.sessionId)}
            timeZone={timeZone}
            isToday={today.some((i) => i.id === current.id)}
          />
          <OtherSessions items={others} sessions={sessions} timeZone={timeZone} />
        </>
      )
    } else if (next) {
      const nextLine = `${modeLabel(sessions.get(next.sessionId)?.mode)}, ${formatDateTime(next.startTime, { timeZone })}`
      description =
        today.length > 0 ? `Today's sessions are done. Next: ${nextLine}.` : `No sessions today. Next: ${nextLine}.`
      content = (
        <>
          <OtherSessions items={others} sessions={sessions} timeZone={timeZone} />
          <SessionCard item={next} session={sessions.get(next.sessionId)} timeZone={timeZone} isToday={false} />
        </>
      )
    } else if (today.length > 0) {
      description = "Today's sessions are done, and nothing else is scheduled."
      content = <OtherSessions items={others} sessions={sessions} timeZone={timeZone} />
    } else if (data.hasPlans) {
      content = (
        <EmptyState
          icon={CalendarCheck2Icon}
          title="Nothing scheduled"
          description="Every session in your plans is behind you. A new plan schedules more up to your next exam."
          action={
            <Button asChild variant="outline">
              <Link href="/plan/new">New plan</Link>
            </Button>
          }
          bordered
        />
      )
    } else {
      content = (
        <EmptyState
          icon={CalendarPlusIcon}
          title="No sessions scheduled"
          description="Sessions from your plan show up here on the day they're scheduled."
          bordered
        />
      )
    }
  }

  return (
    <section aria-labelledby={HEADING_ID} className="flex min-w-0 flex-col gap-3">
      <SectionHeader
        id={HEADING_ID}
        title="Today"
        description={description}
        action={{ href: "/plan", label: "Open plan" }}
      />
      {content}
    </section>
  )
}
