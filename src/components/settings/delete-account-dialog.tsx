"use client"

import { useId, useRef, useState } from "react"
import Link from "next/link"
import { CircleAlertIcon, Trash2Icon } from "lucide-react"

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
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { deleteAccountFailure } from "./request"

/**
 * "Delete your account?" with a password check. The server refuses the
 * delete without the student's current password, so a session alone (a
 * borrowed laptop, a stolen cookie) can't wipe the account. The dialog
 * stays open while the delete runs and keeps the typed password on failure.
 * A student who doesn't know the password (it lives in a password manager
 * on another device) gets a way to reset it, or, when this server can't
 * send reset links, who to ask.
 */
export function DeleteAccountDialog({
  onDelete,
  passwordResetAvailable,
}: {
  onDelete: (password: string) => Promise<void>
  passwordResetAvailable: boolean
}) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState("")
  const [pending, setPending] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [generalError, setGeneralError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const submitRef = useRef<HTMLButtonElement>(null)
  const inputId = useId()
  const hintId = useId()
  const fieldErrorId = useId()
  const generalErrorId = useId()

  function changeOpen(next: boolean) {
    if (pending) return
    if (!next) {
      setPassword("")
      setFieldError(null)
      setGeneralError(null)
    }
    setOpen(next)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!password || pending) return
    setPending(true)
    setFieldError(null)
    setGeneralError(null)
    try {
      await onDelete(password)
      // Success navigates away (sign-out); nothing to reset.
    } catch (error) {
      const failure = deleteAccountFailure(error)
      setPending(false)
      setFieldError(failure.field)
      setGeneralError(failure.general)
      // The disabled controls dropped focus; put it back where the fix is.
      requestAnimationFrame(() => {
        if (failure.field) inputRef.current?.select()
        else submitRef.current?.focus()
      })
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={changeOpen}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="destructive" className="self-start">
          <Trash2Icon data-icon="inline-start" aria-hidden="true" />
          Delete account
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        onOpenAutoFocus={(event) => {
          // Start in the password field (the next step), not on Cancel. Deleting
          // still needs the password and a deliberate press of Delete account.
          event.preventDefault()
          inputRef.current?.focus()
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Delete your account?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes your plans, sessions, answers, materials, decks, guides, and
            chat history, and disconnects Google Calendar. Events already in Google Calendar stay
            there. Export your data first if you want a copy.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <form noValidate onSubmit={handleSubmit} className="grid gap-6">
          <Field data-invalid={fieldError ? true : undefined}>
            <FieldLabel htmlFor={inputId}>Enter your password to confirm</FieldLabel>
            <Input
              ref={inputRef}
              id={inputId}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                if (fieldError) setFieldError(null)
              }}
              aria-invalid={fieldError ? true : undefined}
              // The error sits under the field and is heard first; the hint follows.
              aria-describedby={fieldError ? `${fieldErrorId} ${hintId}` : hintId}
              disabled={pending}
            />
            {fieldError ? (
              <FieldError id={fieldErrorId} className="flex items-start gap-1.5">
                <CircleAlertIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
                <span>{fieldError}</span>
              </FieldError>
            ) : null}
            <FieldDescription id={hintId}>
              {passwordResetAvailable ? (
                <>
                  Forgot it? <Link href="/auth/forgot-password">Reset your password</Link> first.
                </>
              ) : (
                "Forgot it? Ask the person who runs this Study Bot to reset your password."
              )}
            </FieldDescription>
          </Field>

          {generalError ? <FieldError id={generalErrorId}>{generalError}</FieldError> : null}

          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={pending}>
              Cancel
            </AlertDialogCancel>
            <Button
              ref={submitRef}
              type="submit"
              variant="destructive"
              disabled={!password || pending}
              aria-describedby={generalError ? generalErrorId : undefined}
            >
              {pending ? <Spinner data-icon="inline-start" aria-hidden="true" role={undefined} /> : null}
              {pending ? "Deleting account…" : "Delete account"}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
