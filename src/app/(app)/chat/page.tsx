import { redirect } from "next/navigation"

import { getCurrentUserId } from "@/lib/auth"
import { logger } from "@/lib/logger"
import { getUserTimezone } from "@/lib/timezone"
import { listDocuments } from "@/services/content"
import { PageContainer } from "@/components/app/page-container"
import { ChatScreen } from "@/components/chat/chat-screen"
import { SwrFallback } from "@/components/chat/swr-fallback"

const DOCUMENTS_KEY = "/api/content/documents?namespace=COURSE"

/**
 * Chat over one course's materials. The course list is read here, on the
 * server, and handed to the client cache, so the history request starts as
 * soon as the page hydrates (the active course lives in the browser).
 */
export default async function ChatPage() {
  const userId = await getCurrentUserId()
  if (!userId) redirect("/auth/signin?callbackUrl=/chat")

  const [documents, timeZone] = await Promise.all([
    listDocuments(userId, "COURSE").catch((err) => {
      logger.error("chat.page_documents_failed", { userId, error: String(err) })
      return null
    }),
    getUserTimezone(userId),
  ])

  return (
    <PageContainer size="narrow" className="flex-1 pb-0">
      <SwrFallback fallback={documents ? { [DOCUMENTS_KEY]: { documents } } : {}}>
        <ChatScreen timeZone={timeZone ?? "UTC"} />
      </SwrFallback>
    </PageContainer>
  )
}
