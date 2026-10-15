import { redirect } from "next/navigation"

import { getCurrentUserId } from "@/lib/auth"
import { logger } from "@/lib/logger"
import { PageContainer } from "@/components/app/page-container"
import { PageHeader } from "@/components/app/page-header"
import { AppBarTitle } from "@/components/shell/app-bar-title"
import { NewPlanForm } from "@/components/plan/new-plan-form"
import { PlanLoadError } from "@/components/plan/plan-load-error"
import { PlanWorkspace } from "@/components/plan/plan-workspace"
import { keyOf, sortPlans } from "@/components/plan/plan-model"
import { loadNewPlanDefaults } from "../_lib/load"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function param(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : undefined
}

/**
 * /plan/new[?replace={planId}][?course=&exam=]
 *
 * The New plan form. ?replace fills in that plan's course, exam and date
 * (creating it then replaces that plan, after asking); ?course and ?exam
 * prefill the fields from other screens.
 */
export default async function NewPlanPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const userId = await getCurrentUserId()
  if (!userId) redirect("/auth/signin?callbackUrl=%2Fplan%2Fnew")

  let data: Awaited<ReturnType<typeof loadNewPlanDefaults>>
  try {
    data = await loadNewPlanDefaults(userId)
  } catch (error) {
    logger.error("new_plan_page.load_failed", { user_id: userId, error: String(error) })
    return (
      <PageContainer size="wide">
        <AppBarTitle>New plan</AppBarTitle>
        <PlanLoadError
          title="The New plan form didn't load."
          description="Your existing plans are safe. Retry, or check your connection."
        />
      </PageContainer>
    )
  }

  const plans = sortPlans(data.plans, { timeZone: data.timeZone })
  const replaceId = param(params.replace)
  const replacing = replaceId ? plans.find((p) => p.plan_id === replaceId) : undefined
  const initial = replacing
    ? { course: replacing.course_name, exam: replacing.exam_name, examDate: replacing.exam_date }
    : { course: param(params.course), exam: param(params.exam) }

  return (
    <PlanWorkspace plans={plans} section="new" timeZone={data.timeZone}>
      <AppBarTitle>New plan</AppBarTitle>
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <PageHeader
          title={replacing ? `Replace the ${replacing.course_name} ${replacing.exam_name} plan` : "Plan for an exam"}
          description={
            replacing
              ? "Creating this plan replaces the current one once it's ready. Change the course or exam to make a separate plan instead."
              : "Study Bot schedules practice sessions from your course files, from today up to the exam."
          }
        />
        <NewPlanForm
          todayKey={keyOf(new Date(), data.timeZone)}
          defaults={{ studyStart: data.studyStart, studyEnd: data.studyEnd, dailyCap: data.dailyCap }}
          plans={plans}
          materials={data.materials}
          initial={initial}
        />
      </div>
    </PlanWorkspace>
  )
}
