"use client"

import { useState } from "react"
import { CheckIcon, DownloadIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { ApiError } from "@/lib/client-api"
import { failureMessage, retryAfterSeconds } from "./request"
import { SettingsRow, SettingsRows, SettingsSection } from "./settings-section"

const EXPORT_URL = "/api/account/export"
const NOT_EXPORTED = "Data not exported. Check your connection and retry."

type ExportState = { kind: "idle" } | { kind: "exporting" } | { kind: "done" } | { kind: "failed"; message: string }

function fileNameFrom(disposition: string | null): string {
  const match = disposition?.match(/filename="?([^";]+)"?/i)
  return match?.[1] ?? "study-bot-export.json"
}

/** Downloads the export as a file without leaving the page. */
async function downloadExport(): Promise<void> {
  const res = await fetch(EXPORT_URL, { signal: AbortSignal.timeout(120_000) })
  if (!res.ok) {
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      body = null
    }
    const seconds = retryAfterSeconds(null, res.headers.get("Retry-After"))
    const withRetry =
      seconds && body && typeof body === "object" ? { retry_after_seconds: seconds, ...body } : body
    const message = (body as { error?: unknown } | null)?.error
    throw new ApiError(typeof message === "string" ? message : "Request failed", res.status, withRetry)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  try {
    const link = document.createElement("a")
    link.href = url
    link.download = fileNameFrom(res.headers.get("Content-Disposition"))
    document.body.append(link)
    link.click()
    link.remove()
  } finally {
    // Give the browser a moment to start the download before releasing it.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
}

/** Export everything as JSON. */
export function DataSection() {
  const [state, setState] = useState<ExportState>({ kind: "idle" })
  const exporting = state.kind === "exporting"

  async function handleExport() {
    if (exporting) return
    setState({ kind: "exporting" })
    try {
      await downloadExport()
      setState({ kind: "done" })
    } catch (err) {
      setState({ kind: "failed", message: failureMessage(err, NOT_EXPORTED) })
    }
  }

  return (
    <SettingsSection id="data" title="Data">
      <SettingsRows>
        <SettingsRow
          title="Export your data"
          description="A JSON file with your plans, sessions, answers, errors, materials, decks, guides, chat history, and progress. Larger accounts take longer."
        >
          <div className="flex flex-col gap-2">
            <Button type="button" variant="outline" className="self-start" onClick={handleExport} disabled={exporting}>
              {exporting ? (
                <Spinner data-icon="inline-start" aria-hidden="true" role={undefined} />
              ) : (
                <DownloadIcon data-icon="inline-start" aria-hidden="true" />
              )}
              {exporting ? "Exporting…" : "Export data (.json)"}
            </Button>
            <p role="status" className="empty:hidden flex items-center gap-1.5 type-body-m text-on-surface-variant">
              {exporting ? <span className="sr-only">Exporting your data…</span> : null}
              {state.kind === "done" ? (
                <>
                  <CheckIcon className="size-4 text-tertiary" aria-hidden="true" />
                  Data exported. Check your downloads.
                </>
              ) : null}
            </p>
            {state.kind === "failed" ? <FieldError>{state.message}</FieldError> : null}
          </div>
        </SettingsRow>
      </SettingsRows>
    </SettingsSection>
  )
}
