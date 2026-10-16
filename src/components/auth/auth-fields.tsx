"use client"

import { CircleAlertIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

/**
 * A labelled text field for the auth forms. Helper text sits under the
 * field before anything is typed; an error replaces it, is tied to the
 * input with aria-describedby, and marks the field invalid.
 */
export function AuthTextField({
  id,
  label,
  description,
  error,
  ...inputProps
}: Omit<React.ComponentProps<typeof Input>, "id" | "aria-invalid" | "aria-describedby"> & {
  id: string
  label: string
  description?: string
  error?: string
}) {
  const descriptionId = `${id}-description`
  const errorId = `${id}-error`
  const describedBy = error ? errorId : description ? descriptionId : undefined

  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...inputProps}
      />
      {error ? (
        // The error summary announces errors on submit, so these stay quiet.
        <FieldError id={errorId} role={undefined} className="flex items-start gap-1.5">
          <CircleAlertIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          <span>{error}</span>
        </FieldError>
      ) : description ? (
        <FieldDescription id={descriptionId}>{description}</FieldDescription>
      ) : null}
    </Field>
  )
}

/**
 * Google's "Show password" checkbox. One checkbox shows every password
 * field on the form, so a new password and its confirmation can be checked
 * side by side.
 */
export function ShowPasswordField({
  checked,
  onCheckedChange,
  controls,
  disabled,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /** Ids of the password inputs this checkbox reveals. */
  controls: string[]
  disabled?: boolean
}) {
  return (
    <Field orientation="horizontal" data-disabled={disabled ? true : undefined} className="w-auto">
      <Checkbox
        id="show-password"
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        aria-controls={controls.join(" ")}
        disabled={disabled}
      />
      <FieldLabel htmlFor="show-password" className="font-normal">
        Show password
      </FieldLabel>
    </Field>
  )
}

/** The form's filled button. While pending it keeps its colours, shows a spinner and the -ing label. */
export function SubmitButton({
  pending,
  pendingLabel,
  children,
}: {
  pending: boolean
  pendingLabel: string
  children: React.ReactNode
}) {
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <>
          <Spinner data-icon="inline-start" aria-hidden="true" role={undefined} />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </Button>
  )
}

/**
 * A polite live region that reads the in-progress label ("Signing in…")
 * to screen readers. Keep it mounted so the change is announced.
 */
export function PendingStatus({ message }: { message: string | null }) {
  return (
    <p role="status" aria-live="polite" className="sr-only">
      {message ?? ""}
    </p>
  )
}
