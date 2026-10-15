"use client"

import Link from "next/link"
import { CloudOffIcon, RotateCcwIcon } from "lucide-react"

import { StatusScreen } from "@/components/app/status-screen"
import { Button } from "@/components/ui/button"

/** The review failed to load or crashed: ratings already saved stay saved. */
export default function ReviewError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <StatusScreen
      icon={CloudOffIcon}
      tone="error"
      title="Cards didn't load."
      description="Ratings you already gave are saved. Retry, or go back to your decks."
      actions={
        <>
          <Button onClick={reset}>
            <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
            Retry
          </Button>
          <Button asChild variant="outline">
            <Link href="/flashcards">Go to flashcards</Link>
          </Button>
        </>
      }
      footnote={error.digest ? `Reference: ${error.digest}` : undefined}
    />
  )
}
