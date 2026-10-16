import { cache, Suspense } from "react"
import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"

import { getCurrentUserId } from "@/lib/auth"
import { isDeckOwner } from "@/services/flashcards"
import { getStudyCards, type StudyScope } from "@/services/spaced-repetition"
import { CardReview } from "@/components/cards/review/card-review"
import { initialReviewState, reviewTitle } from "@/components/cards/review/review-state"
import { ReviewSkeleton } from "@/components/cards/skeletons"

type Props = {
  params: Promise<{ deckId: string }>
  searchParams: Promise<{ scope?: string | string[] }>
}

/** One load per request, shared by the metadata and the page. */
const loadReview = cache(async (deckId: string, scope: StudyScope) => {
  const userId = await getCurrentUserId()
  if (!userId) return { userId: null, data: null }
  try {
    return { userId, data: await getStudyCards(userId, deckId, scope) }
  } catch (err) {
    if (err instanceof Error && err.message === "Deck not found") return { userId, data: null }
    throw err
  }
})

function scopeOf(value: string | string[] | undefined): StudyScope {
  return value === "all" ? "all" : "due"
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ deckId }, sp] = await Promise.all([params, searchParams])
  try {
    const { data } = await loadReview(deckId, scopeOf(sp.scope))
    if (!data) return { title: "Deck not found" }
    // The same title the review sets once it's on screen, so the tab doesn't change on load
    return { title: reviewTitle(initialReviewState(data.cards, data.stats), data.deck.title) }
  } catch {
    return { title: "Review" }
  }
}

/**
 * /flashcards/:deckId/review: the due cards (or ?scope=all, every card) one
 * at a time. Refreshing starts again from the server's state, so cards
 * already rated aren't due anymore and the review picks up where it was.
 *
 * The deck is checked before anything streams, so a missing deck or another
 * account's deck answers with a real 404 (like /s/[sessionId]). That is why
 * this segment has no loading.tsx; the skeleton comes from the Suspense
 * boundary below, after the check.
 */
export default async function ReviewPage({ params, searchParams }: Props) {
  const [{ deckId }, sp] = await Promise.all([params, searchParams])
  const scope = scopeOf(sp.scope)
  const userId = await getCurrentUserId()
  if (!userId) {
    redirect(`/auth/signin?callbackUrl=${encodeURIComponent(`/flashcards/${deckId}/review`)}`)
  }
  if (!(await isDeckOwner(userId, deckId))) notFound()

  return (
    <Suspense fallback={<ReviewSkeleton />}>
      <ReviewContent deckId={deckId} scope={scope} />
    </Suspense>
  )
}

async function ReviewContent({ deckId, scope }: { deckId: string; scope: StudyScope }) {
  const { data } = await loadReview(deckId, scope)
  // Deleted between the check and this load
  if (!data) notFound()
  return <CardReview key={`${deckId}:${scope}`} data={data} timeZone={data.timeZone} />
}
