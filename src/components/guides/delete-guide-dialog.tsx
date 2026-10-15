"use client"

import { useState } from "react"

import { apiDelete } from "@/lib/client-api"
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
import { FieldError } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { describeRequestError } from "@/components/study/request-errors"
import { normalizeGuideSections } from "@/components/guides/guide-format"
import type { StudyGuide } from "@/components/guides/types"

/**
 * Confirms deleting a guide. Built from AlertDialog (like ConfirmDialog) so
 * it can hand focus to `returnFocus` when it closes: the button that opened
 * it belongs to the guide that was just deleted.
 */
export function DeleteGuideDialog({
  guide,
  open,
  onOpenChange,
  onDeleted,
  returnFocus,
}: {
  /** The guide to delete. Keep it set while the dialog animates closed. */
  guide: StudyGuide | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted: (guide: StudyGuide) => void | Promise<void>
  returnFocus: () => HTMLElement | null
}) {
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [deletedId, setDeletedId] = useState<string | null>(null)
  const errorId = "delete-guide-error"
  const sections = guide ? normalizeGuideSections(guide.sections).length : 0

  async function confirm() {
    if (!guide || pending) return
    setPending(true)
    setFailure(null)
    try {
      await apiDelete(`/api/guides/${encodeURIComponent(guide.id)}`)
      setDeletedId(guide.id)
      await onDeleted(guide)
      onOpenChange(false)
    } catch (error) {
      setFailure(`Guide not deleted. ${describeRequestError(error)}`)
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog
      open={open && guide !== null}
      onOpenChange={(next) => {
        if (pending) return
        if (!next) setFailure(null)
        onOpenChange(next)
      }}
    >
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          // After a delete the opener is gone; land on the panel instead.
          if (deletedId) {
            event.preventDefault()
            returnFocus()?.focus()
            setDeletedId(null)
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {guide?.title ?? "this guide"}?</AlertDialogTitle>
          <AlertDialogDescription>
            {plural(sections, {
              zero: "This deletes the guide. Your materials and other guides stay.",
              one: "This deletes the guide and its # section. Your materials and other guides stay.",
              other: "This deletes the guide and its # sections. Your materials and other guides stay.",
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {failure ? <FieldError id={errorId}>{failure}</FieldError> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={confirm}
            disabled={pending}
            aria-describedby={failure ? errorId : undefined}
          >
            {pending ? <Spinner data-icon="inline-start" aria-hidden="true" role={undefined} /> : null}
            {pending ? "Deleting guide…" : "Delete guide"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
