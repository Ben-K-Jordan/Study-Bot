import { redirect } from "next/navigation"

import { getCurrentUserId } from "@/lib/auth"
import { logger } from "@/lib/logger"
import { listDocuments } from "@/services/content"
import { loadPlans, loadTimeZone } from "@/services/progress-data"
import { getStudyCourses } from "@/services/study-recommendations"
import { SwrFallback } from "@/components/chat/swr-fallback"
import { coursePreferences } from "@/components/study/course-preference"
import { StudyView } from "@/components/study/study-view"

const DOCUMENTS_KEY = "/api/content/documents?namespace=COURSE"
const LEARN_KEY = "/api/learn"

/**
 * Study (/learn). The course list and per-course counts are read here and
 * handed to the client cache, so at hydration only the active course's
 * recommendation is left to load (the active course lives in the browser).
 * A failed read here just leaves that request to the client.
 *
 * The plans pick the course to open on when none is chosen (today's
 * session, else the nearest exam). The shell's Start button reads the same
 * plans in this request, so they cost no extra query. If they fail, Study
 * opens on the first course in the switcher.
 */
export default async function StudyPage() {
  const userId = await getCurrentUserId()
  if (!userId) redirect("/auth/signin?callbackUrl=/learn")

  // The course counts need the zone (cards due today); the documents don't wait for it.
  const zone = loadTimeZone(userId)
  const [timeZone, documents, courses, plans] = await Promise.all([
    zone,
    listDocuments(userId, "COURSE").catch((err) => {
      logger.error("learn.page_documents_failed", { userId, error: String(err) })
      return null
    }),
    zone
      .then((z) => getStudyCourses(userId, z))
      .catch((err) => {
        logger.error("learn.page_courses_failed", { userId, error: String(err) })
        return null
      }),
    loadPlans(userId).catch((err) => {
      logger.error("learn.page_plans_failed", { userId, error: String(err) })
      return null
    }),
  ])

  const fallback: Record<string, unknown> = {}
  if (documents) fallback[DOCUMENTS_KEY] = { documents }
  if (courses) fallback[LEARN_KEY] = { courses, hasCourses: courses.length > 0 }

  return (
    <SwrFallback fallback={fallback}>
      <StudyView timeZone={timeZone} coursePreferences={plans ? coursePreferences(plans, timeZone) : undefined} />
    </SwrFallback>
  )
}
