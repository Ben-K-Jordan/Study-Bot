"use client"

import { CircleAlertIcon, RotateCcwIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

/**
 * A failed load or action, with Retry. Says what didn't happen ("Decks
 * didn't load.") and never borrows empty-state copy. Announced with
 * role="alert".
 */
export function ErrorState({
  title,
  description,
  onRetry,
  retrying = false,
  retryLabel = "Retry",
  reference,
  className,
}: {
  /** What didn't happen, as a sentence: "Plans didn't load." */
  title: string
  /** The fix, when there is one beyond retrying. */
  description?: React.ReactNode
  onRetry?: () => void
  retrying?: boolean
  retryLabel?: string
  /** An error digest or request id, shown as "Reference: …". */
  reference?: string
  className?: string
}) {
  return (
    <Alert variant="destructive" role="alert" className={className}>
      <CircleAlertIcon aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      {description || reference ? (
        <AlertDescription>
          {description}
          {reference ? (
            <span className="mt-1 block font-mono text-xs opacity-80">Reference: {reference}</span>
          ) : null}
        </AlertDescription>
      ) : null}
      {onRetry ? (
        <div className="col-start-2 -ml-3 pt-1">
          <Button variant="text" size="sm" onClick={onRetry} disabled={retrying} className="text-current">
            {retrying ? (
              <Spinner data-icon="inline-start" aria-hidden="true" role={undefined} />
            ) : (
              <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
            )}
            {retrying ? "Retrying…" : retryLabel}
          </Button>
        </div>
      ) : null}
    </Alert>
  )
}
