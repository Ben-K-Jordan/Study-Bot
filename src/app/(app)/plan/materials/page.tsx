import { redirect } from "next/navigation"

import { getCurrentUserId } from "@/lib/auth"
import { logger } from "@/lib/logger"
import { PageContainer } from "@/components/app/page-container"
import { MaterialsManager } from "@/components/materials/materials-manager"
import { PlanLoadError } from "@/components/plan/plan-load-error"
import { PlanWorkspace } from "@/components/plan/plan-workspace"
import { loadMaterials } from "../_lib/load"

/**
 * /plan/materials[?course={course name}]
 *
 * Every course file: upload (drag and drop or Choose files), status in
 * words, summary, Retry and Delete. Flashcards, Guides and Chat link here.
 */
export default async function MaterialsPage() {
  const userId = await getCurrentUserId()
  if (!userId) redirect("/auth/signin?callbackUrl=%2Fplan%2Fmaterials")

  let data: Awaited<ReturnType<typeof loadMaterials>>
  try {
    data = await loadMaterials(userId)
  } catch (error) {
    logger.error("materials_page.load_failed", { user_id: userId, error: String(error) })
    return (
      <PageContainer size="wide">
        <PlanLoadError title="Materials didn't load." description="Your files are safe. Retry, or check your connection." />
      </PageContainer>
    )
  }

  const knownCourses = [
    ...new Set([
      ...data.plans.map((p) => p.course_name),
      ...data.materials.flatMap((m) => (m.course_name ? [m.course_name] : [])),
    ]),
  ]

  return (
    <PlanWorkspace
      plans={data.plans}
      section="materials"
      timeZone={data.timeZone}
    >
      <MaterialsManager initialMaterials={data.materials} knownCourses={knownCourses} timeZone={data.timeZone} />
    </PlanWorkspace>
  )
}
