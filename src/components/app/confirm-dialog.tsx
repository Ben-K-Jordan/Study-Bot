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

/**
 * Confirms a destructive or hard-to-undo action. Title is action plus
 * object ("Delete the Prelim 1 plan?"), the description says what is lost
 * with counts, and the confirm button is verb plus object ("Delete plan").
 * With `confirmText`, the button stays disabled until the student types it.
 * The dialog stays open while `onConfirm` runs and shows `failedMessage`
 * if it throws.
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
  onConfirm: () => void | Promise<void>
}) {
  const [openState, setOpenState] = React.useState(false)
  const open = openProp ?? openState
  const [typed, setTyped] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const inputId = React.useId()
  const errorId = React.useId()

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
      <AlertDialogContent>
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
