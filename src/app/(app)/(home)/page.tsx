import { Suspense } from "react"

import { PageContainer } from "@/components/app/page-container"
import { ExamsSection } from "@/components/home/exams-section"
import { FirstRun } from "@/components/home/first-run"
import {
  ExamsSkeleton,
  HomeSkeleton,
  StatsSkeleton,
  TodaySkeleton,
  WeakSpotsSkeleton,
} from "@/components/home/home-skeleton"
import { HomeStats } from "@/components/home/stats-line"
import { TodaySection } from "@/components/home/today-section"
import { WeakSpotsSection } from "@/components/home/weak-spots-section"
import {
  loadGameState,
  loadMastery,
  loadMaterialCount,
  loadPlans,
  loadSafely,
  loadTimeZone,
  loadUnresolvedErrors,
  requireUserId,
} from "@/services/progress-data"

/**
 * Home: exam countdowns first, then weak spots beside today's session, then
 * one quiet line of stats. Server-rendered from the services layer; each
 * section streams and fails on its own.
 */
export default function HomePage() {
  return (
    <PageContainer>
      <Suspense fallback={<HomeSkeleton />}>
        <Home />
      </Suspense>
    </PageContainer>
  )
}

async function Home() {
  const userId = await requireUserId("/")

  // Start every query now; sections await the cached results.
  const ignore = () => {}
  loadTimeZone(userId).catch(ignore)
  loadGameState(userId).catch(ignore)
  loadUnresolvedErrors(userId).catch(ignore)
  loadMastery(userId).catch(ignore)

  const firstRun = await loadSafely("home.first_run_check_failed", userId, async () => {
    const [plans, materials] = await Promise.all([loadPlans(userId), loadMaterialCount(userId)])
    return plans.length === 0 && materials === 0
  })
  if (firstRun) return <FirstRun />

  const now = new Date()
  return (
    <div className="flex flex-col gap-8">
      <Suspense fallback={<ExamsSkeleton />}>
        <ExamsSection userId={userId} now={now} />
      </Suspense>

      {/* Today comes first in reading order so phones reach it before weak spots;
          from 840px it sits on the right, as the direction contract draws it, so
          laptop widths don't stretch one session card across the page. */}
      <div className="grid gap-8 md:grid-cols-[3fr_2fr] md:gap-6">
        <div className="min-w-0 md:col-start-2 md:row-start-1">
          <Suspense fallback={<TodaySkeleton />}>
            <TodaySection userId={userId} now={now} />
          </Suspense>
        </div>
        <div className="min-w-0 md:col-start-1 md:row-start-1">
          <Suspense fallback={<WeakSpotsSkeleton />}>
            <WeakSpotsSection userId={userId} now={now} />
          </Suspense>
        </div>
      </div>

      <Suspense fallback={<StatsSkeleton />}>
        <HomeStats userId={userId} />
      </Suspense>
    </div>
  )
}
