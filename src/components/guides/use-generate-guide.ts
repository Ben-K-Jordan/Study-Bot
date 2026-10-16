"use client"

import { useCallback, useRef, useState } from "react"
import { useSWRConfig } from "swr"

import { ApiError } from "@/lib/client-api"
import { describeRequestError } from "@/components/study/request-errors"
import type { GuideType } from "@/lib/guide-format"
import type { GuidesResponse, StudyGuide } from "@/components/guides/types"

export type GuideJob = { status: "pending" } | { status: "failed"; message: string }

/** One generation slot per course (and exam) and format. */
export function guideJobKey(courseKey: string, type: GuideType): string {
  return `${courseKey}::${type}`
}

// Generation can take a while on the real model; allow two minutes.
const GENERATE_TIMEOUT_MS = 120_000

async function postGuide(body: { course_name: string; exam_name?: string; guide_type: GuideType }) {
  const res = await fetch("/api/guides", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
  })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!res.ok) {
    const message = (data as { error?: unknown } | null)?.error
    throw new ApiError(typeof message === "string" ? message : "Guide not generated.", res.status, data)
  }
  return data as StudyGuide
}

function without(jobs: Record<string, GuideJob>, key: string) {
  const next = { ...jobs }
  delete next[key]
  return next
}

/**
 * Generates guides. Each course and format has its own slot, so switching
 * course mid-generation neither blocks the other course nor drops the
 * result: the new guide lands in its own course's cached list.
 */
export function useGenerateGuide() {
  const { mutate } = useSWRConfig()
  const [jobs, setJobs] = useState<Record<string, GuideJob>>({})
  const inFlight = useRef(new Set<string>())

  const generate = useCallback(
    async (input: {
      key: string
      listUrl: string
      courseName: string
      examName: string | null
      type: GuideType
      onReady?: (guide: StudyGuide) => void
    }) => {
      if (inFlight.current.has(input.key)) return
      inFlight.current.add(input.key)
      setJobs((current) => ({ ...current, [input.key]: { status: "pending" } }))
      try {
        const guide = await postGuide({
          course_name: input.courseName,
          exam_name: input.examName ?? undefined,
          guide_type: input.type,
        })
        await mutate<GuidesResponse>(
          input.listUrl,
          (current) => ({ guides: [guide, ...(current?.guides ?? []).filter((g) => g.id !== guide.id)] }),
          { revalidate: false }
        )
        setJobs((current) => without(current, input.key))
        input.onReady?.(guide)
      } catch (error) {
        const timedOut = error instanceof DOMException && error.name === "TimeoutError"
        // A slow generation may still finish on the server: refresh the list.
        if (timedOut) void mutate(input.listUrl)
        setJobs((current) => ({
          ...current,
          [input.key]: {
            status: "failed",
            message: timedOut
              ? "Generation took longer than 2 minutes. If it finishes, the guide shows up here."
              : describeRequestError(error),
          },
        }))
      } finally {
        inFlight.current.delete(input.key)
      }
    },
    [mutate]
  )

  const dismiss = useCallback((key: string) => {
    setJobs((current) => without(current, key))
  }, [])

  return { jobs, generate, dismiss }
}
