"use client"

import { CartesianGrid, Line, LineChart, usePlotArea, useXAxisScale, useYAxisScale, XAxis, YAxis } from "recharts"

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { formatPercent } from "@/lib/format"

export interface CalibrationWeek {
  label: string
  sure: number | null
  unsure: number | null
  guessing: number | null
}

// Light uses the GM3 chart roles. Dark uses steps checked with the dataviz
// palette validator against the dark card surface (the --chart-* dark roles
// sit above its lightness band).
const config = {
  sure: { label: "Sure", theme: { light: "var(--chart-1)", dark: "#5b8def" } },
  unsure: { label: "Unsure", theme: { light: "var(--chart-3)", dark: "#d56e0c" } },
  guessing: { label: "Guessing", theme: { light: "var(--chart-5)", dark: "#a259f2" } },
} satisfies ChartConfig

const SERIES = ["sure", "unsure", "guessing"] as const

/** Room right of the plot for the line labels ("Guessing" at 12px plus the gap). */
const LABEL_ROOM = 76
/** Labels closer than this (px, one line of 12px text) are pushed apart. */
const LABEL_GAP = 14

/**
 * Names each line beside its last point, in place of a legend, so the reader
 * doesn't match colors to a key. Labels that would overlap are spread apart
 * and kept inside the plot's height.
 */
function LineLabels({ weeks }: { weeks: CalibrationWeek[] }) {
  const xScale = useXAxisScale()
  const yScale = useYAxisScale()
  const plot = usePlotArea()
  if (!xScale || !yScale || !plot) return null

  const labels = SERIES.flatMap((key) => {
    for (let i = weeks.length - 1; i >= 0; i--) {
      const value = weeks[i][key]
      if (value === null) continue
      const x = xScale(weeks[i].label)
      const y = yScale(value)
      return typeof x === "number" && typeof y === "number" ? [{ key, x, y }] : []
    }
    return []
  })

  // Spread labels that end at the same week, top to bottom, then pull the
  // group back up if it ran past the bottom of the plot.
  const placed: typeof labels = []
  for (const x of new Set(labels.map((l) => l.x))) {
    const group = labels.filter((l) => l.x === x).sort((a, b) => a.y - b.y)
    for (let i = 1; i < group.length; i++) {
      group[i] = { ...group[i], y: Math.max(group[i].y, group[i - 1].y + LABEL_GAP) }
    }
    const overflow = group.length > 0 ? group[group.length - 1].y - (plot.y + plot.height) : 0
    placed.push(...group.map((l) => (overflow > 0 ? { ...l, y: l.y - overflow } : l)))
  }

  return (
    <g aria-hidden="true">
      {placed.map((label) => (
        <text
          key={label.key}
          x={label.x + 10}
          y={label.y}
          dominantBaseline="central"
          className="fill-on-surface type-label-m"
        >
          {config[label.key].label}
        </text>
      ))}
    </g>
  )
}

/** Share right per week for each confidence level. Decorative for screen readers; the table carries the data. */
export default function CalibrationChart({ weeks }: { weeks: CalibrationWeek[] }) {
  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full" aria-hidden="true">
      <LineChart
        data={weeks}
        margin={{ top: 8, right: LABEL_ROOM, bottom: 0, left: 0 }}
        accessibilityLayer={false}
      >
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis
          domain={[0, 1]}
          ticks={[0, 0.25, 0.5, 0.75, 1]}
          tickFormatter={(v: number) => formatPercent(v)}
          tickLine={false}
          axisLine={false}
          width={44}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(label) => `Week of ${label}`}
              formatter={(value, name) => (
                <span className="flex w-full justify-between gap-4">
                  <span className="text-muted-foreground">
                    {config[name as keyof typeof config]?.label ?? name}
                  </span>
                  <span className="tabular-nums text-foreground">{formatPercent(Number(value))} correct</span>
                </span>
              )}
            />
          }
        />
        {SERIES.map((key) => (
          <Line
            key={key}
            dataKey={key}
            type="linear"
            stroke={`var(--color-${key})`}
            strokeWidth={2}
            dot={{ r: 4, strokeWidth: 2, fill: "var(--card)" }}
            activeDot={{ r: 5 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
        <LineLabels weeks={weeks} />
      </LineChart>
    </ChartContainer>
  )
}
