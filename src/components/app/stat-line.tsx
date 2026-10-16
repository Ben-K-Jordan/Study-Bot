import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export interface StatItem {
  /** The figure with its unit, already formatted: "12-day streak", "83%". */
  value: React.ReactNode
  /** What the figure measures, read after it: "accuracy". Omit when value says it all. */
  label?: string
  icon?: LucideIcon
}

/**
 * The quiet stats row (streak, accuracy, XP): one line of small text that
 * stays secondary to the work. Separators are decorative. Every item carries
 * its separator in front, and the list is shifted left by one separator
 * inside a clipping box, so a line that wraps never starts with a dot.
 */
export function StatLine({ items, className }: { items: readonly StatItem[]; className?: string }) {
  return (
    <div data-slot="stat-line" className={cn("overflow-x-clip", className)}>
      <ul className="-ml-6 flex flex-wrap items-center gap-y-1 type-body-m text-on-surface-variant">
        {items.map((item, index) => {
          const Icon = item.icon
          return (
            <li key={index} className="flex items-center">
              <span aria-hidden="true" className="w-6 shrink-0 text-center text-outline">
                ·
              </span>
              <span className="flex items-center gap-1.5">
                {Icon ? <Icon className="size-4 shrink-0" aria-hidden="true" /> : null}
                <span className="tabular-nums text-on-surface">{item.value}</span>
                {item.label ? <span>{item.label}</span> : null}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
