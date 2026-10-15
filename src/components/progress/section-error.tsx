"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"

import { ErrorState } from "@/components/app/error-state"

/**
 * A server-rendered section whose data didn't load. Retry re-runs the page's
 * server render without a full reload; the rest of the page stays put.
 */
export function SectionError({ title, className }: { title: string; className?: string }) {
  const router = useRouter()
  const [retrying, startRetry] = useTransition()
  return (
    <ErrorState
      title={title}
      description="Check your connection, then retry."
      onRetry={() => startRetry(() => router.refresh())}
      retrying={retrying}
      className={className}
    />
  )
}
