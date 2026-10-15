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

  const send = useCallback(async (rawEmail: string) => {
    if (inFlight.current) return
    inFlight.current = true
    const email = rawEmail.trim()
    setState({ status: "sending" })
    const result = await postAuth("/api/auth/resend-verification", { email })
    inFlight.current = false

    if (result.ok) {
      setState({ status: "sent", email })
    } else if (result.kind === "fields") {
      setState({ status: "failed", message: result.issues.email ?? FIELD_MESSAGES.emailInvalid, fieldError: true })
    } else if (result.kind === "rate-limited") {
      setState({ status: "failed", message: result.message, fieldError: false })
    } else {
      setState({ status: "failed", message: REQUEST_FAILED.verificationLink, fieldError: false })
    }
  }, [])

  const reset = useCallback(() => setState({ status: "idle" }), [])

  return { state, send, reset }
}
