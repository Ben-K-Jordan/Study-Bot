import { GaugeIcon } from "lucide-react"

import { EmptyState } from "@/components/app/empty-state"
import { ProgressLinear } from "@/components/app/progress-linear"
import { SectionHeader } from "@/components/app/section-header"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { CalibrationChartLazy } from "@/components/progress/calibration-chart-lazy"
import { Disclosure } from "@/components/progress/disclosure"
import { calibrate, CONFIDENCE_LABELS, type Calibration, type WeekPoint } from "@/lib/progress-model"
import { ScrollRegion } from "@/components/progress/scroll-region"
import { SectionError } from "@/components/progress/section-error"
import { loadRatedAnswers, loadSafely, loadTimeZone } from "@/services/progress-data"
import { formatNumber, formatPercent, plural } from "@/lib/format"
import { cn } from "@/lib/utils"

const HEADING_ID = "progress-confidence"

function rateText(rate: number | null): string {
  return rate === null ? "No questions" : formatPercent(rate)
}

function Findings({ calibration, unrated }: { calibration: Calibration; unrated: number }) {
  const lines: string[] = []
  if (calibration.ordered) lines.push("The surer you were, the more often you were correct.")
  // Same wording and definitions as the end screen's confidence results.
  if (calibration.overconfident > 0) {
    lines.push(
      `${plural(calibration.overconfident, {
        one: "Overconfident on # question: you marked it Sure and it wasn't fully correct.",
        other: "Overconfident on # questions: you marked them Sure and they weren't fully correct.",
      })} Errors you marked Sure come first in Error repair.`
    )
  }
  if (calibration.underconfident > 0) {
    lines.push(
      plural(calibration.underconfident, {
        one: "Underconfident on # question: you marked it Guessing and it was correct.",
        other: "Underconfident on # questions: you marked them Guessing and they were correct.",
      })
    )
  }
  if (unrated > 0) {
    lines.push(
      plural(unrated, {
        one: "# question had no rating, so it isn't counted here.",
        other: "# questions had no rating, so they aren't counted here.",
      })
    )
  }
  return (
    <ul role="list" className="flex flex-col gap-2 type-body-m text-on-surface-variant">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  )
}

// Phones get narrower cell padding and wrapping column headers, so the tables fit at 320px.
const HEAD = "px-2 whitespace-normal sm:px-3"
const ROW_HEAD = "px-2 font-normal sm:px-3"
const CELL = "px-2 whitespace-normal sm:px-3"

function WeeklyTable({ weeks }: { weeks: WeekPoint[] }) {
  return (
    <ScrollRegion label="How often you were correct, by week">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className={HEAD}>Week of</TableHead>
            <TableHead scope="col" className={cn(HEAD, "text-right")}>Sure</TableHead>
            <TableHead scope="col" className={cn(HEAD, "text-right")}>Unsure</TableHead>
            <TableHead scope="col" className={cn(HEAD, "text-right")}>Guessing</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {weeks.map((week) => (
            <TableRow key={week.weekKey}>
              <TableHead scope="row" className={ROW_HEAD}>{week.label}</TableHead>
              <TableCell className={cn(CELL, "text-right tabular-nums")}>{rateText(week.sure)}</TableCell>
              <TableCell className={cn(CELL, "text-right tabular-nums")}>{rateText(week.unsure)}</TableCell>
              <TableCell className={cn(CELL, "text-right tabular-nums")}>{rateText(week.guessing)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollRegion>
  )
}

function CalibrationCard({ calibration, unrated }: { calibration: Calibration; unrated: number }) {
  const showTrend = calibration.weeks.length >= 2
  return (
    // 16px padding on phones (24px from 600px) leaves the tables room at 320px.
    <Card className="[--card-spacing:--spacing(4)] sm:[--card-spacing:--spacing(6)]">
      <CardContent className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <h3 className="type-title-s text-on-surface">All rated questions, last 12 weeks</h3>
          <ScrollRegion label="Rated questions by how sure you were">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col" className={HEAD}>How sure</TableHead>
                  <TableHead scope="col" className={cn(HEAD, "text-right")}>Questions</TableHead>
                  <TableHead scope="col" className={cn(HEAD, "text-right")}>Correct</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calibration.levels.map((level) => (
                  <TableRow key={level.level}>
                    <TableHead scope="row" className={ROW_HEAD}>
                      {CONFIDENCE_LABELS[level.level]}
                    </TableHead>
                    <TableCell className={cn(CELL, "text-right tabular-nums")}>{formatNumber(level.answers)}</TableCell>
                    <TableCell className={cn(CELL, "sm:w-36")}>
                      <div className="flex items-center justify-end gap-3">
                        {/* The bar repeats the percent, so phones show the number alone and the table fits */}
                        {level.rate !== null ? (
                          <span className="hidden w-16 sm:block">
                            <ProgressLinear
                              value={level.rate * 100}
                              label={`Correct when ${CONFIDENCE_LABELS[level.level]}`}
                              valueText={formatPercent(level.rate)}
                            />
                          </span>
                        ) : null}
                        <span className="min-w-10 text-right tabular-nums">{rateText(level.rate)}</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollRegion>
          <Findings calibration={calibration} unrated={unrated} />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <h3 className="type-title-s text-on-surface">How often you were correct, by week</h3>
          {showTrend ? (
            <>
              <CalibrationChartLazy weeks={calibration.weeks} />
              <Disclosure showLabel="Show the weeks as a table" hideLabel="Hide the table">
                <WeeklyTable weeks={calibration.weeks} />
              </Disclosure>
            </>
          ) : (
            <p className="type-body-m text-on-surface-variant">
              The weekly trend appears once you have rated questions from 2 different weeks.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export async function ConfidenceSection({ userId }: { userId: string }) {
  const data = await loadSafely("progress.confidence_failed", userId, async () => {
    const [answers, timeZone] = await Promise.all([loadRatedAnswers(userId), loadTimeZone(userId)])
    return { calibration: calibrate(answers.rated, timeZone), unrated: answers.unrated }
  })

  let content: React.ReactNode
  if (!data) {
    content = <SectionError title="Confidence didn't load." />
  } else if (data.calibration.rated === 0) {
    content = (
      <EmptyState
        icon={GaugeIcon}
        title="No rated questions yet"
        description="Before you check an answer, rate how sure you are. This section compares that with how often you're correct."
        bordered
      />
    )
  } else {
    content = <CalibrationCard calibration={data.calibration} unrated={data.unrated} />
  }

  return (
    <section aria-labelledby={HEADING_ID} className="flex flex-col gap-3">
      <SectionHeader
        id={HEADING_ID}
        title="Confidence"
        description="How sure you were before checking each answer, against how often you were correct. Partly correct answers don't count as correct."
      />
      {content}
    </section>
  )
}
