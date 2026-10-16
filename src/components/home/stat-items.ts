import { ClockIcon, FlameIcon, TargetIcon } from "lucide-react"

import type { StatItem } from "@/components/app/stat-line"
import type { WeekTotals } from "@/services/progress-data"
import { formatDuration, formatPercent, plural } from "@/lib/format"

/** Home's quiet stats row: streak, accuracy and time over the last 7 days. */
export function statItems(streak: number, week: WeekTotals): StatItem[] {
  const items: StatItem[] = [
    {
      value: plural(streak, { zero: "No current streak", one: "#-day streak", other: "#-day streak" }),
      icon: FlameIcon,
    },
  ]
  if (week.answers > 0) {
    items.push({
      value: formatPercent(week.correct / week.answers),
      label: "accuracy, last 7 days",
      icon: TargetIcon,
    })
  } else {
    items.push({ value: "No answers in the last 7 days", icon: TargetIcon })
  }
  if (week.answeringSeconds > 0) {
    items.push({
      value: formatDuration(week.answeringSeconds / 60),
      label: "answering questions, last 7 days",
      icon: ClockIcon,
    })
  } else if (week.sessions > 0) {
    // Older sessions have no answer timers: report what is known, labelled as such.
    items.push({
      value: formatDuration(week.plannedMinutes),
      label: "of completed sessions, last 7 days",
      icon: ClockIcon,
    })
  }
  return items
}
