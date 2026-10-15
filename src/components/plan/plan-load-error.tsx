"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { ErrorState } from "@/components/app/error-state"

/** A failed server read on a Plan screen, with Retry that re-runs it. */
export function PlanLoadError({
  title,
  description,
  reference,
}: {
  title: string
  description?: string
  reference?: string
}) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()

  return (
    <ErrorState
      title={title}
      description={description}
      reference={reference}
      retrying={pending}
      onRetry={() => startTransition(() => router.refresh())}
    />
  )
}
