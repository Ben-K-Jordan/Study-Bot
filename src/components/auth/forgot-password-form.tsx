"use client"

import { useState } from "react"
import Link from "next/link"

import { AuthActions, AuthCard, EmailAddress, focusOnMount } from "@/components/auth/auth-card"
import { AuthTextField, PendingStatus, SubmitButton } from "@/components/auth/auth-fields"
import { postAuth } from "@/components/auth/auth-request"
import { ErrorSummary } from "@/components/auth/error-summary"
import {
  EMAIL_NOT_CONFIGURED,
  EMAIL_NOT_CONFIGURED_MESSAGES,
  REQUEST_FAILED,
} from "@/lib/auth-messages"
import { FIELD_MESSAGES, validateEmail } from "@/lib/auth-validation"
import { Button } from "@/components/ui/button"
import { FieldGroup } from "@/components/ui/field"

type Problem = { type: "field" } | { type: "message"; message: string }

/**
 * Ask for a password reset link. The answer is the same whether or not an
 * account uses the email, so the sent screen says "if".
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | undefined>()
  const [problem, setProblem] = useState<Problem | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [pending, setPending] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  function fail(next: Problem) {
    setPending(false)
    setProblem(next)
    setAttempt((n) => n + 1)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return

    const emailError = validateEmail(email)
    setError(emailError ?? undefined)
    if (emailError) {
      fail({ type: "field" })
      return
    }

    setProblem(null)
    setPending(true)
    const address = email.trim()
    const result = await postAuth("/api/auth/forgot-password", { email: address })
    if (result.ok) {
      setPending(false)
      setSentTo(address)
      return
    }
    if (result.kind === "fields") {
      setError(result.issues.email ?? FIELD_MESSAGES.emailInvalid)
      fail({ type: "field" })
      return
    }
    fail({
      type: "message",
      message:
        result.kind === "rate-limited"
          ? result.message
          : result.kind === "code" && result.code === EMAIL_NOT_CONFIGURED
            ? EMAIL_NOT_CONFIGURED_MESSAGES.resetLink
            : REQUEST_FAILED.resetLink,
    })
  }

  if (sentTo) {
    return (
      <AuthCard
        title="Check your email"
        headingRef={focusOnMount}
        description={
          <>
            If an account uses <EmailAddress>{sentTo}</EmailAddress>, a password reset link is on
            its way. The link lasts 1 hour.
          </>
        }
      >
        <p className="type-body-m text-on-surface-variant">
          Not in your inbox after a few minutes? Look in your spam folder, or check the address and
          send the link again.
        </p>
        <AuthActions>
          <Button variant="text" onClick={() => setSentTo(null)}>
            Use a different email
          </Button>
          <Button asChild>
            <Link href="/auth/signin">Back to sign in</Link>
          </Button>
        </AuthActions>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Reset password"
      description="Enter the email you sign in with, and a reset link goes to that address."
    >
      <form method="post" noValidate onSubmit={handleSubmit} className="flex flex-col gap-8">
        {problem?.type === "field" && error ? (
          <ErrorSummary key={attempt} items={[{ fieldId: "email", message: error }]} />
        ) : null}
        {problem?.type === "message" ? <ErrorSummary key={attempt} message={problem.message} /> : null}

        <FieldGroup>
          <AuthTextField
            id="email"
            name="email"
            type="email"
            label="Email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              if (error && !validateEmail(event.target.value)) setError(undefined)
            }}
            error={error}
          />
        </FieldGroup>

        <AuthActions>
          <Button variant="text" asChild>
            <Link href="/auth/signin">Back to sign in</Link>
          </Button>
          <SubmitButton pending={pending} pendingLabel="Sending reset link…">
            Send reset link
          </SubmitButton>
        </AuthActions>
        <PendingStatus message={pending ? "Sending reset link…" : null} />
      </form>
    </AuthCard>
  )
}
