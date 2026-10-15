"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeftIcon, LayersIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { apiDelete } from "@/lib/client-api"
import { formatDateWeekday } from "@/lib/format"
import type { DeckCardDetail, DeckDetail } from "@/services/flashcards"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { SectionHeader } from "@/components/app/section-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { CardEditorDialog } from "@/components/cards/card-editor-dialog"
import { DeckActionsMenu } from "@/components/cards/deck-actions-menu"
import { DeckPrimaryAction, DueLine, deckSource } from "@/components/cards/deck-card"
import { DeckCounts } from "@/components/cards/deck-counts"
import { STATUS_LABELS, calendarDate, cardCount } from "@/components/cards/card-format"
import { errorDetail } from "@/components/cards/error-copy"

type Editor = { kind: "add" } | { kind: "edit"; card: DeckCardDetail } | null

const STATUS_VARIANT = {
  new: "outline",
  learning: "warning",
  review: "secondary",
  mastered: "success",
} as const

/**
 * The deck page body: title, source and counts, the review action, then
 * every card with its status and next review. Cards can be added, edited
 * and deleted here.
 */
export function DeckDetailView({ deck }: { deck: DeckDetail }) {
  const router = useRouter()
  const [editor, setEditor] = React.useState<Editor>(null)
  const [deleting, setDeleting] = React.useState<DeckCardDetail | null>(null)
  const [deleteFailed, setDeleteFailed] = React.useState<string>()
  const listRef = React.useRef<HTMLElement>(null)
  const { timeZone } = deck

  const refresh = React.useCallback(() => router.refresh(), [router])

  async function deleteCard() {
    if (!deleting) return
    try {
      await apiDelete(
        `/api/flashcards/${encodeURIComponent(deck.id)}/cards/${encodeURIComponent(deleting.id)}`
      )
    } catch (err) {
      setDeleteFailed(`Card not deleted. ${errorDetail(err)}`)
      throw err
    }
    toast("Card deleted")
    refresh()
    listRef.current?.focus()
  }

  const examLine = deck.exam
    ? `Reviews are scheduled to finish before ${deck.exam.name} on ${formatDateWeekday(calendarDate(deck.exam.date), { timeZone })}.`
    : null

  return (
    <>
      <div>
        <Button asChild variant="text" size="sm" className="-ml-3">
          <Link href="/flashcards">
            <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
            All decks
          </Link>
        </Button>
      </div>

      <PageHeader
        title={deck.title}
        description={
          <>
            {deck.course_name}
            <span aria-hidden="true" className="px-1.5">
              ·
            </span>
            <span className="sr-only">, </span>
            {cardCount(deck.card_count)}
          </>
        }
        actions={
          <>
            <DeckPrimaryAction deck={deck} />
            <Button variant="outline" onClick={() => setEditor({ kind: "add" })}>
              <PlusIcon data-icon="inline-start" aria-hidden="true" />
              Add cards
            </Button>
            <DeckActionsMenu
              deck={deck}
              showEditCards={false}
              onDeleted={() => router.push("/flashcards")}
            />
          </>
        }
      />

      <div className="flex flex-col gap-3">
        <p className="flex flex-wrap items-center gap-2 type-body-m text-on-surface-variant">
          {deck.kind === "generated" ? <Badge variant="outline">AI-written</Badge> : null}
          <span>
            {deck.kind === "generated"
              ? `Written by AI ${deckSource(deck).replace(/^From/, "from")}. Edit any card that's wrong.`
              : `${deckSource(deck)}. Each card's back holds the correction rule you wrote.`}
          </span>
        </p>
        {examLine ? <p className="type-body-m text-on-surface-variant">{examLine}</p> : null}
      </div>

      <section
        aria-label="Cards by status"
        className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-2xl bg-surface-container p-4 sm:p-5"
      >
        <DeckCounts counts={deck.counts} className="min-w-64 flex-1" />
        <DueLine deck={deck} timeZone={timeZone} />
      </section>

      <section
        ref={listRef}
        tabIndex={-1}
        aria-labelledby="deck-cards"
        className="flex flex-col gap-3 outline-none"
      >
        <SectionHeader id="deck-cards" title="Cards" as="h3" />
        {deck.cards.length === 0 ? (
          <EmptyState
            bordered
            icon={LayersIcon}
            title="No cards in this deck"
            description="Add a card with a question on the front and its answer on the back."
            action={
              <Button onClick={() => setEditor({ kind: "add" })}>
                <PlusIcon data-icon="inline-start" aria-hidden="true" />
                Add cards
              </Button>
            }
          />
        ) : (
          <ol className="flex flex-col divide-y divide-outline-variant overflow-hidden rounded-2xl bg-card ring-1 ring-border">
            <li aria-hidden="true" className="hidden grid-cols-[1fr_1fr_5.5rem] gap-6 bg-surface-container-low px-5 py-2.5 type-label-m text-on-surface-variant md:grid">
              <span>Front</span>
              <span>Back</span>
            </li>
            {deck.cards.map((card, index) => (
              <li key={card.id}>
                <CardRow
                  card={card}
                  number={index + 1}
                  timeZone={timeZone}
                  showTags={deck.kind === "generated"}
                  onEdit={() => setEditor({ kind: "edit", card })}
                  onDelete={() => {
                    setDeleteFailed(undefined)
                    setDeleting(card)
                  }}
                />
              </li>
            ))}
          </ol>
        )}
      </section>

      {editor ? (
        <CardEditorDialog
          key={editor.kind === "edit" ? editor.card.id : "add"}
          deckId={deck.id}
          mode={
            editor.kind === "edit"
              ? { kind: "edit", cardId: editor.card.id, front: editor.card.front, back: editor.card.back }
              : { kind: "add" }
          }
          open
          onOpenChange={(open) => (open ? undefined : setEditor(null))}
          onSaved={refresh}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        title="Delete this card?"
        description="This deletes the card and its review history."
        confirmLabel="Delete card"
        pendingLabel="Deleting card…"
        failedMessage={deleteFailed}
        onConfirm={deleteCard}
      />
    </>
  )
}

function CardRow({
  card,
  number,
  timeZone,
  showTags,
  onEdit,
  onDelete,
}: {
  card: DeckCardDetail
  number: number
  timeZone: string
  showTags: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const tags = showTags ? (card.tags ?? []).filter((t) => t !== "auto-repair") : []
  const due =
    card.status === "new"
      ? null
      : card.due
        ? "Due today"
        : card.nextDueAt
          ? `Due ${formatDateWeekday(card.nextDueAt, { timeZone })}`
          : null

  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-3 px-4 py-4 sm:px-5 md:grid-cols-[1fr_1fr_5.5rem] md:gap-x-6">
      <dl className="col-span-1 grid gap-2 md:col-span-2 md:grid-cols-2 md:gap-6">
        <div className="min-w-0">
          <dt className="sr-only">Front</dt>
          <dd className="type-title-s whitespace-pre-line text-on-surface [overflow-wrap:anywhere]">{card.front}</dd>
        </div>
        <div className="min-w-0">
          <dt className="sr-only">Back</dt>
          <dd className="type-body-m whitespace-pre-line text-on-surface-variant [overflow-wrap:anywhere]">{card.back}</dd>
        </div>
      </dl>
      <div className="row-span-2 -mt-2 -mr-2 flex items-start justify-end md:row-span-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Edit card ${number}`} onClick={onEdit}>
              <PencilIcon aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Edit card</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Delete card ${number}`} onClick={onDelete}>
              <Trash2Icon aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete card</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 md:col-span-3">
        <Badge variant={STATUS_VARIANT[card.status]}>{STATUS_LABELS[card.status]}</Badge>
        {due ? <span className="type-body-s text-on-surface-variant">{due}</span> : null}
        {tags.map((tag) => (
          <Badge key={tag} variant="ghost" className="max-w-48 px-1.5">
            <span className="truncate">{tag}</span>
          </Badge>
        ))}
      </div>
    </div>
  )
}
