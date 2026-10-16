"use client"

import { useId, useState } from "react"
import Link from "next/link"
import { CircleCheckIcon } from "lucide-react"

import { AuthActions, AuthCard, EmailAddress, focusOnMount } from "@/components/auth/auth-card"
import {
  AuthTextField,
  PendingStatus,
  ShowPasswordField,
  SubmitButton,
} from "@/components/auth/auth-fields"
import { withCallbackUrl } from "@/components/auth/callback-url"
import { signInWithCredentials } from "@/components/auth/credentials-sign-in"
import { ErrorSummary } from "@/components/auth/error-summary"
import { signInFailureMessage, type SignInFailure } from "@/lib/auth-messages"
import { useResendVerification } from "@/components/auth/use-resend-verification"
import {
  collectErrors,
  hasErrors,
  validateCurrentPassword,
  validateEmail,
  type FieldErrors,
} from "@/lib/auth-validation"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { FieldGroup } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"

type Field = "email" | "password"

type Problem =
  | { type: "fields" }
  | { type: "sign-in"; failure: SignInFailure }
  | { type: "banner"; message: string }

const FIELD_IDS: Record<Field, string> = { email: "email", password: "password" }
const VALIDATORS: Record<Field, (value: string) => string | null> = {
  email: validateEmail,
  password: validateCurrentPassword,
}

/**
 * Sign in with email and password. Every outcome ends in something on
 * screen (rate limit, offline, unverified email included), so the button
 * never stays on "Signing in…".
 */
