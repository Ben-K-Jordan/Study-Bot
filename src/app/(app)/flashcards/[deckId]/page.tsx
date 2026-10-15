import { cache } from "react"
import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"

import { getCurrentUserId } from "@/lib/auth"
import { logger } from "@/lib/logger"
import { getDeckDetail, type DeckDetail } from "@/services/flashcards"
import { PageContainer } from "@/components/app/page-container"
import { DeckDetailView } from "@/components/cards/deck-detail"
import { RefreshErrorState } from "@/components/cards/refresh-error"

type Props = { params: Promise<{ deckId: string }> }

type Loaded = { deck: DeckDetail | null; failed: boolean }

/** One load per request, shared by the metadata and the page. */
const loadDeck = cache(async (deckId: string): Promise<Loaded & { userId: string | null }> => {
  const userId = await getCurrentUserId()
  if (!userId) return { userId, deck: null, failed: false }
  try {
    return { userId, deck: await getDeckDetail(userId, deckId), failed: false }
  } catch (err) {
    logger.error("flashcards.deck_page_load_failed", { userId, deckId, error: String(err) })
    return { userId, deck: null, failed: true }
  }
})

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { deckId } = await params
  const { deck } = await loadDeck(deckId)
  return { title: deck ? deck.title : "Deck" }
}

/** A deck's cards: status and next review for each, with add, edit and delete. */
export default async function DeckPage({ params }: Props) {
  const { deckId } = await params
  const { userId, deck, failed } = await loadDeck(deckId)
  if (!userId) redirect(`/auth/signin?callbackUrl=/flashcards/${encodeURIComponent(deckId)}`)
  if (failed) {
    return (
      <PageContainer size="narrow">
        <RefreshErrorState title="Deck didn't load." />
      </PageContainer>
    )
  }
  if (!deck) notFound()

  return (
    <PageContainer size="narrow">
      <DeckDetailView deck={deck} />
    </PageContainer>
  )
}
