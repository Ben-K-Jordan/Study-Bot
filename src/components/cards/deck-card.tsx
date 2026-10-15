"use client"

import Link from "next/link"
import { PlusIcon } from "lucide-react"

import { formatDateWeekday, plural } from "@/lib/format"
import type { DeckSummaryData } from "@/services/flashcards"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { DeckActionsMenu } from "@/components/cards/deck-actions-menu"
import { DeckCounts } from "@/components/cards/deck-counts"
import { cardCount } from "@/components/cards/card-format"

/** Where a deck's cards came from, in one line. */
export function deckSource(deck: Pick<DeckSummaryData, "kind" | "source_title" | "course_name">): string {
  if (deck.kind === "errors") return "From errors you logged in sessions"
  if (deck.source_title) return `From ${deck.source_title}`
  return `From your ${deck.course_name} materials`
}

/** What is due, or when the next card is. */
export function DueLine({
  deck,
  timeZone,
}: {
  deck: Pick<DeckSummaryData, "counts" | "next_due_at" | "card_count">
  timeZone: string
}) {
  if (deck.card_count === 0) return <span className="type-body-m text-on-surface-variant">No cards yet</span>
  if (deck.counts.dueCount > 0) {
    return (
      <Badge variant="warning" className="tabular-nums">
        {plural(deck.counts.dueCount, { one: "# due today", other: "# due today" })}
      </Badge>
    )
  }
  return (
    <span className="type-body-m text-on-surface-variant">
      {deck.next_due_at ? `Next card due ${formatDateWeekday(deck.next_due_at, { timeZone })}` : "Nothing due"}
    </span>
  )
}

/** The one action a deck offers first: review what's due, review it all, or add cards. */
export function DeckPrimaryAction({
  deck,
  size = "default",
}: {
  deck: Pick<DeckSummaryData, "id" | "counts" | "card_count">
  size?: "default" | "sm"
}) {
  if (deck.card_count === 0) {
    return (
      <Button asChild variant="outline" size={size}>
        <Link href={`/flashcards/${deck.id}`}>
          <PlusIcon data-icon="inline-start" aria-hidden="true" />
          Add cards
        </Link>
      </Button>
    )
  }
  if (deck.counts.dueCount > 0) {
    return (
      <Button asChild size={size}>
        <Link href={`/flashcards/${deck.id}/review`}>Review due cards</Link>
      </Button>
    )
  }
  return (
    <Button asChild variant="outline" size={size}>
      <Link href={`/flashcards/${deck.id}/review?scope=all`}>Review deck</Link>
    </Button>
  )
}

/** One deck in the library: title, source, counts by status, what's due, and its review action. */
export function DeckCard({
  deck,
  timeZone,
  onDeleted,
}: {
  deck: DeckSummaryData
  timeZone: string
  onDeleted: () => void
}) {
  const titleId = `deck-${deck.id}`
  return (
    <Card size="sm" aria-labelledby={titleId} role="article" className="min-w-0">
      <CardHeader>
        <CardTitle>
          <h3 id={titleId} className="text-pretty">
            <Link
              href={`/flashcards/${deck.id}`}
              className="rounded-sm underline-offset-4 hover:underline"
            >
              {deck.title}
            </Link>
          </h3>
        </CardTitle>
        <CardDescription className="flex flex-col gap-1">
          <span>{cardCount(deck.card_count)}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0">{deckSource(deck)}</span>
            {deck.kind === "generated" ? <Badge variant="outline">AI-written</Badge> : null}
          </span>
        </CardDescription>
        <CardAction>
          <DeckActionsMenu deck={deck} onDeleted={onDeleted} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <DeckCounts counts={deck.counts} />
      </CardContent>
      <CardFooter className="mt-auto flex-wrap justify-between gap-3">
        <DueLine deck={deck} timeZone={timeZone} />
        <DeckPrimaryAction deck={deck} />
      </CardFooter>
    </Card>
  )
}
