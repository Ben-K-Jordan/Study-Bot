"use client"

import * as React from "react"
import useSWRInfinite, { unstable_serialize } from "swr/infinite"
import { useSWRConfig } from "swr"

import type { ApiError } from "@/lib/client-api"
import { fetcher } from "@/lib/swr"
import type { ChatMessage, HistoryPage } from "@/components/chat/chat-types"

const PAGE_SIZE = 50

/** The SWR infinite key for a course's history: newest page first, then older pages by cursor. */
export function historyKey(courseKey: string | null) {
  return (index: number, previous: HistoryPage | null): string | null => {
    if (!courseKey) return null
    const base = `/api/chat/messages?courseKey=${encodeURIComponent(courseKey)}&limit=${PAGE_SIZE}`
    if (index === 0) return base
    if (!previous?.has_more || previous.messages.length === 0) return null
    return `${base}&before=${encodeURIComponent(previous.messages[0].id)}`
  }
}

/**
 * A course's chat history, newest 50 first, with older pages on demand.
 * The course is in the key, so switching courses never shows another
 * course's messages.
 */
export function useChatHistory(courseKey: string | null) {
  const getKey = React.useMemo(() => historyKey(courseKey), [courseKey])
  const { data, error, size, setSize, isLoading, mutate } = useSWRInfinite<HistoryPage, ApiError>(
    getKey,
    fetcher<HistoryPage>,
    { revalidateFirstPage: false, revalidateOnFocus: false }
  )

  const messages = React.useMemo(() => {
    if (!data) return undefined
    const seen = new Set<string>()
    const out: ChatMessage[] = []
    for (const page of [...data].reverse()) {
      for (const message of page.messages) {
        if (seen.has(message.id)) continue
        seen.add(message.id)
        out.push(message)
      }
    }
    return out
  }, [data])

  const last = data?.[data.length - 1]
  const hasMore = Boolean(last?.has_more)
  const loaded = data?.length ?? 0
  // A failed page leaves size one ahead of the data, so it isn't "loading" then.
  const loadingOlder = !error && loaded > 0 && size > loaded
  const total = data?.[0]?.total ?? 0

  return {
    messages,
    total,
    error,
    isLoading,
    hasMore,
    loadingOlder,
    loadOlder: () => setSize((s) => s + 1),
    /**
     * Fetches the older page that failed, once. setSize always revalidates
     * (SWR 2), so asking again for the size the failed request wanted
     * refetches only that page, where loadOlder would also ask for the page
     * after it. With no older page pending it just revalidates.
     */
    retryOlder: () => setSize(Math.min(size, loaded + 1)),
    mutate,
  }
}

/** The history pages with `added` at the end of the newest page (pages are newest first). */
export function appendToPages(pages: HistoryPage[] | undefined, added: ChatMessage[]): HistoryPage[] | undefined {
  if (!pages || pages.length === 0) return pages
  const [first, ...rest] = pages
  const known = new Set(first.messages.map((m) => m.id))
  const fresh = added.filter((m) => !known.has(m.id))
  return [{ ...first, messages: [...first.messages, ...fresh], total: first.total + fresh.length }, ...rest]
}

type GlobalMutate = ReturnType<typeof useSWRConfig>["mutate"]

/**
 * Adds saved messages to a course's history cache. A history that hasn't
 * loaded (still loading, or failed) has nothing to add to, so it's fetched
 * again instead, and the saved messages arrive with it.
 */
export function appendToHistory(mutate: GlobalMutate, courseKey: string, added: ChatMessage[]) {
  if (added.length === 0) return
  void mutate(
    unstable_serialize(historyKey(courseKey)),
    (pages: HistoryPage[] | undefined) => appendToPages(pages, added),
    { revalidate: (pages: HistoryPage[] | undefined) => !pages || pages.length === 0 }
  )
}

/**
 * Adds saved messages to a course's history cache, whichever course is on
 * screen. Messages go at the end of the newest page.
 */
export function useAppendToHistory() {
  const { mutate } = useSWRConfig()
  return React.useCallback(
    (courseKey: string, added: ChatMessage[]) => appendToHistory(mutate, courseKey, added),
    [mutate]
  )
}
