import Link from "next/link"
import { ListTreeIcon } from "lucide-react"

import { EmptyState } from "@/components/app/empty-state"
import { SectionHeader } from "@/components/app/section-header"
import { Button } from "@/components/ui/button"
import { examInstant } from "@/components/home/home-model"
import { MasteryList, type CourseTopics } from "@/components/progress/mastery-list"
import { SectionError } from "@/components/progress/section-error"
import {
  examForCourse,
  loadMastery,
  loadPlans,
  loadSafely,
  loadTimeZone,
} from "@/components/progress/study-data"
import { buildTopics, WEAK_TOPIC_THRESHOLD } from "@/components/progress/topics"
import { formatCountdown, formatPercent } from "@/lib/format"
import { dayKey } from "@/lib/timezone"

const HEADING_ID = "progress-mastery"

async function loadCourses(userId: string, now: Date) {
  const [mastery, plans, timeZone] = await Promise.all([
    loadMastery(userId),
    loadPlans(userId),
    loadTimeZone(userId),
  ])
  const todayKey = dayKey(now, timeZone)
  const topics = buildTopics(
    mastery,
    plans.map((p) => ({ courseName: p.courseName, titles: p.topics })),
    now
  )

  const byCourse = new Map<string, CourseTopics>()
  for (const topic of topics) {
    let course = byCourse.get(topic.courseName)
    if (!course) {
      const plan = examForCourse(plans, topic.courseName, todayKey)
      const upcoming = plan && plan.examDateKey >= todayKey
      course = {
        courseName: topic.courseName,
        examName: plan?.examName ?? "General",
        countdown: upcoming
          ? formatCountdown(plan.examName, examInstant(plan.examDateKey, timeZone), { timeZone, now })
          : null,
        topics: [],
      }
      byCourse.set(topic.courseName, course)
    }
    course.topics.push(topic)
  }

  // Courses with the nearest exam first; courses without one after, by name.
  const order = (c: CourseTopics) => examForCourse(plans, c.courseName, todayKey)?.examDateKey ?? "9999"
  const courses = [...byCourse.values()].sort(
    (a, b) => order(a).localeCompare(order(b)) || a.courseName.localeCompare(b.courseName)
  )
  return { courses, timeZone }
}

export async function MasterySection({ userId, now }: { userId: string; now: Date }) {
  const data = await loadSafely("progress.mastery_failed", userId, () => loadCourses(userId, now))

  let content: React.ReactNode
  if (!data) {
    content = <SectionError title="Mastery didn't load." />
  } else if (data.courses.length === 0) {
    content = (
      <EmptyState
        icon={ListTreeIcon}
        title="No topics yet"
        description="Topics come from your plans. Mastery fills in as you answer questions on them."
        action={
          <Button asChild>
            <Link href="/plan/new">Create plan</Link>
          </Button>
        }
        bordered
      />
    )
  } else {
    content = <MasteryList courses={data.courses} timeZone={data.timeZone} headingId={HEADING_ID} />
  }

  return (
    <section id="mastery" aria-labelledby={HEADING_ID} className="flex scroll-mt-20 flex-col gap-3">
      <SectionHeader
        id={HEADING_ID}
        title="Mastery by topic"
        description={`Mastery is your accuracy the last time you practiced a topic. Under ${formatPercent(WEAK_TOPIC_THRESHOLD)} counts as a weak spot. A topic is mastered after 3 passing reviews in a row.`}
      />
      {content}
    </section>
  )
}
