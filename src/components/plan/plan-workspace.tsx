import { PageContainer } from "@/components/app/page-container"
import { PlanNav } from "@/components/plan/plan-nav"
import type { PlanSummary } from "@/components/plan/plan-model"

/**
 * The Plan area's frame: its own navigation (New plan, plans, Materials)
 * beside or above the content, inside the standard page column.
 */
export function PlanWorkspace({
  plans,
  selectedPlanId,
  section,
  timeZone,
  children,
}: {
  plans: readonly Pick<PlanSummary, "plan_id" | "course_name" | "exam_name" | "exam_date">[]
  selectedPlanId?: string | null
  section: "plan" | "materials" | "new"
  timeZone: string
  children: React.ReactNode
}) {
  return (
    <PageContainer size="wide">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        <PlanNav plans={plans} selectedPlanId={selectedPlanId} section={section} timeZone={timeZone} />
        <div className="flex min-w-0 flex-1 flex-col gap-6">{children}</div>
      </div>
    </PageContainer>
  )
}
