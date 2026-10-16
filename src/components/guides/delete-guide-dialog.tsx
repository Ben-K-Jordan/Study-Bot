"use client"

import { useLayoutEffect, useRef, useState } from "react"

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
import { closeFocusOrder, firstConnected, resolveOpener } from "@/components/app/return-focus"
import { describeRequestError } from "@/components/study/request-errors"
import { normalizeGuideSections } from "@/components/guides/guide-format"
import type { StudyGuide } from "@/components/guides/types"

/**
 * Confirms deleting a guide. Built from AlertDialog (like ConfirmDialog) and
 * returns focus the same way: to the button that opened it after Cancel or
 * Escape, and to `returnFocus` after a delete, since that button belonged to
 * the guide that was just deleted.
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
  const opener = useRef<HTMLElement | null>(null)
  const deleted = useRef(false)
  const errorId = "delete-guide-error"
  const sections = guide ? normalizeGuideSections(guide.sections).length : 0
  const isOpen = open && guide !== null

  // The dialog has no trigger, so remember what opened it before its focus
  // trap moves focus inside. Layout effects run before Radix's auto-focus.
  useLayoutEffect(() => {
    if (!isOpen) return
    deleted.current = false
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
    opener.current = resolveOpener(active, document.body, (id) => document.getElementById(id))
  }, [isOpen])

  async function confirm() {
    if (!guide || pending) return
    setPending(true)
    setFailure(null)
    try {
      await apiDelete(`/api/guides/${encodeURIComponent(guide.id)}`)
      deleted.current = true
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
      open={isOpen}
      onOpenChange={(next) => {
        if (pending) return
        if (!next) setFailure(null)
        onOpenChange(next)
      }}
    >
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          const target = firstConnected(
            closeFocusOrder({
              confirmed: deleted.current,
              opener: opener.current,
              afterAction: returnFocus(),
              main: document.getElementById("main-content"),
            })
          )
          opener.current = null
          deleted.current = false
          if (!target) return
          event.preventDefault()
          target.focus()
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
