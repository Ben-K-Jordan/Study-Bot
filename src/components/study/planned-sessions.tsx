"use client"

import Link from "next/link"
import { CalendarClockIcon } from "lucide-react"

import { formatDateTime, formatTimeRange } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { SectionHeader } from "@/components/app/section-header"
import type { PlannedSessionRef, StudyRecommendations } from "@/components/study/types"

function PlannedRow({ item, timeZone }: { item: PlannedSessionRef; timeZone?: string }) {
  const time = formatTimeRange(item.start_time, item.end_time, { timeZone })
  const action = item.status === "IN_PROGRESS" ? "Resume session" : "Start session"
  const what = item.topic_scope ? `${item.mode_label} on ${item.topic_scope}` : item.mode_label
  return (
    <>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="type-title-s text-on-surface tabular-nums">{time}</p>
        <p className="type-body-m text-pretty text-on-surface-variant">{what}</p>
      </div>
      <Button asChild variant="secondary" className="self-start">
        <Link href={`/s/${encodeURIComponent(item.session_id)}`} aria-label={`${action}: ${item.mode_label}, ${time}`}>
          {action}
        </Link>
      </Button>
    </>
  )
}

/**
 * Today's planned sessions for the course, each one click from starting.
 * With nothing left today it names the next planned session; with no plan
 * it points to Plan.
 */
export function PlannedSessions({
  recs,
  courseName,
  timeZone,
}: {
  recs: StudyRecommendations
  courseName: string
  timeZone?: string
}) {
  const zone = recs.time_zone ?? timeZone
  const items = recs.plan_nudge?.items ?? []
  const hasPlan = recs.exam !== null

  return (
    <section aria-labelledby="planned-title" className="flex flex-col gap-2">
      <SectionHeader
        id="planned-title"
        title="Planned for today"
        action={hasPlan ? { href: "/plan", label: "Open plan" } : undefined}
      />
      <Card className="gap-0 py-0">
        {items.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((item) => (
              <li key={item.session_id} className="flex flex-col gap-3 p-4">
                <PlannedRow item={item} timeZone={zone} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex items-start gap-3 p-4">
            <CalendarClockIcon className="mt-0.5 size-5 shrink-0 text-on-surface-variant" aria-hidden="true" />
            <div className="flex min-w-0 flex-col gap-2">
              <p className="type-body-m text-pretty text-on-surface">
                {recs.next_planned
                  ? `No sessions left today. Next: ${recs.next_planned.mode_label}, ${formatDateTime(recs.next_planned.start_time, { timeZone: zone })}.`
                  : hasPlan
                    ? `No more sessions planned for ${courseName}.`
                    : `No plan for ${courseName} yet. A plan schedules sessions up to your exam date.`}
              </p>
              {hasPlan ? null : (
                <Button asChild variant="outline" size="sm" className="self-start">
                  <Link href="/plan/new">New plan</Link>
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>
    </section>
  )
}