export function SignInForm({
  callbackUrl,
  verified,
  accountDeleted = false,
  initialError,
}: {
  callbackUrl: string
  /** Arrived from a verification link that worked. */
  verified: boolean
  /** Arrived from Settings after deleting the account. */
  accountDeleted?: boolean
  /** Text for a ?error= code from next-auth, already mapped to plain words. */
  initialError: string | null
}) {
  const [values, setValues] = useState<Record<Field, string>>({ email: "", password: "" })
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<FieldErrors<Field>>({})
  const [problem, setProblem] = useState<Problem | null>(
    initialError ? { type: "banner", message: initialError } : null
  )
  const [attempt, setAttempt] = useState(0)
  // Bumped when "Send a new link" fails, so the summary remounts, takes
  // focus and reads the new message (it isn't a live region).
  const [resendFailures, setResendFailures] = useState(0)
  const [pending, setPending] = useState(false)
  const resend = useResendVerification()
  const linkSentId = useId()

  async function sendNewLink() {
    const result = await resend.send(values.email)
    if (result?.status === "failed") setResendFailures((n) => n + 1)
  }

  function update(field: Field, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
    // Clear a field's error once it's fixed; new errors wait for the next submit.
    if (errors[field] && !VALIDATORS[field](value)) {
      setErrors((current) => ({ ...current, [field]: undefined }))
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return

    const fieldErrors = collectErrors<Field>({
      email: validateEmail(values.email),
      password: validateCurrentPassword(values.password),
    })
    setErrors(fieldErrors)
    setAttempt((n) => n + 1)
    if (hasErrors(fieldErrors)) {
      setProblem({ type: "fields" })
      return
    }

    setProblem(null)
    resend.reset()
    setPending(true)
    const outcome = await signInWithCredentials({
      email: values.email.trim(),
      password: values.password,
      callbackUrl,
    })
    if (outcome.status === "ok") {
      // A full load so every server component and the session menu start fresh.
      window.location.assign(callbackUrl)
      return
    }
    setPending(false)
    setProblem({ type: "sign-in", failure: outcome })
  }

  const summaryItems =
    problem?.type === "fields"
      ? (Object.keys(FIELD_IDS) as Field[])
          .filter((field) => errors[field])
          .map((field) => ({ fieldId: FIELD_IDS[field], message: errors[field]! }))
      : []

  return (
    <AuthCard title="Sign in" description="Use your Study Bot account.">
      <form method="post" noValidate onSubmit={handleSubmit} className="flex flex-col gap-8">
        {verified && !problem ? (
          <Alert variant="success" role="status">
            <CircleCheckIcon aria-hidden="true" />
            <AlertTitle>Email verified</AlertTitle>
            <AlertDescription>Sign in to continue.</AlertDescription>
          </Alert>
        ) : null}
        {accountDeleted && !verified && !problem ? (
          <Alert variant="success" role="status">
            <CircleCheckIcon aria-hidden="true" />
            <AlertTitle>Account deleted</AlertTitle>
            <AlertDescription>Your plans, sessions, materials, and chat history are gone.</AlertDescription>
          </Alert>
        ) : null}

        {problem?.type === "fields" && summaryItems.length > 0 ? (
          <ErrorSummary key={attempt} items={summaryItems} />
        ) : null}
        {problem?.type === "banner" ? <ErrorSummary message={problem.message} focus={false} /> : null}
        {problem?.type === "sign-in" ? (
          problem.failure.status === "unverified" && resend.state.status === "sent" ? (
            // Replaces the summary whose button had focus, so it takes focus
            // itself (and is a group, not a status, so it's read once).
            <Alert
              variant="success"
              ref={focusOnMount}
              tabIndex={-1}
              role="group"
              aria-labelledby={`${linkSentId}-title`}
              aria-describedby={`${linkSentId}-description`}
            >
              <CircleCheckIcon aria-hidden="true" />
              <AlertTitle id={`${linkSentId}-title`}>New link sent</AlertTitle>
              <AlertDescription id={`${linkSentId}-description`}>
                It went to <EmailAddress className="text-current">{resend.state.email}</EmailAddress> and lasts 24 hours.
                Open it, then sign in.
              </AlertDescription>
            </Alert>
          ) : (
            <ErrorSummary
              key={`${attempt}-${resendFailures}`}
              message={
                resend.state.status === "failed"
                  ? resend.state.message
                  : signInFailureMessage(problem.failure)
              }
            >
              {problem.failure.status === "unverified" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={resend.state.status === "sending"}
                  onClick={() => void sendNewLink()}
                >
                  {resend.state.status === "sending" ? (
                    <>
                      <Spinner data-icon="inline-start" aria-hidden="true" role={undefined} />
                      Sending link…
                    </>
                  ) : (
                    "Send a new link"
                  )}
                </Button>
              ) : null}
            </ErrorSummary>
          )
        ) : null}

        <FieldGroup>
          <AuthTextField
            id={FIELD_IDS.email}
            name="email"
            type="email"
            label="Email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus={!problem && !verified}
            value={values.email}
            onChange={(event) => update("email", event.target.value)}
            error={errors.email}
          />
          <div className="flex flex-col gap-4">
            <AuthTextField
              id={FIELD_IDS.password}
              name="password"
              type={showPassword ? "text" : "password"}
              label="Password"
              autoComplete="current-password"
              autoCapitalize="none"
              spellCheck={false}
              value={values.password}
              onChange={(event) => update("password", event.target.value)}
              error={errors.password}
            />
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <ShowPasswordField
                checked={showPassword}
                onCheckedChange={setShowPassword}
                controls={[FIELD_IDS.password]}
              />
              <Button variant="link" asChild className="min-h-6">
                <Link href="/auth/forgot-password">Forgot password?</Link>
              </Button>
            </div>
          </div>
        </FieldGroup>

        <AuthActions>
          <Button variant="text" asChild>
            <Link href={withCallbackUrl("/auth/signup", callbackUrl)}>Create account</Link>
          </Button>
          <SubmitButton pending={pending} pendingLabel="Signing in…">
            Sign in
          </SubmitButton>
        </AuthActions>
        <PendingStatus message={pending ? "Signing in…" : null} />
      </form>
    </AuthCard>
  )
}
