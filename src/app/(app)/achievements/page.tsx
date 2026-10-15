import { Suspense } from "react"

import { PageContainer } from "@/components/app/page-container"
import { AchievementsSection } from "@/components/progress/achievements-section"
import { ActivitySection } from "@/components/progress/activity-section"
import { ConfidenceSection } from "@/components/progress/confidence-section"
import { MasterySection } from "@/components/progress/mastery-section"
import { BlockSkeleton, MasterySkeleton, ProgressSkeleton } from "@/components/progress/progress-skeleton"
import { StreakXpSection } from "@/components/progress/streak-xp-section"
import {
  loadGameState,
  loadMastery,
  loadPlans,
  loadRatedAnswers,
  loadTimeZone,
  loadYearOfActivity,
  requireUserId,
} from "@/components/progress/study-data"

/**
 * Progress: mastery by topic, confidence against results, streak and XP,
 * activity by day, and achievements. Read-only; nothing here awards XP.
 */
export default function ProgressPage() {
  return (
    <PageContainer>
      <Suspense fallback={<ProgressSkeleton />}>
        <Progress />
      </Suspense>
    </PageContainer>
  )
}

async function Progress() {
  const userId = await requireUserId("/achievements")

  // Start every query now; sections await the cached results.
  const ignore = () => {}
  loadPlans(userId).catch(ignore)
  loadMastery(userId).catch(ignore)
  loadGameState(userId).catch(ignore)
  loadRatedAnswers(userId).catch(ignore)
  loadTimeZone(userId)
    .then((timeZone) => loadYearOfActivity(userId, timeZone))
    .catch(ignore)

  const now = new Date()
  return (
    <div className="flex flex-col gap-10">
      <Suspense fallback={<MasterySkeleton />}>
        <MasterySection userId={userId} now={now} />
      </Suspense>
      <Suspense fallback={<BlockSkeleton lines={5} />}>
        <ConfidenceSection userId={userId} />
      </Suspense>
      <Suspense fallback={<BlockSkeleton lines={3} double />}>
        <StreakXpSection userId={userId} />
      </Suspense>
      <Suspense fallback={<BlockSkeleton lines={4} />}>
        <ActivitySection userId={userId} />
      </Suspense>
      <Suspense fallback={<BlockSkeleton lines={4} />}>
        <AchievementsSection userId={userId} />
      </Suspense>
    </div>
  )
}
