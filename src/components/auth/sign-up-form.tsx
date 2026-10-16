"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { AuthActions, AuthCard } from "@/components/auth/auth-card"
import {
  AuthTextField,
  PendingStatus,
  ShowPasswordField,
  SubmitButton,
} from "@/components/auth/auth-fields"
import { postAuth } from "@/components/auth/auth-request"
import { withCallbackUrl } from "@/components/auth/callback-url"
import { signInWithCredentials } from "@/components/auth/credentials-sign-in"
import { ErrorSummary } from "@/components/auth/error-summary"
import { REQUEST_FAILED } from "@/lib/auth-messages"
import {
  NAME_MAX_LENGTH,
  PASSWORD_RULE,
  collectErrors,
  hasErrors,
  validateEmail,
  validateName,
  validateNewPassword,
  validatePasswordConfirmation,
  type FieldErrors,
} from "@/lib/auth-validation"
import { Button } from "@/components/ui/button"
import { FieldGroup } from "@/components/ui/field"

type Field = "name" | "email" | "password" | "confirmPassword"

const FIELD_IDS: Record<Field, string> = {
  name: "name",
  email: "email",
  password: "password",
  confirmPassword: "confirm-password",
}

type Problem =
  | { type: "fields" }
  | { type: "message"; message: string }
  /** Created (or the email was taken) but signing in with these details failed. */
  | { type: "sign-in"; message: string }

const EXISTING_ACCOUNT =
  "This email already has an account. Sign in with its password, or reset the password."
const SIGN_IN_AFTER_SIGNUP_FAILED = "Account created, but sign-in didn't finish. Sign in to continue."

function validate(values: Record<Field, string>): FieldErrors<Field> {
  return collectErrors<Field>({
    name: validateName(values.name),
    email: validateEmail(values.email),
    password: validateNewPassword(values.password),
    confirmPassword: validatePasswordConfirmation(values.password, values.confirmPassword),
  })
}

/**
 * Create an account. Without email verification the new account is signed
 * in and lands on Home (or the page it came from); with verification on,
 * it goes to the "verify your email" page.
 */
export function SignUpForm({
  callbackUrl,
  verificationRequired,
}: {
  callbackUrl: string
  verificationRequired: boolean
}) {
  const router = useRouter()
  const [values, setValues] = useState<Record<Field, string>>({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  })
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<FieldErrors<Field>>({})
  const [problem, setProblem] = useState<Problem | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [pending, setPending] = useState(false)

  function update(field: Field, value: string) {
    const next = { ...values, [field]: value }
    setValues(next)
    if (hasErrors(errors)) {
      // Clear errors that are now fixed; new ones wait for the next submit.
      const current = validate(next)
      setErrors((previous) => {
        const kept: FieldErrors<Field> = {}
        for (const key of Object.keys(previous) as Field[]) {
          if (previous[key] && current[key]) kept[key] = current[key]
        }
        return kept
      })
    }
  }

  function fail(next: Problem) {
    setPending(false)
    setProblem(next)
    setAttempt((n) => n + 1)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return

    const fieldErrors = validate(values)
    setErrors(fieldErrors)
    if (hasErrors(fieldErrors)) {
      fail({ type: "fields" })
      return
    }

    setProblem(null)
    setPending(true)
    const email = values.email.trim()
    const result = await postAuth("/api/auth/signup", {
      name: values.name.trim(),
      email,
      password: values.password,
    })

    if (!result.ok) {
      if (result.kind === "fields") {
        const serverErrors: FieldErrors<Field> = {}
        for (const field of ["name", "email", "password"] as const) {
          if (result.issues[field]) serverErrors[field] = result.issues[field]
        }
        if (hasErrors(serverErrors)) {
          setErrors(serverErrors)
          fail({ type: "fields" })
          return
        }
      }
      fail({
        type: "message",
        message: result.kind === "rate-limited" ? result.message : REQUEST_FAILED.signup,
      })
      return
    }

    if (verificationRequired) {
      router.push(`/auth/verify-email?email=${encodeURIComponent(email)}`)
      return
    }

    const outcome = await signInWithCredentials({ email, password: values.password, callbackUrl })
    if (outcome.status === "ok") {
      // A full load so Home and the account menu see the new session.
      window.location.assign(callbackUrl)
      return
    }
    if (outcome.status === "unverified") {
      router.push(`/auth/verify-email?email=${encodeURIComponent(email)}`)
      return
    }
    fail({
      type: "sign-in",
      message: outcome.status === "invalid" ? EXISTING_ACCOUNT : SIGN_IN_AFTER_SIGNUP_FAILED,
    })
  }

  const summaryItems =
    problem?.type === "fields"
      ? (Object.keys(FIELD_IDS) as Field[])
          .filter((field) => errors[field])
          .map((field) => ({ fieldId: FIELD_IDS[field], message: errors[field]! }))
      : []

  return (
    <AuthCard
      title="Create account"
      description="Plan for your exams and practice from your own course files."
    >
      <form method="post" noValidate onSubmit={handleSubmit} className="flex flex-col gap-8">
        {problem?.type === "fields" && summaryItems.length > 0 ? (
          <ErrorSummary key={attempt} items={summaryItems} />
        ) : null}
        {problem?.type === "message" ? <ErrorSummary key={attempt} message={problem.message} /> : null}
        {problem?.type === "sign-in" ? (
          <ErrorSummary key={attempt} message={problem.message}>
            <Button variant="outline" size="sm" asChild>
              <Link href={withCallbackUrl("/auth/signin", callbackUrl)}>Sign in</Link>
            </Button>
          </ErrorSummary>
        ) : null}

        <FieldGroup>
          <AuthTextField
            id={FIELD_IDS.name}
            name="name"
            label="Name"
            autoComplete="name"
            maxLength={NAME_MAX_LENGTH}
            autoFocus
            value={values.name}
            onChange={(event) => update("name", event.target.value)}
            error={errors.name}
          />
          <AuthTextField
            id={FIELD_IDS.email}
            name="email"
            type="email"
            label="Email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={values.email}
            onChange={(event) => update("email", event.target.value)}
            error={errors.email}
          />
          <AuthTextField
            id={FIELD_IDS.password}
            name="password"
            type={showPassword ? "text" : "password"}
            label="Password"
            description={PASSWORD_RULE}
            autoComplete="new-password"
            autoCapitalize="none"
            spellCheck={false}
            value={values.password}
            onChange={(event) => update("password", event.target.value)}
            error={errors.password}
          />
          <div className="flex flex-col gap-4">
            <AuthTextField
              id={FIELD_IDS.confirmPassword}
              name="confirm-password"
              type={showPassword ? "text" : "password"}
              label="Confirm password"
              autoComplete="new-password"
              autoCapitalize="none"
              spellCheck={false}
              value={values.confirmPassword}
              onChange={(event) => update("confirmPassword", event.target.value)}
              error={errors.confirmPassword}
            />
            <ShowPasswordField
              checked={showPassword}
              onCheckedChange={setShowPassword}
              controls={[FIELD_IDS.password, FIELD_IDS.confirmPassword]}
            />
          </div>
        </FieldGroup>

        <AuthActions>
          <Button variant="text" asChild>
            <Link href={withCallbackUrl("/auth/signin", callbackUrl)}>Sign in instead</Link>
          </Button>
          <SubmitButton pending={pending} pendingLabel="Creating account…">
            Create account
          </SubmitButton>
        </AuthActions>
        <PendingStatus message={pending ? "Creating account…" : null} />
      </form>
    </AuthCard>
  )
}
