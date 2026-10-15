import { cn } from "@/lib/utils"
import { formatNumber } from "@/lib/format"
import type { StudyStats } from "@/services/spaced-repetition"

const ITEMS: { key: keyof Omit<StudyStats, "dueCount">; label: string }[] = [
  { key: "newCount", label: "New" },
  { key: "learningCount", label: "Learning" },
  { key: "reviewCount", label: "Reviewing" },
  { key: "masteredCount", label: "Mastered" },
]

/**
 * A deck's cards by status: New, Learning, Reviewing, Mastered. The label
 * comes first in the markup (dt, dd) and the number first on screen.
 */
export function DeckCounts({
  counts,
  className,
  size = "default",
}: {
  counts: StudyStats
  className?: string
  /** "compact" is one line of text, for the review's top bar. */
  size?: "default" | "compact"
}) {
  if (size === "compact") {
    return (
      <dl className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 type-label-m tabular-nums", className)}>
        {ITEMS.map((item) => (
          <div key={item.key} className="flex items-baseline gap-1">
            <dt>{item.label}</dt>
            <dd className="font-bold">{formatNumber(counts[item.key])}</dd>
          </div>
        ))}
      </dl>
    )
  }

  return (
    <dl className={cn("grid grid-cols-4 gap-2", className)}>
      {ITEMS.map((item) => (
        <div key={item.key} className="flex min-w-0 flex-col-reverse gap-0.5">
          <dt className="truncate type-label-m text-on-surface-variant">{item.label}</dt>
          <dd className="type-title-l text-on-surface tabular-nums">{formatNumber(counts[item.key])}</dd>
        </div>
      ))}
    </dl>
  )
}
