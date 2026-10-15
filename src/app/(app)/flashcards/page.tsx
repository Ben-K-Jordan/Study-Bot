import { redirect } from "next/navigation"

import { getCurrentUserId } from "@/lib/auth"
import { logger } from "@/lib/logger"
import { getDeckLibrary, type DeckLibrary } from "@/services/flashcards"
import { PageContainer } from "@/components/app/page-container"
import { DeckLibraryView } from "@/components/cards/deck-library"
import { RefreshErrorState } from "@/components/cards/refresh-error"

/**
 * Cards: every course with materials or decks, nearest exam first, with each
 * deck's counts by status and what's due today. Rendered on the server; the
 * generate, delete and review actions are client islands.
 */
export default async function FlashcardsPage() {
  const userId = await getCurrentUserId()
  if (!userId) redirect("/auth/signin?callbackUrl=/flashcards")

  let library: DeckLibrary | null = null
  try {
    library = await getDeckLibrary(userId)
  } catch (err) {
    logger.error("flashcards.page_load_failed", { userId, error: String(err) })
  }

  return (
    <PageContainer>
      {library ? <DeckLibraryView library={library} /> : <RefreshErrorState title="Decks didn't load." />}
    </PageContainer>
  )
}
