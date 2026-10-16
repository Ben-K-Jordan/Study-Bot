"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { SnowflakeIcon } from "lucide-react"

import { ApiError, apiPost } from "@/lib/client-api"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

function failureMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Your sign-in expired. Sign in again."
    // 409 carries a full sentence: none left, already used, or studied today.
    if (error.status === 409 && error.message) return error.message
  }
  return "Freeze not used. Retry."
}

/** Spends one streak freeze on today, then refreshes Progress. */
export function UseFreezeButton() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [refreshing, startRefresh] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const busy = saving || refreshing

  async function spendFreeze() {
    if (busy) return
    setSaving(true)
    setError(null)
    try {
      await apiPost("/api/stats/streak-freeze", {})
      startRefresh(() => router.refresh())
    } catch (err) {
      setError(failureMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="secondary" onClick={spendFreeze} disabled={busy}>
        {busy ? (
          <Spinner data-icon="inline-start" aria-hidden="true" role={undefined} />
        ) : (
          <SnowflakeIcon data-icon="inline-start" aria-hidden="true" />
        )}
        {busy ? "Using freeze…" : "Use a freeze today"}
      </Button>
      <p role="alert" className="type-body-s text-error empty:hidden">
        {error}
      </p>
    </div>
  )
}
