import Link from "next/link"
import { ChevronRightIcon } from "lucide-react"

import { StatLine } from "@/components/app/stat-line"
import { Button } from "@/components/ui/button"
import { statItems } from "@/components/home/stat-items"
import { SectionError } from "@/components/progress/section-error"
import { loadGameState, loadLastSevenDays, loadSafely, loadTimeZone } from "@/services/progress-data"

/** Streak, accuracy and time: one quiet line under the work. */
export async function HomeStats({ userId }: { userId: string }) {
  const items = await loadSafely("home.stats_failed", userId, async () => {
    const timeZone = await loadTimeZone(userId)
    const [game, week] = await Promise.all([loadGameState(userId), loadLastSevenDays(userId, timeZone)])
    return statItems(game.streak, week)
  })
  if (!items) return <SectionError title="Your streak and accuracy didn't load." />

  return (
    <section aria-label="Study stats" className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
      <StatLine items={items} />
      <Button asChild variant="text" size="sm" className="-ml-3 sm:ml-0 sm:-mr-3">
        <Link href="/achievements">
          See progress
          <ChevronRightIcon data-icon="inline-end" aria-hidden="true" />
        </Link>
      </Button>
    </section>
  )
}
