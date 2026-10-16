"use client"

import { SWRConfig, useSWRConfig, type Middleware } from "swr"

/**
 * Data the server just read stays as it is: a hook whose key the page
 * seeded skips its fetch on mount, unless the client cache already holds
 * that key (from an earlier visit or another component), which may be older
 * than the page and is revalidated as usual. Other keys are untouched.
 */
const keepServerData: Middleware = (useSWRNext) =>
  function useServerSeededSWR(key, fetcher, config) {
    const { cache, fallback } = useSWRConfig()
    const seeded =
      typeof key === "string" && fallback[key] !== undefined && cache.get(key)?.data === undefined
    return useSWRNext(key, fetcher, seeded ? { ...config, revalidateOnMount: false } : config)
  }

const USE = [keepServerData]

/** Seeds the client cache with data the server already read (keyed by API URL). */
export function SwrFallback({
  fallback,
  children,
}: {
  fallback: Record<string, unknown>
  children: React.ReactNode
}) {
  return <SWRConfig value={{ fallback, use: USE }}>{children}</SWRConfig>
}
