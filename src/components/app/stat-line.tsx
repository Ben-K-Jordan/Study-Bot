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
 * stays secondary to the work. Separators are decorative.
 */
export function StatLine({ items, className }: { items: readonly StatItem[]; className?: string }) {
  return (
    <ul
      data-slot="stat-line"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 type-body-m text-on-surface-variant",
        className
      )}
    >
      {items.map((item, index) => {
        const Icon = item.icon
        return (
          <li key={index} className="flex items-center gap-3">
            {index > 0 ? (
              <span aria-hidden="true" className="text-outline">
                ·
              </span>
            ) : null}
            <span className="flex items-center gap-1.5">
              {Icon ? <Icon className="size-4 shrink-0" aria-hidden="true" /> : null}
              <span className="tabular-nums text-on-surface">{item.value}</span>
              {item.label ? <span>{item.label}</span> : null}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
