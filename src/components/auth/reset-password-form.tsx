"use client"

import { useState } from "react"
import Link from "next/link"

import { AuthActions, AuthCard, focusOnMount } from "@/components/auth/auth-card"
import {
  AuthTextField,
  PendingStatus,
  ShowPasswordField,
  SubmitButton,
} from "@/components/auth/auth-fields"
import { postAuth } from "@/components/auth/auth-request"
import { ErrorSummary } from "@/components/auth/error-summary"
import {
  RESET_LINK_PROBLEMS,
  RESET_PASSWORD_TITLE,
  type ResetLinkProblem,
} from "@/components/auth/link-copy"
import { REQUEST_FAILED } from "@/lib/auth-messages"
import {
  PASSWORD_RULE,
  collectErrors,
  hasErrors,
  validateNewPassword,
  validatePasswordConfirmation,
  type FieldErrors,
} from "@/lib/auth-validation"
import { Button } from "@/components/ui/button"
import { FieldGroup } from "@/components/ui/field"

type Field = "password" | "confirmPassword"

const FIELD_IDS: Record<Field, string> = { password: "password", confirmPassword: "confirm-password" }

const CODE_TO_PROBLEM: Record<string, ResetLinkProblem> = {
  TOKEN_EXPIRED: "expired",
  TOKEN_USED: "used",
  TOKEN_INVALID: "invalid",
}

type Problem = { type: "fields" } | { type: "message"; message: string }

function validate(values: Record<Field, string>): FieldErrors<Field> {
  return collectErrors<Field>({
    password: validateNewPassword(values.password),
    confirmPassword: validatePasswordConfirmation(values.password, values.confirmPassword),
  })
}

/**
 * Choose a new password from the emailed link. The page checks the link
 * first, so an expired or used link shows its own screen with a way to get
 * a new one instead of failing after the form is filled in.
 */
export function ResetPasswordForm({
  token,
  initialProblem,
}: {
  token: string
  initialProblem: ResetLinkProblem | null
}) {
  const [values, setValues] = useState<Record<Field, string>>({ password: "", confirmPassword: "" })
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<FieldErrors<Field>>({})
  const [problem, setProblem] = useState<Problem | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [pending, setPending] = useState(false)
  const [linkProblem, setLinkProblem] = useState<ResetLinkProblem | null>(initialProblem)
  // Views reached by an action take focus; the one the page opened with doesn't.
  const [moved, setMoved] = useState(false)
  const [done, setDone] = useState(false)

  function update(field: Field, value: string) {
    const next = { ...values, [field]: value }
    setValues(next)
    if (hasErrors(errors)) {
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
    const result = await postAuth("/api/auth/reset-password", { token, password: values.password })
    if (result.ok) {
      setPending(false)
      setMoved(true)
      setDone(true)
      return
    }
    if (result.kind === "code" && CODE_TO_PROBLEM[result.code]) {
      setPending(false)
      setMoved(true)
      setLinkProblem(CODE_TO_PROBLEM[result.code])
      return
    }
    if (result.kind === "fields" && result.issues.password) {
      setErrors({ password: result.issues.password })
      fail({ type: "fields" })
      return
    }
    fail({
      type: "message",
      message: result.kind === "rate-limited" ? result.message : REQUEST_FAILED.resetPassword,
    })
  }

  if (done) {
    return (
      <AuthCard
        title="Password updated"
        description="Sign in with your new password."
        headingRef={focusOnMount}
      >
        <AuthActions>
          <Button asChild>
            <Link href="/auth/signin">Sign in</Link>
          </Button>
        </AuthActions>
      </AuthCard>
    )
  }

  if (linkProblem) {
    const copy = RESET_LINK_PROBLEMS[linkProblem]
    return (
      <AuthCard
        title={copy.title}
        description={copy.description}
        headingRef={moved ? focusOnMount : undefined}
      >
        <AuthActions>
          <Button variant="text" asChild>
            <Link href="/auth/signin">Back to sign in</Link>
          </Button>
          <Button asChild>
            <Link href="/auth/forgot-password">Request a new link</Link>
          </Button>
        </AuthActions>
      </AuthCard>
    )
  }

  const summaryItems =
    problem?.type === "fields"
      ? (Object.keys(FIELD_IDS) as Field[])
          .filter((field) => errors[field])
          .map((field) => ({ fieldId: FIELD_IDS[field], message: errors[field]! }))
      : []

  return (
    <AuthCard title={RESET_PASSWORD_TITLE} description="Your new password replaces the old one.">
      <form method="post" noValidate onSubmit={handleSubmit} className="flex flex-col gap-8">
        {problem?.type === "fields" && summaryItems.length > 0 ? (
          <ErrorSummary key={attempt} items={summaryItems} />
        ) : null}
        {problem?.type === "message" ? <ErrorSummary key={attempt} message={problem.message} /> : null}

        <FieldGroup>
          <AuthTextField
            id={FIELD_IDS.password}
            name="password"
            type={showPassword ? "text" : "password"}
            label="New password"
            description={PASSWORD_RULE}
            autoComplete="new-password"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            value={values.password}
            onChange={(event) => update("password", event.target.value)}
            error={errors.password}
          />
          <div className="flex flex-col gap-4">
            <AuthTextField
              id={FIELD_IDS.confirmPassword}
              name="confirm-password"
              type={showPassword ? "text" : "password"}
              label="Confirm new password"
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
            <Link href="/auth/signin">Back to sign in</Link>
          </Button>
          <SubmitButton pending={pending} pendingLabel="Resetting password…">
            Reset password
          </SubmitButton>
        </AuthActions>
        <PendingStatus message={pending ? "Resetting password…" : null} />
      </form>
    </AuthCard>
  )
}
