import { getCurrentUserId } from "@/lib/auth"
import { getUserTimezone } from "@/lib/timezone"
import { guideTypeFromSlug } from "@/components/guides/guide-format"
import { GuidesView } from "@/components/guides/guides-view"

function first(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null
}

/**
 * Study guides (/guides). Takes ?format=key-concepts|faq|cheat-sheet and
 * ?guide=<id> so a guide can be linked to; the course comes from the
 * active course in the browser.
 */
export default async function GuidesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [params, userId] = await Promise.all([searchParams, getCurrentUserId()])
  const timeZone = userId ? await getUserTimezone(userId) : null
  const guideId = first(params.guide)

  return (
    <GuidesView
      initialType={guideTypeFromSlug(first(params.format)) ?? "KEY_CONCEPTS"}
      initialGuideId={guideId && guideId.length <= 64 ? guideId : null}
      timeZone={timeZone ?? undefined}
    />
  )
}
