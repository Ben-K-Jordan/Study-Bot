"use client"

import * as React from "react"
import { CircleAlertIcon } from "lucide-react"

import { plural } from "@/lib/format"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"

/**
 * "Delete the Prelim 1 plan?" with the counts of what comes off the
 * schedule. When the plan is in Google Calendar it asks whether to remove
 * those events too (unchecked keeps them, as the body says).
 */
export function DeletePlanDialog({
  open,
  onOpenChange,
  examName,
  upcomingCount,
  inGoogleCalendar,
  onConfirm,
  onCloseAutoFocus,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  examName: string
  /** Sessions still ahead (scheduled, missed or in progress). */
  upcomingCount: number
  inGoogleCalendar: boolean
  /** Throws an Error whose message is shown in the dialog. */
  onConfirm: (options: { removeCalendarEvents: boolean }) => Promise<void>
  /** Where focus goes on close; the dialog has no trigger of its own. */
  onCloseAutoFocus?: (event: Event) => void
}) {
  const [removeEvents, setRemoveEvents] = React.useState(true)
  const [pending, setPending] = React.useState(false)
  const [failure, setFailure] = React.useState<string | null>(null)
  const checkboxId = React.useId()
  const errorId = React.useId()

  function handleOpenChange(next: boolean) {
    if (pending) return
    if (!next) {
      setFailure(null)
      setRemoveEvents(true)
    }
    onOpenChange(next)
  }

  async function confirm() {
    setPending(true)
    setFailure(null)
    try {
      await onConfirm({ removeCalendarEvents: inGoogleCalendar && removeEvents })
      setPending(false)
      setRemoveEvents(true)
      onOpenChange(false)
    } catch (error) {
      setPending(false)
      setFailure(error instanceof Error ? error.message : "Plan not deleted. Check your connection and retry.")
    }
  }

  const lost =
    upcomingCount > 0
      ? plural(upcomingCount, {
          one: "Its # remaining session comes off your schedule.",
          other: "Its # remaining sessions come off your schedule.",
        })
      : "It has no sessions left to do."
  const kept = inGoogleCalendar
    ? "Your answers and progress stay."
    : "Your answers and progress stay, and so do events already in Google Calendar."

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete the {examName} plan?</AlertDialogTitle>
          <AlertDialogDescription>
            {lost} {kept}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {inGoogleCalendar ? (
          <Field orientation="horizontal">
            <Checkbox
              id={checkboxId}
              checked={removeEvents}
              onCheckedChange={(value) => setRemoveEvents(value === true)}
              disabled={pending}
            />
            <FieldContent>
              <FieldLabel htmlFor={checkboxId}>Also remove its events from Google Calendar</FieldLabel>
              <FieldDescription>Left unchecked, the events stay in Google Calendar.</FieldDescription>
            </FieldContent>
          </Field>
        ) : null}

        {failure ? (
          <p id={errorId} role="alert" className="flex items-start gap-2 type-body-m text-error">
            <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {failure}
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={confirm}
            disabled={pending}
            aria-describedby={failure ? errorId : undefined}
          >
            {pending ? <Spinner data-icon="inline-start" aria-hidden="true" role={undefined} /> : null}
            {pending ? "Deleting plan…" : "Delete plan"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
