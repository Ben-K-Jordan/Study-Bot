import { CircleCheckBigIcon, TargetIcon } from "lucide-react"

import { EmptyState } from "@/components/app/empty-state"
import { MasteryBar } from "@/components/app/mastery-bar"
import { SectionHeader } from "@/components/app/section-header"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { SectionError } from "@/components/progress/section-error"
import { practiceRequest, repairRequest, type SessionRequest } from "@/components/progress/session-request"
import { StartSessionButton } from "@/components/progress/start-session-button"
import {
  examForCourse,
  loadMastery,
  loadPlans,
  loadSafely,
  loadTimeZone,
  loadUnresolvedErrors,
  type CourseErrors,
} from "@/services/progress-data"
import {
  buildTopics,
  compareWeakestFirst,
  isWeakTopic,
  topicStatusLabel,
  type Topic,
} from "@/components/progress/topics"
import { plural } from "@/lib/format"
import { dayKey } from "@/lib/timezone"

const HEADING_ID = "home-weak-spots"
const MAX_TOPICS = 4

function errorSummary(count: number, sureCount: number): string {
  const errors = plural(count, { one: "# unresolved error", other: "# unresolved errors" })
  if (sureCount === 0) return errors
  return `${errors}, ${plural(sureCount, { one: "# marked Sure", other: "# marked Sure" })}`
}

interface ErrorRow extends CourseErrors {
  request: SessionRequest
}

interface TopicRow extends Topic {
  request: SessionRequest
}

async function loadWeakSpots(userId: string, now: Date) {
  const [errors, mastery, plans, timeZone] = await Promise.all([
    loadUnresolvedErrors(userId),
    loadMastery(userId),
    loadPlans(userId),
    loadTimeZone(userId),
  ])
  const todayKey = dayKey(now, timeZone)
  const examName = (courseName: string, fallback: string) =>
    examForCourse(plans, courseName, todayKey)?.examName ?? fallback

  const topics = buildTopics(
    mastery,
    plans.map((p) => ({ courseName: p.courseName, titles: p.topics })),
    now
  )
  const errorRows: ErrorRow[] = errors.map((course) => ({
    ...course,
    request: repairRequest(course.courseName, examName(course.courseName, course.examName), course.count),
  }))
  const topicRows: TopicRow[] = topics
    .filter(isWeakTopic)
    .sort(compareWeakestFirst)
    .slice(0, MAX_TOPICS)
    .map((topic) => ({
      ...topic,
      request: practiceRequest(topic.courseName, examName(topic.courseName, "General"), topic),
    }))
  return { errorRows, topicRows, practiced: topics.some((t) => t.value !== null) }
}

function WeakSpotsCard({ errorRows, topicRows }: { errorRows: ErrorRow[]; topicRows: TopicRow[] }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-5">
        {errorRows.length > 0 ? (
          <div className="flex flex-col gap-3">
            <h3 className="type-title-s text-on-surface">Unresolved errors</h3>
            <ul role="list" className="flex flex-col gap-4">
              {errorRows.map((course) => (
                <li key={course.courseName} className="flex items-center gap-4">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate type-body-l text-on-surface">{course.courseName}</span>
                    <span className="type-body-m text-on-surface-variant tabular-nums">
                      {errorSummary(course.count, course.sureCount)}
                    </span>
                  </div>
                  <StartSessionButton
                    kind="repair"
                    accessibleLabel={`Repair ${course.courseName} errors`}
                    request={course.request}
                  />
                </li>
              ))}
            </ul>
            <p className="type-body-s text-on-surface-variant">
              An error is resolved after you answer it correctly on 2 different days. Error repair starts with
              the ones you marked Sure.
            </p>
          </div>
        ) : null}

        {errorRows.length > 0 && topicRows.length > 0 ? <Separator /> : null}

        {topicRows.length > 0 ? (
          <div className="flex flex-col gap-3">
            <h3 className="type-title-s text-on-surface">Low-mastery topics</h3>
            <ul role="list" className="flex flex-col gap-4">
              {topicRows.map((topic) => (
                <li
                  key={`${topic.courseName}:${topic.key}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1"
                >
                  <MasteryBar
                    className="col-span-2 sm:col-span-1"
                    label={topic.title}
                    value={topic.value ?? 0}
                    status={topicStatusLabel(topic.status)}
                  />
                  <span className="truncate type-body-s text-on-surface-variant sm:col-start-1 sm:row-start-2">
                    {topic.courseName}
                  </span>
                  <StartSessionButton
                    className="sm:col-start-2 sm:row-span-2 sm:row-start-1"
                    kind="practice"
                    accessibleLabel={`Practice ${topic.title}`}
                    request={topic.request}
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export async function WeakSpotsSection({ userId, now }: { userId: string; now: Date }) {
  const data = await loadSafely("home.weak_spots_failed", userId, () => loadWeakSpots(userId, now))

  let content: React.ReactNode
  if (!data) {
    content = <SectionError title="Weak spots didn't load." />
  } else if (data.errorRows.length > 0 || data.topicRows.length > 0) {
    content = <WeakSpotsCard errorRows={data.errorRows} topicRows={data.topicRows} />
  } else if (data.practiced) {
    content = (
      <EmptyState
        icon={CircleCheckBigIcon}
        title="No weak spots right now"
        description="You have no unresolved errors, and every topic you've practiced is at 70% or higher."
        bordered
      />
    )
  } else {
    content = (
      <EmptyState
        icon={TargetIcon}
        title="No weak spots yet"
        description="After your first session, the errors you log and topics under 70% show up here, each with a session to fix it."
        bordered
      />
    )
  }

  return (
    <section aria-labelledby={HEADING_ID} className="flex min-w-0 flex-col gap-3">
      <SectionHeader id={HEADING_ID} title="Weak spots" action={{ href: "/achievements#mastery", label: "All topics" }} />
      {content}
    </section>
  )
}
