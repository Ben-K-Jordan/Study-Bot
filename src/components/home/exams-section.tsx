import Link from "next/link"
import { CalendarPlusIcon, CalendarX2Icon } from "lucide-react"

import { CountdownCard } from "@/components/app/countdown-card"
import { EmptyState } from "@/components/app/empty-state"
import { SectionHeader } from "@/components/app/section-header"
import { Button } from "@/components/ui/button"
import { examCountdowns, type ExamCountdown } from "@/components/home/home-model"
import { SectionError } from "@/components/progress/section-error"
import { loadPlans, loadSafely, loadTimeZone } from "@/services/progress-data"

const HEADING_ID = "home-exams"

function planHref(planId: string) {
  return `/plan?plan=${encodeURIComponent(planId)}`
}

/** The reschedule preview for one plan; the Plan screen opens it from this URL. */
function rescheduleHref(planId: string) {
  return `/plan?plan=${encodeURIComponent(planId)}&reschedule=1`
}

function ExamList({ exams, timeZone, now }: { exams: ExamCountdown[]; timeZone: string; now: Date }) {
  return (
    // Phones: a swipeable row so Today stays near the top. Wider: a grid.
    <ul
      role="list"
      className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pt-1 pb-3 sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-1 lg:grid-cols-4"
    >
      {exams.map((exam, index) => (
        <li key={exam.planId} className="flex w-[85%] shrink-0 snap-start sm:w-auto">
          <CountdownCard
            className="w-full"
            featured={index === 0}
            examName={exam.examName}
            courseName={exam.courseName}
            examDate={exam.examDate}
            timeZone={timeZone}
            now={now}
            sessionsDone={exam.sessionsDone}
            sessionsTotal={exam.sessionsTotal}
            missedCount={exam.missedCount}
            href={planHref(exam.planId)}
            rescheduleHref={exam.missedCount > 0 ? rescheduleHref(exam.planId) : undefined}
          />
        </li>
      ))}
    </ul>
  )
}

export async function ExamsSection({ userId, now }: { userId: string; now: Date }) {
  const data = await loadSafely("home.exams_failed", userId, async () => {
    const [plans, timeZone] = await Promise.all([loadPlans(userId), loadTimeZone(userId)])
    return { hasPlans: plans.length > 0, exams: examCountdowns(plans, timeZone, now), timeZone }
  })

  let content: React.ReactNode
  if (!data) {
    content = <SectionError title="Exams didn't load." />
  } else if (!data.hasPlans) {
    content = (
      <EmptyState
        icon={CalendarPlusIcon}
        title="No plan yet"
        description="A plan schedules practice sessions from your course files up to your exam date."
        action={
          <Button asChild>
            <Link href="/plan/new">Create plan</Link>
          </Button>
        }
        bordered
      />
    )
  } else if (data.exams.length === 0) {
    content = (
      <EmptyState
        icon={CalendarX2Icon}
        title="No upcoming exams"
        description="The exams in your plans have passed. Make a plan for the next one."
        action={
          <Button asChild>
            <Link href="/plan/new">New plan</Link>
          </Button>
        }
        bordered
      />
    )
  } else {
    content = <ExamList exams={data.exams} timeZone={data.timeZone} now={now} />
  }

  return (
    <section aria-labelledby={HEADING_ID} className="flex flex-col gap-3">
      <SectionHeader id={HEADING_ID} title="Exams" action={{ href: "/plan", label: "All plans" }} />
      {content}
    </section>
  )
}
