"use client"

import * as React from "react"
import useSWR from "swr"

import type { ApiError } from "@/lib/client-api"
import { fetcher } from "@/lib/swr"

import { feedbackUrl } from "./api"
import type { FeedbackPayload } from "./types"

/** About 25 seconds of polling before the feedback counts as unavailable. */
const MAX_POLLS = 25
const POLL_MS = 1000

export type FeedbackStatus = "idle" | "loading" | "ready" | "empty" | "failed"

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

/**
 * Feedback for a recorded attempt. The server starts writing it when the
 * attempt lands; PENDING means it isn't ready yet, so this polls once a
 * second until it is, then stops. Failure, a stalled poll and "nothing in
 * your materials" are separate states, never one empty panel.
 */
export function useFeedback(attemptId: string | null) {
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

  let status: FeedbackStatus
  if (!attemptId) status = "idle"
  else if (error) status = "failed"
  else if (!data) status = "loading"
  else if (data.status === "PENDING") status = polls >= MAX_POLLS ? "failed" : "loading"
  else if (data.status === "OK") status = hasContent(data) ? "ready" : "empty"
  else status = "failed"

  const retry = React.useCallback(() => {
    setPolls(0)
    void mutate()
  }, [mutate])

  return {
    status,
    feedback: data && data.status === "OK" ? data : null,
    retry,
    retrying: status === "failed" && isValidating,
  }
}
