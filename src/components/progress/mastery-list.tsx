"use client"

import { useState } from "react"

import { MasteryBar } from "@/components/app/mastery-bar"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { practiceRequest } from "@/components/progress/session-request"
import { StartSessionButton } from "@/components/progress/start-session-button"
import {
  compareByTitle,
  compareWeakestFirst,
  topicStatusLabel,
  type Topic,
} from "@/components/progress/topics"
import { formatDate, plural } from "@/lib/format"

export interface CourseTopics {
  courseName: string
  /** Exam the Practice sessions count toward. */
  examName: string
  /** "Prelim 2 is in 7 days", or null without an upcoming exam. */
  countdown: string | null
  topics: Topic[]
}

type SortKey = "weakest" | "name"

function TopicRow({ topic, examName, timeZone }: { topic: Topic; examName: string; timeZone: string }) {
  const practiced = topic.value !== null
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-3">
      {practiced ? (
        <MasteryBar
          className="col-span-2 sm:col-span-1"
          label={topic.title}
          value={topic.value ?? 0}
          status={topicStatusLabel(topic.status)}
        />
      ) : (
        <div className="col-span-2 flex min-w-0 items-baseline justify-between gap-3 sm:col-span-1">
          <span className="min-w-0 truncate type-body-m text-on-surface">{topic.title}</span>
          <Badge variant="outline">Not practiced</Badge>
        </div>
      )}
      <span className="truncate type-body-s text-on-surface-variant sm:col-start-1 sm:row-start-2">
        {topic.lastStudiedAt
          ? `Last practiced ${formatDate(topic.lastStudiedAt, { timeZone })}`
          : "No answers yet"}
      </span>
      <StartSessionButton
        className="sm:col-start-2 sm:row-span-2 sm:row-start-1"
        kind="practice"
        accessibleLabel={`Practice ${topic.title}`}
        request={practiceRequest(topic.courseName, examName, topic)}
      />
    </li>
  )
}

/** Mastery per course, weakest first by default, with a sort switch. */
export function MasteryList({
  courses,
  timeZone,
  headingId,
}: {
  courses: CourseTopics[]
  timeZone: string
  /** The section heading, so the sort control names what it sorts. */
  headingId: string
}) {
  const [sort, setSort] = useState<SortKey>("weakest")
  const compare = sort === "weakest" ? compareWeakestFirst : compareByTitle

  return (
    <div className="flex flex-col gap-4">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={sort}
        onValueChange={(value) => {
          if (value) setSort(value as SortKey)
        }}
        aria-label="Sort topics"
        aria-describedby={headingId}
      >
        <ToggleGroupItem value="weakest">Weakest first</ToggleGroupItem>
        <ToggleGroupItem value="name">A to Z</ToggleGroupItem>
      </ToggleGroup>

      <div className="grid gap-4 lg:grid-cols-2">
        {courses.map((course) => {
          const mastered = course.topics.filter((t) => t.status === "mastered").length
          const headingId = `mastery-${course.courseName.replace(/[^a-zA-Z0-9]+/g, "-")}`
          return (
            <Card key={course.courseName} className="min-w-0" aria-labelledby={headingId} role="group">
              <CardHeader>
                <CardTitle>
                  <h3 id={headingId}>{course.courseName}</h3>
                </CardTitle>
                <CardDescription className="flex flex-wrap gap-x-2">
                  {course.countdown ? (
                    <>
                      <span>{course.countdown}</span>
                      <span aria-hidden="true">·</span>
                    </>
                  ) : null}
                  <span className="tabular-nums">
                    {mastered} of {plural(course.topics.length, { one: "# topic", other: "# topics" })} mastered
                  </span>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul role="list" className="-my-3 flex flex-col divide-y divide-border">
                  {[...course.topics].sort(compare).map((topic) => (
                    <TopicRow
                      key={topic.key}
                      topic={topic}
                      examName={course.examName}
                      timeZone={timeZone}
                    />
                  ))}
                </ul>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
