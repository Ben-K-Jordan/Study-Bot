"use client"

import * as React from "react"

import { apiPost } from "@/lib/client-api"
import { formatNumber } from "@/lib/format"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { CARD_BACK_MAX, CARD_FRONT_MAX } from "@/components/cards/card-format"
import { errorDetail, fieldErrors } from "@/components/cards/error-copy"
import { apiPatch } from "@/components/cards/api-patch"

type Mode = { kind: "add" } | { kind: "edit"; cardId: string; front: string; back: string }

function addedLine(count: number) {
  return count === 1
    ? "Card added. Add another, or choose Done."
    : `${formatNumber(count)} cards added. Add another, or choose Done.`
}

/**
 * Add or edit one card: Front (the question or cue) and Back (the answer).
 * Adding keeps the dialog open with empty fields, so several cards go in
 * one after another; Done closes it.
 */
export function CardEditorDialog({
  deckId,
  mode,
  open,
  onOpenChange,
  onSaved,
  onCloseAutoFocus,
}: {
  deckId: string
  mode: Mode
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Runs after each save so the page can refresh its list. */
  onSaved: () => void
  /**
   * Puts focus back when the dialog closes. It opens without a trigger, so
   * the page names the control to return to.
   */
  onCloseAutoFocus?: (event: Event) => void
}) {
  const formId = React.useId()
  const frontRef = React.useRef<HTMLTextAreaElement>(null)
  const [front, setFront] = React.useState(mode.kind === "edit" ? mode.front : "")
  const [back, setBack] = React.useState(mode.kind === "edit" ? mode.back : "")
  const [errors, setErrors] = React.useState<{ front?: string; back?: string; form?: string }>({})
  const [pending, setPending] = React.useState(false)
  const [addedCount, setAddedCount] = React.useState(0)

  const adding = mode.kind === "add"

  function validate() {
    const next: typeof errors = {}
    if (!front.trim()) next.front = "Write the question or cue for the front."
    else if (front.trim().length > CARD_FRONT_MAX)
      next.front = `Keep the front under ${formatNumber(CARD_FRONT_MAX)} characters.`
    if (!back.trim()) next.back = "Write the answer for the back."
    else if (back.trim().length > CARD_BACK_MAX)
      next.back = `Keep the back under ${formatNumber(CARD_BACK_MAX)} characters.`
    return next
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending) return
    const invalid = validate()
    setErrors(invalid)
    if (invalid.front || invalid.back) {
      ;(invalid.front ? frontRef.current : document.getElementById(`${formId}-back`))?.focus()
      return
    }

    setPending(true)
    try {
      if (adding) {
        await apiPost(`/api/flashcards/${encodeURIComponent(deckId)}/cards`, { front, back })
        setAddedCount((n) => n + 1)
        setFront("")
        setBack("")
        frontRef.current?.focus()
      } else {
        await apiPatch(`/api/flashcards/${encodeURIComponent(deckId)}/cards/${encodeURIComponent(mode.cardId)}`, {
          front,
          back,
        })
        onOpenChange(false)
      }
      onSaved()
    } catch (err) {
      const fields = fieldErrors(err)
      if (fields.front) frontRef.current?.focus()
      else if (fields.back) document.getElementById(`${formId}-back`)?.focus()
      setErrors({
        front: fields.front,
        back: fields.back,
        form: fields.front || fields.back ? undefined : `${adding ? "Card not added." : "Card not saved."} ${errorDetail(err)}`,
      })
    } finally {
      setPending(false)
    }
  }

  const frontError = errors.front
  const backError = errors.back

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{adding ? "Add cards" : "Edit card"}</DialogTitle>
          <DialogDescription>
            {adding
              ? "Put a question or cue on the front and its answer on the back."
              : "Changing the text keeps the card's schedule and review history."}
          </DialogDescription>
        </DialogHeader>

        <form id={formId} onSubmit={submit} noValidate>
          <FieldGroup className="gap-5">
            <Field data-invalid={frontError ? true : undefined}>
              <FieldLabel htmlFor={`${formId}-front`}>Front</FieldLabel>
              <Textarea
                ref={frontRef}
                id={`${formId}-front`}
                value={front}
                onChange={(e) => setFront(e.target.value)}
                aria-invalid={frontError ? true : undefined}
                aria-describedby={frontError ? `${formId}-front-error` : `${formId}-front-help`}
                className="min-h-20"
                autoFocus
                readOnly={pending}
              />
              {frontError ? (
                <FieldError id={`${formId}-front-error`}>{frontError}</FieldError>
              ) : (
                <FieldDescription id={`${formId}-front-help`}>The question you answer from memory.</FieldDescription>
              )}
            </Field>
            <Field data-invalid={backError ? true : undefined}>
              <FieldLabel htmlFor={`${formId}-back`}>Back</FieldLabel>
              <Textarea
                id={`${formId}-back`}
                value={back}
                onChange={(e) => setBack(e.target.value)}
                aria-invalid={backError ? true : undefined}
                aria-describedby={backError ? `${formId}-back-error` : `${formId}-back-help`}
                className="min-h-24"
                readOnly={pending}
              />
              {backError ? (
                <FieldError id={`${formId}-back-error`}>{backError}</FieldError>
              ) : (
                <FieldDescription id={`${formId}-back-help`}>The answer you check yourself against.</FieldDescription>
              )}
            </Field>
          </FieldGroup>
        </form>

        {adding && addedCount > 0 ? (
          <p aria-hidden="true" className="type-body-m text-on-surface-variant">
            {addedLine(addedCount)}
          </p>
        ) : null}
        <p role="status" aria-live="polite" className="sr-only">
          {adding && addedCount > 0 ? addedLine(addedCount) : null}
        </p>
        {errors.form ? <FieldError>{errors.form}</FieldError> : null}

        <DialogFooter>
          <Button type="button" variant="text" onClick={() => onOpenChange(false)} disabled={pending}>
            {adding && addedCount > 0 ? "Done" : "Cancel"}
          </Button>
          <Button type="submit" form={formId} disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" aria-hidden="true" role={undefined} /> : null}
            {adding ? (pending ? "Adding card…" : "Add card") : pending ? "Saving card…" : "Save card"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
