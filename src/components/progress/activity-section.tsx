import { SectionHeader } from "@/components/app/section-header"
import { Card, CardContent } from "@/components/ui/card"
import { Disclosure } from "@/components/progress/disclosure"
import {
  buildHeatmap,
  dayLabel,
  describeDay,
  isStudyDay,
  type Heatmap,
  type HeatLevel,
} from "@/components/progress/progress-model"
import { ScrollRegion } from "@/components/progress/scroll-region"
import { ScrollToEnd } from "@/components/progress/scroll-to-end"
import { SectionError } from "@/components/progress/section-error"
import { loadSafely, loadTimeZone, loadYearOfActivity } from "@/services/progress-data"
import { cn } from "@/lib/utils"
import { plural } from "@/lib/format"

const HEADING_ID = "progress-activity"

// 53 week columns after a fixed column for the weekday names.
const COLUMNS = "grid-cols-[2rem_repeat(53,minmax(0.625rem,1rem))]"

const LEVEL_CLASS: Record<HeatLevel, string> = {
  0: "bg-surface-container-highest",
  1: "bg-primary/40",
  2: "bg-primary/60",
  3: "bg-primary/80",
  4: "bg-primary",
}

const WEEKDAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""]

function Swatch({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("size-3 rounded-[3px]", className)} />
}

function HeatmapGrid({ heatmap }: { heatmap: Heatmap }) {
  return (
    <div aria-hidden="true" className="flex w-max flex-col gap-1">
      <div className={cn("grid gap-[3px] type-label-s text-on-surface-variant", COLUMNS)}>
        {heatmap.months.map((month) => (
          <span
            key={`${month.label}-${month.column}`}
            className="col-span-3 row-start-1 whitespace-nowrap"
            // Column 1 holds the weekday names; weeks start at column 2.
            style={{ gridColumnStart: month.column + 2 }}
          >
            {month.label}
          </span>
        ))}
      </div>
      <div className={cn("grid grid-flow-col grid-rows-7 gap-[3px]", COLUMNS)}>
        {WEEKDAY_LABELS.map((label, i) => (
          <span key={`weekday-${i}`} className="self-center pr-1 type-label-s leading-none text-on-surface-variant">
            {label}
          </span>
        ))}
        {heatmap.columns.flatMap((column, c) =>
          column.map((cell, r) =>
            cell ? (
              <span
                key={cell.key}
                title={cell.label}
                className={cn(
                  "aspect-square rounded-[3px]",
                  LEVEL_CLASS[cell.level],
                  cell.freeze && "ring-2 ring-tertiary ring-inset"
                )}
              />
            ) : (
              <span key={`pad-${c}-${r}`} />
            )
          )
        )}
      </div>
    </div>
  )
}

function ActivityCard({
  heatmap,
  activeList,
}: {
  heatmap: Heatmap
  activeList: { key: string; text: string }[]
}) {
  const hasFreeze = heatmap.columns.some((col) => col.some((cell) => cell?.freeze))
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <p className="type-body-m text-on-surface">
          {plural(heatmap.activeDays, {
            zero: "No study days in the last 12 months.",
            one: "Active on # day in the last 12 months.",
            other: "Active on # days in the last 12 months.",
          })}{" "}
          {heatmap.longestStreak > 1
            ? plural(heatmap.longestStreak, { one: "Longest streak: # day.", other: "Longest streak: # days." })
            : null}
        </p>

        <ScrollToEnd label="Activity heatmap, last 12 months">
          <HeatmapGrid heatmap={heatmap} />
        </ScrollToEnd>

        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 type-label-m text-on-surface-variant">
          <p>
            Each square is a day. The stronger the color, the more XP you earned that day.
            {activeList.length > 0
              ? " To see what a day held, hover its square or show the study days as a list."
              : null}
          </p>
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <span>Less</span>
            {([0, 1, 2, 3, 4] as const).map((level) => (
              <Swatch key={level} className={LEVEL_CLASS[level]} />
            ))}
            <span>More</span>
            {hasFreeze ? (
              <>
                <Swatch className="ml-3 bg-surface-container-highest ring-2 ring-tertiary ring-inset" />
                <span>Freeze</span>
              </>
            ) : null}
          </div>
        </div>

        {activeList.length > 0 ? (
          <Disclosure showLabel="Show study days as a list" hideLabel="Hide the list">
            <ScrollRegion label="Study days, newest first" className="max-h-72">
              <ul role="list" className="flex flex-col gap-1 type-body-m text-on-surface">
                {activeList.map((day) => (
                  <li key={day.key} className="tabular-nums">
                    {day.text}
                  </li>
                ))}
              </ul>
            </ScrollRegion>
          </Disclosure>
        ) : null}
      </CardContent>
    </Card>
  )
}

export async function ActivitySection({ userId }: { userId: string }) {
  const data = await loadSafely("progress.activity_failed", userId, async () => {
    const timeZone = await loadTimeZone(userId)
    const { todayKey, days } = await loadYearOfActivity(userId, timeZone)
    const heatmap = buildHeatmap(days, todayKey)
    const activeList = [...days.entries()]
      .filter(([, d]) => isStudyDay(d) || d.freezeUsed)
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([key, d]) => ({
        key,
        text: `${dayLabel(key, todayKey)}: ${describeDay(d)}`,
      }))
    return { heatmap, activeList }
  })

  return (
    <section aria-labelledby={HEADING_ID} className="flex flex-col gap-3">
      <SectionHeader id={HEADING_ID} title="Activity" />
      {data ? (
        <ActivityCard heatmap={data.heatmap} activeList={data.activeList} />
      ) : (
        <SectionError title="Activity didn't load." />
      )}
    </section>
  )
}
