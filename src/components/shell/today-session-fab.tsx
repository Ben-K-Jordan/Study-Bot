import "server-only"

import { cache } from "react"

import { getCurrentUserId } from "@/lib/auth"
import { todayPlan } from "@/components/home/home-model"
import { SessionFab, type SessionFabProps } from "@/components/shell/session-fab"
import { loadPlans, loadSafely, loadTimeZone } from "@/services/progress-data"

/**
 * The session the shell's Start button opens: the first open session today
 * (or one left under way on an earlier day), the same one Home's Today card
 * offers. Null when nothing is scheduled today or the read fails. Cached
 * per request: the rail and the floating button share one read.
 */
const loadTodaySession = cache(async (): Promise<{ sessionId: string; resume: boolean } | null> => {
  const userId = await getCurrentUserId()
  if (!userId) return null
  return loadSafely("shell.today_session_failed", userId, async () => {
    const [plans, timeZone] = await Promise.all([loadPlans(userId), loadTimeZone(userId)])
    const { current } = todayPlan(plans, timeZone, new Date())
    return current ? { sessionId: current.sessionId, resume: current.status === "IN_PROGRESS" } : null
  })
})

/**
 * Server half of SessionFab: renders nothing until today's session is known,
 * and nothing at all when there is none. Wrap it in <Suspense fallback={null}>
 * so the shell never waits for it.
 */
export async function TodaySessionFab({ placement }: { placement: SessionFabProps["placement"] }) {
  const today = await loadTodaySession()
  if (!today) return null
  return (
    <SessionFab href={`/s/${encodeURIComponent(today.sessionId)}`} resume={today.resume} placement={placement} />
  )
}
