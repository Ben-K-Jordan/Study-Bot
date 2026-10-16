"use client"

import { useCallback, useRef, useState } from "react"

import { postAuth } from "@/components/auth/auth-request"
import { REQUEST_FAILED } from "@/components/auth/messages"
import { FIELD_MESSAGES } from "@/components/auth/validation"

export type ResendState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "sent"; email: string }
  | { status: "failed"; message: string; fieldError: boolean }

/**
 * Ask for a new verification link. Shared by the verify-email page and the
 * sign-in form's "verify your email first" error. A second click while one
 * request is out is ignored.
 */
export function useResendVerification() {
  const [state, setState] = useState<ResendState>({ status: "idle" })
  const inFlight = useRef(false)

  /** Resolves to the new state, or null when a request was already out. */
  const send = useCallback(async (rawEmail: string): Promise<ResendState | null> => {
    if (inFlight.current) return null
    inFlight.current = true
    const email = rawEmail.trim()
    setState({ status: "sending" })
    const result = await postAuth("/api/auth/resend-verification", { email })
    inFlight.current = false

    let next: ResendState
    if (result.ok) {
      next = { status: "sent", email }
    } else if (result.kind === "fields") {
      next = { status: "failed", message: result.issues.email ?? FIELD_MESSAGES.emailInvalid, fieldError: true }
    } else if (result.kind === "rate-limited") {
      next = { status: "failed", message: result.message, fieldError: false }
    } else {
      next = { status: "failed", message: REQUEST_FAILED.verificationLink, fieldError: false }
    }
    setState(next)
    return next
  }, [])

  const reset = useCallback(() => setState({ status: "idle" }), [])

  return { state, send, reset }
}
