"use client"

import * as React from "react"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { firstConnected, resolveOpener } from "@/components/app/return-focus"

function mainRegion(): HTMLElement | null {
  return document.getElementById("main-content")
}

/**
 * Confirms a destructive or hard-to-undo action. Title is action plus
 * object ("Delete the Prelim 1 plan?"), the description says what is lost
 * with counts, and the confirm button is verb plus object ("Delete plan").
 * With `confirmText`, the button stays disabled until the student types it.
 * The dialog stays open while `onConfirm` runs and shows `failedMessage`
 * if it throws.
 *
 * When it closes, focus goes back to whatever opened it (Radix only does
 * that for its own trigger, so a controlled dialog would drop focus on
 * <body>); an item in a menu hands it to the menu's button. Pass
 * `returnFocus` for where focus goes after the action ran, such as the list
 * when the confirmed action deletes the row that opened the dialog. Failing
 * both, focus goes to the main region.
 */
export function ConfirmDialog({
  trigger,
  open: openProp,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pendingLabel,
  cancelLabel = "Cancel",
  destructive = true,
  confirmText,
  confirmTextLabel,
  failedMessage = "That didn't go through. Check your connection and retry.",
  returnFocus,
  onConfirm,
}: {
  /** The element that opens the dialog (a Button). Omit when controlled. */
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  title: string
  description: React.ReactNode
  confirmLabel: string
  /** In-progress label: "Deleting plan…". */
  pendingLabel?: string
  cancelLabel?: string
  destructive?: boolean
  /** Text the student must type to enable the button (an email, a name). */
  confirmText?: string
  /** Label for that field: "Type your email address to confirm". */
  confirmTextLabel?: string
  failedMessage?: string
  /**
   * Where focus goes after the action ran (and whenever the opener is
   * gone): the list, its heading, or the next row. Cancel and Escape still
   * return to the opener.
   */
  returnFocus?: React.RefObject<HTMLElement | null>
  onConfirm: () => void | Promise<void>
}) {
  const [openState, setOpenState] = React.useState(false)
  const open = openProp ?? openState
  const [typed, setTyped] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const inputId = React.useId()
  const errorId = React.useId()
  const opener = React.useRef<HTMLElement | null>(null)
  const confirmed = React.useRef(false)

  // Remember the opener before the dialog's focus trap moves focus inside.
  // Layout effects run before Radix's (passive) auto-focus effect.
  React.useLayoutEffect(() => {
    if (!open) return
    confirmed.current = false
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
    opener.current = resolveOpener(active, document.body, (id) => document.getElementById(id))
  }, [open])

  const restoreFocus = (event: Event) => {
    // After the action ran, `returnFocus` wins (the opener is usually what
    // was just deleted, even if it hasn't left the page yet); after Cancel or
    // Escape, the opener does.
    const preferred = confirmed.current
      ? [returnFocus?.current, opener.current]
      : [opener.current, returnFocus?.current]
    const target = firstConnected([...preferred, mainRegion()])
    opener.current = null
    confirmed.current = false
    if (!target) return
    event.preventDefault()
    target.focus()
  }

  const setOpen = (next: boolean) => {
    if (pending) return
    if (!next) {
      setTyped("")
      setFailed(false)
    }
    if (openProp === undefined) setOpenState(next)
    onOpenChange?.(next)
  }

  const matches = confirmText === undefined || typed.trim() === confirmText

  async function handleConfirm() {
    if (!matches || pending) return
    setPending(true)
    setFailed(false)
    try {
      await onConfirm()
      confirmed.current = true
      setPending(false)
      setTyped("")
      if (openProp === undefined) setOpenState(false)
      onOpenChange?.(false)
    } catch {
      setPending(false)
      setFailed(true)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {trigger ? <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger> : null}
      <AlertDialogContent onCloseAutoFocus={restoreFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        {confirmText !== undefined ? (
          <Field>
            <FieldLabel htmlFor={inputId}>
              {confirmTextLabel ?? `Type ${confirmText} to confirm`}
            </FieldLabel>
            <Input
              id={inputId}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={pending}
            />
          </Field>
        ) : null}

        {failed ? <FieldError id={errorId}>{failedMessage}</FieldError> : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          {/* A plain Button, not AlertDialogAction, so the dialog stays open while the work runs. */}
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={handleConfirm}
            disabled={!matches || pending}
            aria-describedby={failed ? errorId : undefined}
          >
            {pending ? <Spinner data-icon="inline-start" aria-hidden="true" role={undefined} /> : null}
            {pending && pendingLabel ? pendingLabel : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
