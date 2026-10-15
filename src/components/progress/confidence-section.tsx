import { GaugeIcon } from "lucide-react"

import { EmptyState } from "@/components/app/empty-state"
import { ProgressLinear } from "@/components/app/progress-linear"
import { SectionHeader } from "@/components/app/section-header"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { CalibrationChartLazy } from "@/components/progress/calibration-chart-lazy"
import { calibrate, CONFIDENCE_LABELS, type Calibration, type WeekPoint } from "@/components/progress/progress-model"
import { SectionError } from "@/components/progress/section-error"
import { loadRatedAnswers, loadSafely, loadTimeZone } from "@/components/progress/study-data"
import { formatNumber, formatPercent, plural } from "@/lib/format"

const HEADING_ID = "progress-confidence"

function rateText(rate: number | null): string {
  return rate === null ? "No answers" : formatPercent(rate)
}

function Findings({ calibration, unrated }: { calibration: Calibration; unrated: number }) {
  const lines: string[] = []
  if (calibration.ordered) lines.push("The surer you were, the more often you were right.")
  if (calibration.overconfident > 0) {
    lines.push(
      `${plural(calibration.overconfident, {
        one: "Overconfident on # answer: you marked it Sure and got it wrong.",
        other: "Overconfident on # answers: you marked them Sure and got them wrong.",
      })} Errors you marked Sure come first in Error repair.`
    )
  }
  if (calibration.underconfident > 0) {
    lines.push(
      plural(calibration.underconfident, {
        one: "Underconfident on # answer: you marked it Guessing and got it right.",
        other: "Underconfident on # answers: you marked them Guessing and got them right.",
      })
    )
  }
  if (unrated > 0) {
    lines.push(
      plural(unrated, {
        one: "# answer had no rating, so it isn't counted here.",
        other: "# answers had no rating, so they aren't counted here.",
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

function WeeklyTable({ weeks }: { weeks: WeekPoint[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Week of</TableHead>
          <TableHead scope="col" className="text-right">Sure</TableHead>
          <TableHead scope="col" className="text-right">Unsure</TableHead>
          <TableHead scope="col" className="text-right">Guessing</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {weeks.map((week) => (
          <TableRow key={week.weekKey}>
            <TableHead scope="row" className="font-normal">{week.label}</TableHead>
            <TableCell className="text-right tabular-nums">{rateText(week.sure)}</TableCell>
            <TableCell className="text-right tabular-nums">{rateText(week.unsure)}</TableCell>
            <TableCell className="text-right tabular-nums">{rateText(week.guessing)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function CalibrationCard({ calibration, unrated }: { calibration: Calibration; unrated: number }) {
  const showTrend = calibration.weeks.length >= 2
  return (
    <Card>
      <CardContent className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <h3 className="type-title-s text-on-surface">All rated answers, last 12 weeks</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">How sure you were</TableHead>
                <TableHead scope="col" className="text-right">Answers</TableHead>
                <TableHead scope="col" className="text-right">Right</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {calibration.levels.map((level) => (
                <TableRow key={level.level}>
                  <TableHead scope="row" className="font-normal">{CONFIDENCE_LABELS[level.level]}</TableHead>
                  <TableCell className="text-right tabular-nums">{formatNumber(level.answers)}</TableCell>
                  <TableCell className="sm:w-36">
                    <div className="flex items-center justify-end gap-3">
                      {/* The bar repeats the percent, so phones show the number alone and the table fits */}
                      {level.rate !== null ? (
                        <span className="hidden w-16 sm:block">
                          <ProgressLinear
                            value={level.rate * 100}
                            label={`Right when ${CONFIDENCE_LABELS[level.level]}`}
                            valueText={formatPercent(level.rate)}
                          />
                        </span>
                      ) : null}
                      <span className="w-10 text-right tabular-nums">{rateText(level.rate)}</span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Findings calibration={calibration} unrated={unrated} />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <h3 className="type-title-s text-on-surface">Right answers by week</h3>
          {showTrend ? (
            <>
              <CalibrationChartLazy weeks={calibration.weeks} />
              <details className="group rounded-xl bg-surface-container px-4 py-2">
                <summary className="cursor-pointer rounded-md py-1 type-label-l text-primary">
                  Show the weeks as a table
                </summary>
                <div className="pt-2">
                  <WeeklyTable weeks={calibration.weeks} />
                </div>
              </details>
            </>
          ) : (
            <p className="type-body-m text-on-surface-variant">
              The weekly trend appears once you have rated answers from 2 different weeks.
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
        title="No rated answers yet"
        description="Before you check an answer, rate how sure you are. This section compares that with how often you're right."
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
        description="How sure you were before checking each answer, against how often you were right. Partly correct answers count as not right."
      />
      {content}
    </section>
  )
}
