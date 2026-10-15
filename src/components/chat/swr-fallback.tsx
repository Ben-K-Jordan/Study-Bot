"use client"

import { SWRConfig } from "swr"

/** Seeds the client cache with data the server already read (keyed by API URL). */
export function SwrFallback({
  fallback,
  children,
}: {
  fallback: Record<string, unknown>
  children: React.ReactNode
}) {
  return <SWRConfig value={{ fallback }}>{children}</SWRConfig>
}
