"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { ErrorState } from "@/components/app/error-state"

/**
 * A failed server-rendered load: says what didn't load and re-runs the
 * page's server render on Retry.
 */
export function RefreshErrorState({ title, description }: { title: string; description?: string }) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  return (
    <ErrorState
      title={title}
      description={description ?? "Retry in a minute. If it keeps failing, reload the page."}
      retrying={pending}
      onRetry={() => startTransition(() => router.refresh())}
    />
  )
}
