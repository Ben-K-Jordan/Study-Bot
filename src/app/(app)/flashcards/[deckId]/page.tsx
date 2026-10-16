import { cache, Suspense } from "react"
import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"

import { getCurrentUserId } from "@/lib/auth"
import { logger } from "@/lib/logger"
import { getDeckDetail, isDeckOwner, type DeckDetail } from "@/services/flashcards"
import { PageContainer } from "@/components/app/page-container"
import { DeckDetailView } from "@/components/cards/deck-detail"
import { RefreshErrorState } from "@/components/cards/refresh-error"
import { DeckSkeleton } from "@/components/cards/skeletons"

type Props = { params: Promise<{ deckId: string }> }

type Loaded = { deck: DeckDetail | null; failed: boolean }

/** One load per request, shared by the metadata and the page. */
const loadDeck = cache(async (deckId: string): Promise<Loaded> => {
  const userId = await getCurrentUserId()
  if (!userId) return { deck: null, failed: false }
  try {
    return { deck: await getDeckDetail(userId, deckId), failed: false }
  } catch (err) {
    logger.error("flashcards.deck_page_load_failed", { userId, deckId, error: String(err) })
    return { deck: null, failed: true }
  }
})

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { deckId } = await params
  const { deck, failed } = await loadDeck(deckId)
  if (deck) return { title: deck.title }
  return { title: failed ? "Deck didn't load" : "Deck not found" }
}

/**
 * A deck's cards: status and next review for each, with add, edit and delete.
 *
 * The deck is checked before anything streams, so a missing deck or another
 * account's deck answers with a real 404 (like /s/[sessionId]). That is why
 * this segment has no loading.tsx; the skeleton comes from the Suspense
 * boundary below, after the check.
 */
export default async function DeckPage({ params }: Props) {
  const { deckId } = await params
  const userId = await getCurrentUserId()
  if (!userId) redirect(`/auth/signin?callbackUrl=${encodeURIComponent(`/flashcards/${deckId}`)}`)

  let owned: boolean
  try {
    owned = await isDeckOwner(userId, deckId)
  } catch (err) {
    logger.error("flashcards.deck_page_check_failed", { userId, deckId, error: String(err) })
    return <DeckFailed />
  }
  if (!owned) notFound()

  return (
    <PageContainer size="narrow">
      <Suspense fallback={<DeckSkeleton />}>
        <DeckContent deckId={deckId} />
      </Suspense>
    </PageContainer>
  )
}

async function DeckContent({ deckId }: { deckId: string }) {
  const { deck, failed } = await loadDeck(deckId)
  if (failed) return <RefreshErrorState title="Deck didn't load." />
  // Deleted between the check and this load
  if (!deck) notFound()
  return <DeckDetailView deck={deck} />
}

function DeckFailed() {
  return (
    <PageContainer size="narrow">
      <RefreshErrorState title="Deck didn't load." />
    </PageContainer>
  )
}
