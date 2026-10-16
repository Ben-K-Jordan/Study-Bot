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

  // Four across when the space it sits in fits "Reviewing" in each column,
  // else two by two (a narrow phone). Capped in width so the numbers stay
  // together on a full-width deck card.
  return (
    <div className={cn("@container", className)}>
      <dl className="grid max-w-lg grid-cols-2 gap-x-4 gap-y-2 @min-[20rem]:grid-cols-4">
        {ITEMS.map((item) => (
          <div key={item.key} className="flex min-w-0 flex-col-reverse gap-0.5">
            <dt className="type-label-m text-on-surface-variant">{item.label}</dt>
            <dd className="type-title-l text-on-surface tabular-nums">{formatNumber(counts[item.key])}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
