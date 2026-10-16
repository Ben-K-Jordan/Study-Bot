"use client"

import Link from "next/link"
import { FlameIcon, FolderUpIcon } from "lucide-react"

import { formatDateWeekday, plural } from "@/lib/format"
import { useApi } from "@/lib/swr"
import { useActiveCourse } from "@/hooks/use-active-course"
import { useCourseOptions } from "@/hooks/use-course-options"
import { useMounted } from "@/hooks/use-mounted"
import { Button } from "@/components/ui/button"
import { CourseSwitcher } from "@/components/app/course-switcher"
import { EmptyState } from "@/components/app/empty-state"
import { ErrorState } from "@/components/app/error-state"
import { LoadingRegion } from "@/components/app/skeletons"
import { PageContainer } from "@/components/app/page-container"
import { StatLine, type StatItem } from "@/components/app/stat-line"
import { CourseTools } from "@/components/study/course-tools"
import { NextSessionCard } from "@/components/study/next-session-card"
import { PlannedSessions } from "@/components/study/planned-sessions"
import { describeRequestError } from "@/components/study/request-errors"
import { examCountdown } from "@/components/study/study-copy"
import { NextSessionSkeleton, SideListSkeleton, StudySkeleton } from "@/components/study/study-skeleton"
import type { LearnResponse, StudyRecommendations } from "@/components/study/types"

function ExamLine({ exam }: { exam: NonNullable<StudyRecommendations["exam"]> }) {
  // A calendar date: format it at noon UTC so no zone moves it a day.
  const date = formatDateWeekday(`${exam.date}T12:00:00Z`, { timeZone: "UTC" })
  return (
    <p className="type-title-m text-on-surface tabular-nums">
      {examCountdown(exam.name, exam.days_until)}
      <span aria-hidden="true" className="px-2 text-outline">
        ·
      </span>
      <span className="sr-only">, </span>
      <span className="type-body-l text-on-surface-variant">{date}</span>
    </p>
  )
}

function weakSpotStats(recs: StudyRecommendations): StatItem[] {
  const items: StatItem[] = [
    { value: plural(recs.unresolved_errors.count, { zero: "No unresolved errors", one: "# unresolved error", other: "# unresolved errors" }) },
    { value: plural(recs.overdue_objectives.length, { zero: "No topics due", one: "# topic due", other: "# topics due" }) },
  ]
  if (recs.streak > 0) {
    items.push({ value: plural(recs.streak, { one: "#-day streak", other: "#-day streak" }), icon: FlameIcon })
  }
  return items
}

/** The recommendation for a course, and for the exam chosen with it. */
export function recommendationsUrl(courseName: string, examName: string | null): string {
  const params = new URLSearchParams({ course_name: courseName })
  if (examName) params.set("exam_name", examName)
  return `/api/learn/recommendations?${params.toString()}`
}

/**
 * Study: what to run next for the active course and why, with the mode and
 * length picker, today's planned sessions and the course's other tools.
 * Every request is keyed by its URL, so a course switch can never show the
 * previous course's recommendation.
 *
 * The page seeds the course list and course counts from the server. The
 * active course lives in the browser, so the course's own content waits
 * for hydration (skeleton until then, never another course's content), and
 * its request starts right away instead of after the course list.
 */
export function StudyView({ timeZone }: { timeZone?: string }) {
  const mounted = useMounted()
  const courses = useCourseOptions()
  const { course } = useActiveCourse(courses.keys)
  const ready = mounted && course !== null
  const courseName = ready ? course.courseName : null

  const learn = useApi<LearnResponse>(courses.options?.length === 0 ? null : "/api/learn")
  const recs = useApi<StudyRecommendations>(
    ready ? recommendationsUrl(course.courseName, course.examName) : null
  )

  if (courses.error && !courses.options) {
    return (
      <PageContainer>
        <ErrorState
          title="Courses didn't load."
          description={describeRequestError(courses.error)}
          onRetry={courses.retry}
        />
      </PageContainer>
    )
  }

  if (!courses.options || !course || !courseName) {
    if (courses.options && courses.options.length === 0) {
      return (
        <PageContainer>
          <EmptyState
            icon={FolderUpIcon}
            headingLevel="h2"
            title="No courses yet"
            description="Upload your course files and set your exam date. Study Bot schedules practice questions from them up to the exam."
            action={
              <Button asChild>
                <Link href="/plan/materials">Upload materials</Link>
              </Button>
            }
          />
        </PageContainer>
      )
    }
    return (
      <PageContainer>
        <StudySkeleton />
      </PageContainer>
    )
  }

  const courseSummary = learn.data?.courses.find((c) => c.courseName === courseName) ?? null
  const recsData = recs.data
  const hasToday = (recsData?.plan_nudge?.items.length ?? 0) > 0
  const planned = (
    <div className="min-w-0 lg:col-start-2 lg:row-start-1">
      {recsData ? (
        <PlannedSessions recs={recsData} courseName={courseName} timeZone={timeZone} />
      ) : recs.error ? null : (
        <SideListSkeleton rows={1} />
      )}
    </div>
  )

  return (
    <PageContainer>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <CourseSwitcher />
        {recsData?.exam ? <ExamLine exam={recsData.exam} /> : null}
      </div>

      {/* Today's planned sessions come first in reading order when there are
          any (above the session card on a phone); on wide screens the grid
          keeps them in the right column either way. */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[auto_1fr]">
        {hasToday ? planned : null}
        <div className="flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          {recs.error && !recsData ? (
            <ErrorState
              title="Recommendation didn't load."
              description={describeRequestError(recs.error)}
              onRetry={() => recs.mutate()}
              retrying={recs.isValidating}
            />
          ) : recsData ? (
            <>
              <NextSessionCard
                key={`${courseName}::${course.examName ?? ""}`}
                courseName={courseName}
                examName={course.examName}
                recs={recsData}
                course={courseSummary}
              />
              <StatLine items={weakSpotStats(recsData)} className="px-1" />
            </>
          ) : (
            <LoadingRegion label="Loading your next session…">
              <NextSessionSkeleton />
            </LoadingRegion>
          )}
        </div>
        {hasToday ? null : planned}
        <div className="min-w-0 lg:col-start-2 lg:row-start-2">
          <CourseTools
            courseName={courseName}
            course={courseSummary}
            loading={learn.isLoading}
            failed={Boolean(learn.error) && !learn.data}
            onRetry={() => learn.mutate()}
          />
        </div>
      </div>
    </PageContainer>
  )
}
