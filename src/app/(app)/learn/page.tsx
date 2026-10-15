import { getCurrentUserId } from "@/lib/auth"
import { getUserTimezone } from "@/lib/timezone"
import { StudyView } from "@/components/study/study-view"

/**
 * Study (/learn). The server reads the student's time zone so planned
 * times match Settings; everything that depends on the active course,
 * which lives in the browser, loads in the client view.
 */
export default async function StudyPage() {
  const userId = await getCurrentUserId()
  const timeZone = userId ? await getUserTimezone(userId) : null
  return <StudyView timeZone={timeZone ?? undefined} />
}
