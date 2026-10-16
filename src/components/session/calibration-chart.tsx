"use client";

import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";

import { formatNumber, formatPercent, plural } from "@/lib/format";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { LevelSummary } from "./calibration";

const chartConfig = {
  correctRate: { label: "How often correct", color: "var(--lesson-primary)" },
} satisfies ChartConfig;

interface Row {
  label: string;
  tick: string;
  correctRate: number | null;
  count: number;
  correct: number;
}

/**
 * How often each confidence level was right: one bar per level, so a
 * student can see whether Sure answers were right more often than guesses.
 * Hidden from assistive tech: the screen-reader list in the same figure
 * carries the same values.
 * Loaded with next/dynamic (recharts is heavy).
 */
export default function CalibrationChart({ levels }: { levels: readonly LevelSummary[] }) {
  const data: Row[] = levels.map((level) => ({
    label: level.label,
    tick: `${level.label} (${level.count})`,
    correctRate: level.correctRate,
    count: level.count,
    correct: level.correct,
  }));

  return (
    <div aria-hidden="true">
      <ChartContainer config={chartConfig} className="aspect-auto h-52 w-full">
        <BarChart data={data} margin={{ top: 24, right: 8, bottom: 0, left: 0 }} accessibilityLayer={false}>
          <CartesianGrid vertical={false} stroke="var(--lesson-option-border)" strokeDasharray="0" />
          <XAxis
            dataKey="tick"
            interval={0}
            tickLine={false}
            axisLine={false}
            tickMargin={10}
            tick={{ fill: "var(--lesson-muted)", fontSize: 13 }}
          />
          <YAxis
            domain={[0, 1]}
            ticks={[0, 0.5, 1]}
            tickFormatter={(value: number) => formatPercent(value)}
            tickLine={false}
            axisLine={false}
            width={44}
            tick={{ fill: "var(--lesson-muted)", fontSize: 12 }}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                hideIndicator
                formatter={(_value, _name, item) => {
                  const row = item.payload as Row;
                  return (
                    <span className="text-foreground">
                      {row.count === 0
                        ? "Not used"
                        : plural(row.count, {
                            one: `${formatNumber(row.correct)} of # answer correct`,
                            other: `${formatNumber(row.correct)} of # answers correct`,
                          })}
                    </span>
                  );
                }}
              />
            }
          />
          <Bar
            dataKey="correctRate"
            fill="var(--color-correctRate)"
            radius={[4, 4, 0, 0]}
            maxBarSize={24}
            // A level that was used but never right still gets a stub and its 0% label.
            minPointSize={(value) => (value === 0 ? 3 : 0)}
          >
            <LabelList
              dataKey="correctRate"
              position="top"
              offset={8}
              className="fill-lesson-on-surface"
              fontSize={13}
              formatter={(value: unknown) => (typeof value === "number" ? formatPercent(value) : "")}
            />
          </Bar>
        </BarChart>
      </ChartContainer>
    </div>
  );
}
