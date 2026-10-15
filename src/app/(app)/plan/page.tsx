import Link from "next/link"
import { redirect } from "next/navigation"
import { CalendarDaysIcon, CircleAlertIcon, PlusIcon } from "lucide-react"

import { getCurrentUserId } from "@/lib/auth"
import { logger } from "@/lib/logger"
import { EmptyState } from "@/components/app/empty-state"
import { PageContainer } from "@/components/app/page-container"
import { PageHeader } from "@/components/app/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { CalendarNotice, PlanActionsProvider, PlanToolbar } from "@/components/plan/plan-actions"
import { PlanAgenda } from "@/components/plan/plan-agenda"
import { PlanLoadError } from "@/components/plan/plan-load-error"
import { PlanMaterials } from "@/components/plan/plan-materials"
import { canReschedule, examCountdown, formatDayKey, keyOf, planName } from "@/components/plan/plan-model"
import { PlanProgress } from "@/components/plan/plan-progress"
import { PlanWorkspace } from "@/components/plan/plan-workspace"
import { loadPlanPage, type PlanPageData } from "./_lib/load"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/**
 * /plan[?plan={planId}][&reschedule=1]
 *
 * The selected plan (default: the soonest upcoming exam) as dated days, with
 * its progress, Google Calendar status, actions and materials. Read on the
 * server through the services layer; the interactive parts are client
 * islands that refresh this page after they change something.
 */
export default async function PlanPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const requested = typeof params.plan === "string" && params.plan.trim() ? params.plan.trim() : undefined

  const userId = await getCurrentUserId()
  if (!userId) redirect("/auth/signin?callbackUrl=%2Fplan")

  let data: PlanPageData
  try {
    data = await loadPlanPage(userId, requested)
  } catch (error) {
    logger.error("plan_page.load_failed", { user_id: userId, error: String(error) })
    return (
      <PageContainer size="wide">
        <PlanLoadError
          title="Plans didn't load."
          description="Your plans and sessions are safe. Retry, or check your connection."
        />
      </PageContainer>
    )
  }

  if (data.kind === "empty") {
    return (
      <PlanWorkspace plans={[]} section="plan" timeZone={data.timeZone}>
        <EmptyState
          icon={CalendarDaysIcon}
          headingLevel="h2"
          title="No plan yet"
          description="A plan schedules practice sessions from your course files up to your exam date."
          action={
            <Button asChild>
              <Link href="/plan/new">
                <PlusIcon data-icon="inline-start" aria-hidden="true" />
                New plan
              </Link>
            </Button>
          }
          bordered
        />
      </PlanWorkspace>
    )
  }

  if (data.kind === "missing") {
    return (
      <PlanWorkspace plans={data.plans} section="plan" timeZone={data.timeZone}>
        <Alert variant="warning">
          <CircleAlertIcon aria-hidden="true" />
          <AlertTitle>This plan doesn&apos;t exist anymore.</AlertTitle>
          <AlertDescription>
            It may have been deleted or replaced.
            <div className="mt-2">
              <Button asChild size="sm" variant="outline">
                <Link href="/plan">Go to your plans</Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </PlanWorkspace>
    )
  }

  const { view, timeZone, plans, calendar, materials } = data
  const now = new Date()
  const todayKey = keyOf(now, timeZone)
  const reschedulable = canReschedule(view, timeZone, now)
  const upcoming = view.counts.scheduled + view.counts.missed + view.counts.in_progress

  return (
    <PlanWorkspace plans={plans} selectedPlanId={view.plan_id} section="plan" timeZone={timeZone}>
      <PlanActionsProvider
        planId={view.plan_id}
        examName={view.exam_name}
        timeZone={timeZone}
        canReschedule={reschedulable}
        items={view.items.map((item) => ({ id: item.id, mode: item.mode, topics: item.topics, state: item.state }))}
        calendar={calendar}
      >
        <PageHeader
          title={planName(view)}
          description={`${examCountdown(view.exam_name, view.exam_date, todayKey)}: ${formatDayKey(view.exam_date)}.`}
          actions={
            <PlanToolbar courseName={view.course_name} upcomingCount={upcoming} totalSessions={view.items.length} />
          }
        />
        <CalendarNotice />
        <PlanProgress counts={view.counts} />
        <PlanAgenda view={view} timeZone={timeZone} canReschedule={reschedulable} now={now} />
        <PlanMaterials courseName={view.course_name} materials={materials} />
      </PlanActionsProvider>
    </PlanWorkspace>
  )
}
