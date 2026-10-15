import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleIcon,
  CirclePlayIcon,
  CircleSlashIcon,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { formatNumber, plural } from "@/lib/format"
import type { PlanItemCounts } from "@/lib/plan-status"
import { ProgressLinear } from "@/components/app/progress-linear"

interface Count {
  key: keyof PlanItemCounts
  icon: LucideIcon
  iconClass: string
  text: (n: number) => string
  /** Shown even at zero. */
  always?: boolean
}

const COUNTS: Count[] = [
  { key: "done", icon: CircleCheckIcon, iconClass: "text-tertiary", text: (n) => `${formatNumber(n)} done`, always: true },
  { key: "in_progress", icon: CirclePlayIcon, iconClass: "text-primary", text: (n) => `${formatNumber(n)} in progress` },
  { key: "missed", icon: CircleAlertIcon, iconClass: "text-warning", text: (n) => `${formatNumber(n)} missed` },
  { key: "scheduled", icon: CircleIcon, iconClass: "text-outline", text: (n) => `${formatNumber(n)} scheduled`, always: true },
  { key: "skipped", icon: CircleSlashIcon, iconClass: "text-on-surface-variant", text: (n) => `${formatNumber(n)} skipped` },
]

/** Plan progress: a linear bar for done sessions and the count of each state, in words. */
export function PlanProgress({ counts, className }: { counts: PlanItemCounts; className?: string }) {
  const value = counts.total > 0 ? (counts.done / counts.total) * 100 : 0
  const doneText = `${formatNumber(counts.done)} of ${plural(counts.total, { one: "# session", other: "# sessions" })} done`

  return (
    <section
      aria-labelledby="plan-progress"
      className={cn("flex flex-col gap-3 rounded-2xl bg-surface-container px-4 py-4 sm:px-5", className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id="plan-progress" className="type-title-s text-on-surface">
          Progress
        </h3>
        <p className="type-body-m text-on-surface-variant tabular-nums">{doneText}</p>
      </div>
      <ProgressLinear value={value} label="Plan progress" valueText={doneText} tone="tertiary" />
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
        {COUNTS.filter((c) => c.always || counts[c.key] > 0).map((c) => {
          const Icon = c.icon
          return (
            <li key={c.key} className="flex items-center gap-1.5 type-body-m text-on-surface tabular-nums">
              <Icon className={cn("size-4 shrink-0", c.iconClass)} aria-hidden="true" />
              {c.text(counts[c.key])}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
