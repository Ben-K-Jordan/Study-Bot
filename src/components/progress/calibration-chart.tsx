"use client"

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
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

/** Share right per week for each confidence level. Decorative for screen readers; the table carries the data. */
export default function CalibrationChart({ weeks }: { weeks: CalibrationWeek[] }) {
  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full" aria-hidden="true">
      <LineChart data={weeks} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} accessibilityLayer={false}>
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
                  <span className="tabular-nums text-foreground">{formatPercent(Number(value))} right</span>
                </span>
              )}
            />
          }
        />
        <ChartLegend
          content={<ChartLegendContent />}
          itemSorter={(item) => SERIES.indexOf(item.dataKey as (typeof SERIES)[number])}
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
      </LineChart>
    </ChartContainer>
  )
}
