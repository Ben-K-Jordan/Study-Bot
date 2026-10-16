"use client"

import * as React from "react"
import {
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  FileTextIcon,
  HourglassIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { apiDelete } from "@/lib/client-api"
import { formatDate, formatList } from "@/lib/format"
import { AiTag } from "@/components/app/ai-tag"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Spinner } from "@/components/ui/spinner"
import { errorMessage } from "@/components/plan/api-errors"
import { fileKind } from "@/components/materials/file-rules"
import { processUntilSettled } from "@/components/materials/requests"
import type { MaterialDoc } from "@/components/materials/types"

function StatusBadge({ status, processing }: { status: string; processing: boolean }) {
  if (processing) {
    return (
      <Badge variant="secondary">
        <Spinner data-icon="inline-start" aria-hidden="true" role={undefined} />
        Processing…
      </Badge>
    )
  }
  if (status === "PROCESSED") {
    return (
      <Badge variant="success">
        <CircleCheckIcon data-icon="inline-start" aria-hidden="true" />
        Ready
      </Badge>
    )
  }
  if (status === "FAILED") {
    return (
      <Badge variant="destructive">
        <CircleAlertIcon data-icon="inline-start" aria-hidden="true" />
        Couldn&apos;t read this file
      </Badge>
    )
  }
  return (
    <Badge variant="outline">
      <HourglassIcon data-icon="inline-start" aria-hidden="true" />
      Uploaded
    </Badge>
  )
}

/**
 * One course file: name, kind, date and exam, status in words, its AI
 * summary behind a toggle, Retry or Finish processing when it isn't ready,
 * and Delete with a confirmation. While the file is being read (here, in the
 * upload list, or by another request) it shows Processing and no button.
 */
export function MaterialRow({
  doc,
  timeZone,
  busy = false,
  onChanged,
  onDeleted,
  returnFocus,
}: {
  doc: MaterialDoc
  timeZone: string
  /** The upload list on this page is still uploading or processing this file. */
  busy?: boolean
  /** After processing finishes or fails: refresh the list. */
  onChanged: () => void | Promise<unknown>
  /** After the file is deleted. */
  onDeleted: (doc: MaterialDoc) => void | Promise<unknown>
  /** Where focus goes after a delete, since this row (and its Delete button) leaves the page. */
  returnFocus?: React.RefObject<HTMLElement | null>
}) {
  const [processingHere, setProcessingHere] = React.useState(false)
  const [processError, setProcessError] = React.useState<string | null>(null)
  const pending = React.useRef<AbortController | null>(null)
  const name = doc.original_filename || doc.title
  const hasSummary = Boolean(doc.summary?.trim())
  const questions = (doc.suggested_questions ?? []).filter((q) => q.trim())
  const processing = processingHere || busy || doc.status === "PROCESSING"

  React.useEffect(() => () => pending.current?.abort(), [])

  async function process() {
    const controller = new AbortController()
    pending.current = controller
    setProcessingHere(true)
    setProcessError(null)
    try {
      const outcome = await processUntilSettled(doc.document_id, controller.signal)
      if (outcome === "PROCESSED") toast(`${name} ready`)
      else setProcessError(`Couldn't read ${name}. Check that it has selectable text, then retry.`)
      await onChanged()
    } catch (error) {
      if (controller.signal.aborted) return
      setProcessError(errorMessage(error, `${name} wasn't processed.`))
    } finally {
      if (!controller.signal.aborted) setProcessingHere(false)
    }
  }

  async function remove() {
    await apiDelete(`/api/content/documents/${doc.document_id}`)
    toast("File deleted")
    await onDeleted(doc)
  }

  const meta = formatList(
    [
      fileKind(name, doc.mime_type),
      `added ${formatDate(doc.created_at, { timeZone })}`,
      ...(doc.exam_name ? [`for ${doc.exam_name}`] : []),
    ],
    "unit"
  )

  const ready = doc.status === "PROCESSED"

  return (
    <Collapsible asChild disabled={!ready}>
      <li className="flex flex-col gap-2 px-4 py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <FileTextIcon className="mt-0.5 size-5 shrink-0 text-on-surface-variant" aria-hidden="true" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="truncate type-body-l text-on-surface" title={name}>
                {name}
              </p>
              <p className="type-body-s text-on-surface-variant">{meta}</p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 pl-8 sm:pl-0">
            <StatusBadge status={doc.status} processing={processing} />
            {ready ? (
              <CollapsibleTrigger asChild>
                <Button type="button" variant="text" size="sm" className="group/summary">
                  <ChevronDownIcon
                    data-icon="inline-start"
                    aria-hidden="true"
                    className="transition-transform duration-150 ease-standard group-data-[state=open]/summary:rotate-180"
                  />
                  Summary
                  <span className="sr-only"> of {name}</span>
                </Button>
              </CollapsibleTrigger>
            ) : !processing ? (
              <Button type="button" variant="text" size="sm" onClick={process}>
                <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
                {doc.status === "FAILED" ? "Retry" : "Finish processing"}
                <span className="sr-only"> {name}</span>
              </Button>
            ) : null}
            <ConfirmDialog
              trigger={
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${name}`}>
                  <Trash2Icon aria-hidden="true" />
                </Button>
              }
              title={`Delete ${name}?`}
              description={`It comes out of your ${doc.course_name ?? "course"} materials, so chat, new flashcards, and new guides stop using it. Decks and guides already made from it stay.`}
              confirmLabel="Delete file"
              pendingLabel="Deleting file…"
              failedMessage="File not deleted. Check your connection and retry."
              returnFocus={returnFocus}
              onConfirm={remove}
            />
          </div>
        </div>

        {processError ? (
          <p role="alert" className="flex items-start gap-2 pl-8 type-body-s text-error">
            <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {processError}
          </p>
        ) : null}

        {ready ? (
          <CollapsibleContent className="pt-2">
            {hasSummary ? (
              <div className="ml-8 flex max-w-prose flex-col gap-3 rounded-xl bg-surface-container-low p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="type-title-s text-on-surface">Summary</p>
                  <AiTag />
                </div>
                <p className="type-body-m text-pretty text-on-surface">{doc.summary}</p>
                {questions.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    <p className="type-label-l text-on-surface">Questions this file can answer</p>
                    <ul className="flex list-disc flex-col gap-1 pl-5 type-body-m text-on-surface-variant">
                      {questions.map((q, i) => (
                        <li key={`${i}-${q}`}>{q}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <p className="type-body-s text-on-surface-variant">
                  Written by AI from this file. Check it against the file before relying on it.
                </p>
              </div>
            ) : (
              <p className="ml-8 max-w-prose type-body-m text-on-surface-variant">
                No summary for this file. Chat, flashcards, and guides still use its text.
              </p>
            )}
          </CollapsibleContent>
        ) : null}
      </li>
    </Collapsible>
  )
}
