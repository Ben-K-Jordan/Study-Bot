"use client"

import {
  CircleAlertIcon,
  CircleCheckIcon,
  FileTextIcon,
  HourglassIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import type { UploadEntry, UploadPhase } from "@/components/materials/use-material-uploads"

const PHASE_LABEL: Record<UploadPhase, string> = {
  queued: "Waiting to upload",
  uploading: "Uploading…",
  processing: "Processing…",
  waiting: "Waiting to process",
  ready: "Ready",
  failed: "Failed",
  rejected: "Not uploaded",
}

function PhaseBadge({ phase }: { phase: UploadPhase }) {
  if (phase === "ready") {
    return (
      <Badge variant="success">
        <CircleCheckIcon data-icon="inline-start" aria-hidden="true" />
        {PHASE_LABEL[phase]}
      </Badge>
    )
  }
  if (phase === "failed" || phase === "rejected") {
    return (
      <Badge variant="destructive">
        <CircleAlertIcon data-icon="inline-start" aria-hidden="true" />
        {PHASE_LABEL[phase]}
      </Badge>
    )
  }
  if (phase === "queued" || phase === "waiting") {
    return (
      <Badge variant="outline">
        <HourglassIcon data-icon="inline-start" aria-hidden="true" />
        {PHASE_LABEL[phase]}
      </Badge>
    )
  }
  return (
    <Badge variant="secondary">
      <Spinner data-icon="inline-start" aria-hidden="true" role={undefined} />
      {PHASE_LABEL[phase]}
    </Badge>
  )
}

/**
 * Files picked in this visit, with their status, Retry for the failed step,
 * and a button to take a row off the list. One polite live region announces
 * changes ("lecture-4.pdf ready") instead of a region per row.
 */
export function UploadList({
  entries,
  announcement,
  onRetry,
  onRemove,
  removeLabel = "Remove",
  showCourse = false,
  className,
}: {
  entries: UploadEntry[]
  announcement: string
  onRetry: (key: string) => void
  onRemove?: (key: string) => void
  /** Verb for the remove button: "Remove" (from this plan) or "Dismiss". */
  removeLabel?: string
  /** Say which course each file was saved to. */
  showCourse?: boolean
  className?: string
}) {
  return (
    <>
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </p>
      {entries.length > 0 ? (
        <ul className={cn("flex flex-col divide-y divide-outline-variant rounded-2xl ring-1 ring-outline-variant", className)}>
          {entries.map((entry) => {
            const busy =
              entry.phase === "uploading" ||
              entry.phase === "processing" ||
              entry.phase === "queued" ||
              entry.phase === "waiting"
            return (
              <li key={entry.key} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <FileTextIcon className="mt-0.5 size-5 shrink-0 text-on-surface-variant" aria-hidden="true" />
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="truncate type-body-l text-on-surface" title={entry.name}>
                      {entry.name}
                    </p>
                    {showCourse && entry.phase !== "rejected" ? (
                      <p className="type-body-s text-on-surface-variant">
                        Saved to {entry.courseName}
                        {entry.examName ? `, ${entry.examName}` : ""}
                      </p>
                    ) : null}
                    {entry.note ? (
                      <p
                        className={cn(
                          "type-body-s",
                          entry.phase === "failed" || entry.phase === "rejected"
                            ? "text-error"
                            : "text-on-surface-variant"
                        )}
                      >
                        {entry.note}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2 pl-8 sm:pl-0">
                  <PhaseBadge phase={entry.phase} />
                  {entry.phase === "failed" ? (
                    <Button type="button" variant="text" size="sm" onClick={() => onRetry(entry.key)}>
                      <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
                      Retry
                      <span className="sr-only"> {entry.name}</span>
                    </Button>
                  ) : null}
                  {onRemove && !busy ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onRemove(entry.key)}
                      aria-label={`${removeLabel} ${entry.name}`}
                    >
                      <XIcon aria-hidden="true" />
                    </Button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}
    </>
  )
}
