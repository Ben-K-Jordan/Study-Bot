"use client"

import * as React from "react"
import Link from "next/link"
import { EllipsisVerticalIcon, PencilIcon, RotateCcwIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { apiDelete } from "@/lib/client-api"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { plural } from "@/lib/format"
import { errorDetail } from "@/components/cards/error-copy"

/**
 * The overflow menu on a deck: open its cards, review every card, delete
 * the deck (with a confirmation that names the cards lost).
 */
export function DeckActionsMenu({
  deck,
  showEditCards = true,
  onDeleted,
}: {
  deck: { id: string; title: string; card_count: number }
  /** Hidden on the deck's own page. */
  showEditCards?: boolean
  /** Runs after the server deletes the deck (refresh the list, move focus). */
  onDeleted: () => void
}) {
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [failedMessage, setFailedMessage] = React.useState<string>()

  async function deleteDeck() {
    try {
      await apiDelete(`/api/flashcards/${encodeURIComponent(deck.id)}`)
    } catch (err) {
      setFailedMessage(`Deck not deleted. ${errorDetail(err)}`)
      throw err
    }
    toast("Deck deleted")
    onDeleted()
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`More actions for ${deck.title}`}>
            <EllipsisVerticalIcon aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            {showEditCards ? (
              <DropdownMenuItem asChild>
                <Link href={`/flashcards/${deck.id}`}>
                  <PencilIcon aria-hidden="true" />
                  Edit cards
                </Link>
              </DropdownMenuItem>
            ) : null}
            {deck.card_count > 0 ? (
              <DropdownMenuItem asChild>
                <Link href={`/flashcards/${deck.id}/review?scope=all`}>
                  <RotateCcwIcon aria-hidden="true" />
                  Review all cards
                </Link>
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirmOpen(true)}>
              <Trash2Icon aria-hidden="true" />
              Delete deck
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open)
          if (!open) setFailedMessage(undefined)
        }}
        title={`Delete ${deck.title}?`}
        description={plural(deck.card_count, {
          zero: "This deletes the deck. It has no cards.",
          one: "This deletes the deck and its 1 card, with its review history.",
          other: "This deletes the deck and its # cards, with their review history.",
        })}
        confirmLabel="Delete deck"
        pendingLabel="Deleting deck…"
        failedMessage={failedMessage}
        onConfirm={deleteDeck}
      />
    </>
  )
}
