import { redirect } from "next/navigation"

import { getCurrentUserId } from "@/lib/auth"
import { logger } from "@/lib/logger"
import { listDocuments } from "@/services/content"
import { loadPlans, loadTimeZone } from "@/services/progress-data"
import { PageContainer } from "@/components/app/page-container"
import { ChatScreen } from "@/components/chat/chat-screen"
import { SwrFallback } from "@/components/chat/swr-fallback"
import { coursePreferences } from "@/components/study/course-preference"

const DOCUMENTS_KEY = "/api/content/documents?namespace=COURSE"

/**
 * Chat over one course's materials. The course list is read here, on the
 * server, and handed to the client cache, so the history request starts as
 * soon as the page hydrates (the active course lives in the browser).
 *
 * With no course chosen, Chat opens on the course of today's session, else
 * the nearest exam, like Study. The shell's Start button reads the same
 * plans in this request, so they cost no extra query.
 */
export default async function ChatPage() {
  const userId = await getCurrentUserId()
  if (!userId) redirect("/auth/signin?callbackUrl=/chat")

  const [documents, timeZone, plans] = await Promise.all([
    listDocuments(userId, "COURSE").catch((err) => {
      logger.error("chat.page_documents_failed", { userId, error: String(err) })
      return null
    }),
    loadTimeZone(userId),
    loadPlans(userId).catch((err) => {
      logger.error("chat.page_plans_failed", { userId, error: String(err) })
      return null
    }),
  ])

  return (
    <PageContainer size="narrow" className="flex-1 pb-0">
      <SwrFallback fallback={documents ? { [DOCUMENTS_KEY]: { documents } } : {}}>
        <ChatScreen
          timeZone={timeZone}
          coursePreferences={plans ? coursePreferences(plans, timeZone) : undefined}
        />
      </SwrFallback>
    </PageContainer>
  )
}
