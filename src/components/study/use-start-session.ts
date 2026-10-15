"use client"

import { useCallback, useRef, useState } from "react"
import { useRouter } from "next/navigation"

import { apiPost } from "@/lib/client-api"
import { describeRequestError } from "@/components/study/request-errors"
import type { SessionLength, StudyModeKey } from "@/components/study/study-modes"
import type { StartSessionResponse } from "@/components/study/types"

export interface StartSessionInput {
  courseName: string
  examName: string | null
  mode: StudyModeKey
  minutes: SessionLength
}

type StartState =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "opening" }
  | { status: "failed"; message: string }

/**
 * Creates (or reuses) a session once and opens it. A second click while the
 * first request is in flight, or while the session page loads, does nothing;
 * the server also hands back the same unstarted session for a repeat start.
 */
export function useStartSession() {
  const router = useRouter()
  const inFlight = useRef(false)
  const [state, setState] = useState<StartState>({ status: "idle" })

  const start = useCallback(
    async (input: StartSessionInput) => {
      if (inFlight.current) return
      inFlight.current = true
      setState({ status: "starting" })
      try {
        const result = (await apiPost("/api/learn/start", {
          course_name: input.courseName,
          exam_name: input.examName ?? undefined,
          mode: input.mode,
          minutes: input.minutes,
        })) as StartSessionResponse
        // Always a path on this origin, whatever the server's base URL is.
        const url =
          typeof result?.url === "string" && result.url.startsWith("/s/")
            ? result.url
            : `/s/${encodeURIComponent(result.session_id)}`
        setState({ status: "opening" })
        router.push(url)
      } catch (error) {
        inFlight.current = false
        setState({ status: "failed", message: describeRequestError(error) })
      }
    },
    [router]
  )

  const reset = useCallback(() => {
    if (!inFlight.current) setState({ status: "idle" })
  }, [])

  return { state, start, reset }
}
