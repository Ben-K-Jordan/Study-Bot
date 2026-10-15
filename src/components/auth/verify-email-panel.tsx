"use client"

import { useState } from "react"
import Link from "next/link"
import { CircleCheckIcon } from "lucide-react"

import { AuthActions, AuthCard, EmailAddress } from "@/components/auth/auth-card"
import { AuthTextField, PendingStatus } from "@/components/auth/auth-fields"
import { ErrorSummary } from "@/components/auth/error-summary"
import { useResendVerification } from "@/components/auth/use-resend-verification"
import { validateEmail } from "@/components/auth/validation"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { FieldGroup } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"

/**
 * Where the verify-email page is coming from: "sent" after creating an
 * account, or a verification link that didn't work.
 */
export type VerifyEmailStatus = "sent" | "expired" | "invalid" | "busy" | "failed"

const COPY: Record<Exclude<VerifyEmailStatus, "sent">, { title: string; description: string }> = {
  expired: {
    title: "Verification link expired",
    description: "Verification links last 24 hours. Send a new one to finish creating your account.",
  },
  invalid: {
    title: "This verification link doesn't work",
    description:
      "It may be incomplete, or a newer link replaced it. Send a new one to finish creating your account.",
  },
  busy: {
    title: "Too many attempts",
    description: "Wait a few minutes, then open the link in your email again.",
  },
  failed: {
    title: "Email not verified yet",
    description: "The link couldn't be checked just now. Open it again in a few minutes.",
  },
}

/**
 * The "verify your email" screen: where the link went, how long it lasts,
 * and a way to send a new one. Without a known address it asks for one.
 * Nothing here says whether an account exists.
 */
export function VerifyEmailPanel({ status, email }: { status: VerifyEmailStatus; email: string | null }) {
  const [address, setAddress] = useState(email ?? "")
  const [fieldError, setFieldError] = useState<string | undefined>()
  const [attempt, setAttempt] = useState(0)
  const { state, send } = useResendVerification()
  const sending = state.status === "sending"
  const askForEmail = !email || status !== "sent"

  function handleSend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending) return
    const target = askForEmail ? address : (email ?? "")
    const error = validateEmail(target)
    setFieldError(error ?? undefined)
    setAttempt((n) => n + 1)
    if (error) return
    void send(target)
  }

  const shownFieldError =
    fieldError ?? (state.status === "failed" && state.fieldError && askForEmail ? state.message : undefined)
  const requestError =
    state.status === "failed" && (!state.fieldError || !askForEmail) ? state.message : null

  const title = status === "sent" ? "Verify your email" : COPY[status].title
  const description =
    status === "sent" ? (
      email ? (
        <>
          A verification link went to <EmailAddress>{email}</EmailAddress>. Open it to finish creating
          your account.
        </>
      ) : (
        "A verification link went to the email you signed up with. Open it to finish creating your account."
      )
    ) : (
      COPY[status].description
    )

  return (
    <AuthCard title={title} description={description}>
      <form noValidate onSubmit={handleSend} className="flex flex-col gap-8">
        {shownFieldError && askForEmail ? (
          <ErrorSummary key={`field-${attempt}`} items={[{ fieldId: "email", message: shownFieldError }]} />
        ) : null}
        {requestError ? <ErrorSummary key={`request-${attempt}`} message={requestError} /> : null}
        {state.status === "sent" ? (
          <Alert variant="success" role="status">
            <CircleCheckIcon aria-hidden="true" />
            <AlertTitle>Link sent</AlertTitle>
            <AlertDescription>
              If <EmailAddress className="text-current">{state.email}</EmailAddress> has an account waiting for verification,
              a new link is on its way. It lasts 24 hours.
            </AlertDescription>
          </Alert>
        ) : null}

        {status === "sent" ? (
          <p className="type-body-m text-on-surface-variant">
            The link lasts 24 hours. Not in your inbox? Check your spam folder, or send a new link.
          </p>
        ) : null}

        {askForEmail && status !== "busy" && status !== "failed" ? (
          <FieldGroup>
            <AuthTextField
              id="email"
              name="email"
              type="email"
              label="Email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={address}
              onChange={(event) => {
                setAddress(event.target.value)
                if (fieldError && !validateEmail(event.target.value)) setFieldError(undefined)
              }}
              error={shownFieldError}
            />
          </FieldGroup>
        ) : null}

        <AuthActions>
          <Button variant="text" asChild>
            <Link href="/auth/signin">Back to sign in</Link>
          </Button>
          {status !== "busy" && status !== "failed" ? (
            <Button type="submit" variant={status === "sent" ? "secondary" : "default"} disabled={sending}>
              {sending ? (
                <>
                  <Spinner data-icon="inline-start" aria-hidden="true" role={undefined} />
                  Sending link…
                </>
              ) : (
                "Send a new link"
              )}
            </Button>
          ) : null}
        </AuthActions>
        <PendingStatus message={sending ? "Sending link…" : null} />
      </form>
    </AuthCard>
  )
}
