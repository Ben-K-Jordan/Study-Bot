import { cache } from "react"
import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"

import { getCurrentUserId } from "@/lib/auth"
import { getStudyCards, type StudyScope } from "@/services/spaced-repetition"
import { CardReview } from "@/components/cards/review/card-review"

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
    return { title: data ? `Review ${data.deck.title}` : "Review" }
  } catch {
    return { title: "Review" }
  }
}

/**
 * /flashcards/:deckId/review: the due cards (or ?scope=all, every card) one
 * at a time. Refreshing starts again from the server's state, so cards
 * already rated aren't due anymore and the review picks up where it was.
 */
export default async function ReviewPage({ params, searchParams }: Props) {
  const [{ deckId }, sp] = await Promise.all([params, searchParams])
  const scope = scopeOf(sp.scope)
  const { userId, data } = await loadReview(deckId, scope)
  if (!userId) {
    redirect(`/auth/signin?callbackUrl=${encodeURIComponent(`/flashcards/${deckId}/review`)}`)
  }
  if (!data) notFound()

  return <CardReview key={`${deckId}:${scope}`} data={data} timeZone={data.timeZone} />
}
