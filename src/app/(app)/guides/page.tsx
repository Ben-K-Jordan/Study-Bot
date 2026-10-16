import { redirect } from "next/navigation"

import { getCurrentUserId } from "@/lib/auth"
import { logger } from "@/lib/logger"
import { listDocuments } from "@/services/content"
import { resolveTimeZone } from "@/services/gamification"
import { SwrFallback } from "@/components/chat/swr-fallback"
import { guideTypeFromSlug } from "@/components/guides/guide-format"
import { GuidesView } from "@/components/guides/guides-view"

const DOCUMENTS_KEY = "/api/content/documents?namespace=COURSE"

function first(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null
}

/**
 * Study guides (/guides). Takes ?format=key-concepts|faq|cheat-sheet and
 * ?guide=<id> so a guide can be linked to. The course list is read here and
 * handed to the client cache, so the guides request for the active course
 * (which lives in the browser) starts as soon as the page hydrates.
 */
export default async function GuidesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [params, userId] = await Promise.all([searchParams, getCurrentUserId()])
  if (!userId) redirect("/auth/signin?callbackUrl=/guides")

  const [documents, timeZone] = await Promise.all([
    listDocuments(userId, "COURSE").catch((err) => {
      logger.error("guides.page_documents_failed", { userId, error: String(err) })
      return null
    }),
    resolveTimeZone(userId),
  ])
  const guideId = first(params.guide)

  return (
    <SwrFallback fallback={documents ? { [DOCUMENTS_KEY]: { documents } } : {}}>
      <GuidesView
        initialType={guideTypeFromSlug(first(params.format)) ?? "KEY_CONCEPTS"}
        initialGuideId={guideId && guideId.length <= 64 ? guideId : null}
        timeZone={timeZone}
      />
    </SwrFallback>
  )
}
