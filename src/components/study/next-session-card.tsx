"use client"

import { useState } from "react"
import Link from "next/link"
import { CircleAlertIcon, PlayIcon } from "lucide-react"

import { formatDuration, formatList, plural } from "@/lib/format"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { ErrorState } from "@/components/app/error-state"
import { LengthPicker, ModePicker } from "@/components/study/mode-picker"
import {
  DEFAULT_SESSION_LENGTH,
  questionCountFor,
  studyModeLabel,
  type SessionLength,
  type StudyModeKey,
} from "@/components/study/study-modes"
import type { StudyCourseSummary, StudyRecommendations } from "@/components/study/types"
import { useStartSession } from "@/components/study/use-start-session"

/** What the session covers, as one sentence. */
function coverageSentence(
  mode: StudyModeKey,
  recs: StudyRecommendations,
  courseName: string
): string {
  const titles = recs.next_session.topics.map((t) => t.title)
  if (mode === "ERROR_REPAIR") {
    const errors = plural(recs.unresolved_errors.count, {
      one: "# unresolved error",
      other: "# unresolved errors",
    })
    return titles.length > 0
      ? `Retests your ${errors}, from ${formatList(titles)}.`
      : `Retests your ${errors}.`
  }
  if (titles.length === 0) return `Covers questions from all your ${courseName} materials.`
  return `Covers ${formatList(titles)}.`
}

/**
 * The recommended session for the active course, with the mode and length
 * the student can change before starting. The reason is rule-based copy
 * from the server, so it carries no AI tag.
 */
export function NextSessionCard({
  courseName,
  examName,
  recs,
  course,
}: {
  courseName: string
  examName: string | null
  recs: StudyRecommendations
  /** Material counts; null while they load or if they failed. */
  course: StudyCourseSummary | null
}) {
  const recommended = recs.next_session.mode
  // The parent keys this card by course, so a course switch starts over
  // from that course's recommendation.
  const [override, setOverride] = useState<StudyModeKey | null>(null)
  const [minutes, setMinutes] = useState<SessionLength>(DEFAULT_SESSION_LENGTH)
  const { state, start } = useStartSession()

  const selected = override ?? recommended
  const isRecommended = selected === recommended
  const errorCount = recs.unresolved_errors.count
  const questions =
    selected === "ERROR_REPAIR"
      ? Math.min(Math.max(errorCount, 1), questionCountFor(minutes))
      : questionCountFor(minutes)

  const nothingReady = course !== null && course.processedDocCount === 0
  const busy = state.status === "starting" || state.status === "opening"
  const titleId = "next-session-title"

  // The coverage sentence above already gives the error count for Error
  // repair, so the reason under it leaves the count out.
  const reason = isRecommended
    ? (recs.next_session.reason_without_count ?? recs.next_session.reason)
    : `${studyModeLabel(recommended)} is the recommended mode. ${recs.next_session.reason}`

  return (
    <section aria-labelledby={titleId}>
      <Card className="max-sm:[--card-spacing:--spacing(4)]">
        <CardHeader className="gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id={titleId} className="type-headline-s text-on-surface">
              {studyModeLabel(selected)}
            </h2>
            {isRecommended ? <Badge variant="secondary">Recommended</Badge> : null}
          </div>
          <p className="max-w-prose type-body-l text-pretty text-on-surface">
            {coverageSentence(selected, recs, courseName)}
          </p>
          <p className="max-w-prose type-body-m text-pretty text-on-surface-variant">{reason}</p>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          <Separator />
          <ModePicker
            value={selected}
            onChange={setOverride}
            recommended={recommended}
            unresolvedErrors={errorCount}
            courseName={courseName}
            disabled={busy}
          />
          <LengthPicker
            value={minutes}
            onChange={setMinutes}
            disabled={busy}
            description={`About ${plural(questions, { one: "# question", other: "# questions" })}.`}
          />
          {nothingReady && course ? (
            <Alert variant="warning" role="status">
              <CircleAlertIcon aria-hidden="true" />
              <AlertTitle>
                {course.failedDocCount === course.docCount
                  ? `Your ${courseName} files couldn't be read`
                  : `Your ${courseName} files are still processing`}
              </AlertTitle>
              <AlertDescription>
                {course.failedDocCount === course.docCount ? (
                  <>
                    Sessions are written from your files.{" "}
                    <Link
                      href={`/plan/materials?course=${encodeURIComponent(courseName)}`}
                      className="underline underline-offset-4"
                    >
                      Upload them again
                    </Link>
                    .
                  </>
                ) : (
                  "Sessions are written from your files. Start one once a file is ready."
                )}
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>

        <CardFooter className="flex-wrap gap-x-4 gap-y-3 border-t border-border">
          <Button
            size="lg"
            onClick={() => start({ courseName, examName, mode: selected, minutes })}
            disabled={busy || nothingReady}
          >
            {busy ? (
              <Spinner data-icon="inline-start" aria-hidden="true" role={undefined} />
            ) : (
              <PlayIcon data-icon="inline-start" aria-hidden="true" />
            )}
            {busy ? "Starting session…" : "Start session"}
          </Button>
          <p className="type-body-m text-on-surface-variant tabular-nums">
            {studyModeLabel(selected)}, {formatDuration(minutes)}
          </p>
          <p role="status" className="sr-only">
            {busy ? "Starting session…" : ""}
          </p>
        </CardFooter>

        {state.status === "failed" ? (
          <CardContent>
            <ErrorState
              title="Session not started."
              description={state.message}
              onRetry={() => start({ courseName, examName, mode: selected, minutes })}
            />
          </CardContent>
        ) : null}
      </Card>
    </section>
  )
}
