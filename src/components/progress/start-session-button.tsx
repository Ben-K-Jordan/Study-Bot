"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { DumbbellIcon, WrenchIcon } from "lucide-react"

import { ApiError, apiPost, SIGNED_OUT_MESSAGE } from "@/lib/client-api"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import type { SessionRequest } from "@/components/progress/session-request"

function failureMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return SIGNED_OUT_MESSAGE
    if (error.status === 429) return "Too many requests. Retry in a few seconds."
  }
  return "Session not started. Retry."
}

const KINDS = {
  repair: { label: "Repair", icon: WrenchIcon },
  practice: { label: "Practice", icon: DumbbellIcon },
} as const

/**
 * Creates a session for a weak spot and opens it. Stays busy until the
 * session page takes over, and says so inline when the session can't start.
 */
export function StartSessionButton({
  request,
  kind,
  accessibleLabel,
  className,
}: {
  request: SessionRequest
  /** Repair errors or practice a topic; sets the visible verb and icon. */
  kind: keyof typeof KINDS
  /** Full name that starts with the visible verb: "Practice CSS specificity". */
  accessibleLabel: string
  className?: string
}) {
  const { label, icon: Icon } = KINDS[kind]
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const [navigating, startNavigation] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const busy = creating || navigating

  async function start() {
    if (busy) return
    setCreating(true)
    setError(null)
    try {
      const body = (await apiPost("/api/sessions", request)) as { session_id: string }
      startNavigation(() => router.push(`/s/${body.session_id}`))
    } catch (err) {
      setError(failureMessage(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className={cn("flex flex-col items-end gap-1", className)}>
      <Button
        variant="outline"
        size="sm"
        onClick={start}
        disabled={busy}
        aria-label={busy ? `Starting session: ${accessibleLabel}` : accessibleLabel}
      >
        {busy ? (
          <Spinner data-icon="inline-start" aria-hidden="true" role={undefined} />
        ) : (
          <Icon data-icon="inline-start" aria-hidden="true" />
        )}
        {busy ? "Starting…" : label}
      </Button>
      <p role="alert" className="max-w-56 text-right type-body-s text-error empty:hidden">
        {error}
      </p>
    </div>
  )
}
