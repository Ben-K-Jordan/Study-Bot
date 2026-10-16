"use client"

import * as React from "react"
import useSWR from "swr"

import type { ApiError } from "@/lib/client-api"
import { fetcher } from "@/lib/swr"

import { feedbackUrl } from "./api"
import type { FeedbackPayload } from "./types"

/** About 25 seconds of polling before the feedback counts as slow. */
const MAX_POLLS = 25
const POLL_MS = 1000

export type FeedbackStatus = "idle" | "loading" | "ready" | "empty" | "failed"

/**
 * Why feedback isn't on screen, so each case gets its own words:
 * the server couldn't write it ("unavailable"), the request failed
 * ("load"), or it was still being written when polling stopped ("slow").
 */
export type FeedbackFailure = "unavailable" | "load" | "slow"

function hasContent(data: FeedbackPayload): boolean {
  return Boolean(
    data.explanation ||
      data.reinforcement ||
      data.deeper_insight ||
      data.concept_connection ||
      data.mnemonic ||
      data.pattern_advice ||
      data.socratic_followup ||
      data.key_takeaway ||
      data.excerpts?.length
  )
}

export interface FeedbackState {
  status: FeedbackStatus
  /** Set when status is "failed". */
  failure: FeedbackFailure | null
  feedback: FeedbackPayload | null
  retry: () => void
  retrying: boolean
}

/** The status and failure reason for one poll result. Pure, unit-tested. */
export function feedbackStatus(input: {
  attemptId: string | null
  error: unknown
  data: FeedbackPayload | undefined
  polls: number
}): { status: FeedbackStatus; failure: FeedbackFailure | null } {
  const { attemptId, error, data, polls } = input
  if (!attemptId) return { status: "idle", failure: null }
  if (error) return { status: "failed", failure: "load" }
  if (!data) return { status: "loading", failure: null }
  if (data.status === "PENDING") {
    return polls >= MAX_POLLS ? { status: "failed", failure: "slow" } : { status: "loading", failure: null }
  }
  if (data.status === "OK") return { status: hasContent(data) ? "ready" : "empty", failure: null }
  return { status: "failed", failure: "unavailable" }
}

/**
 * Feedback for a recorded attempt. The server starts writing it when the
 * attempt lands; PENDING means it isn't ready yet, so this polls once a
 * second until it is, then stops. Failure, a stalled poll and "nothing in
 * your materials" are separate states, never one empty panel.
 */
export function useFeedback(attemptId: string | null): FeedbackState {
  const [polls, setPolls] = React.useState(0)
  const { data, error, mutate, isValidating } = useSWR<FeedbackPayload, ApiError>(
    attemptId ? feedbackUrl(attemptId) : null,
    fetcher<FeedbackPayload>,
    {
      refreshInterval: (latest) => (latest?.status === "PENDING" && polls < MAX_POLLS ? POLL_MS : 0),
      dedupingInterval: 500,
      revalidateOnFocus: false,
      onSuccess: (result) => {
        if (result.status === "PENDING") setPolls((n) => n + 1)
      },
    }
  )

  const { status, failure } = feedbackStatus({ attemptId, error, data, polls })

  const retry = React.useCallback(() => {
    setPolls(0)
    void mutate()
  }, [mutate])

  return {
    status,
    failure,
    feedback: data && data.status === "OK" ? data : null,
    retry,
    retrying: status === "failed" && isValidating,
  }
}
