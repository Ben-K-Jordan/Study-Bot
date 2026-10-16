"use client"

import * as React from "react"

import { errorMessage, readJson } from "@/components/plan/api-errors"
import { fileProblem } from "@/components/materials/file-rules"
import { anySignal, processUntilSettled } from "@/components/materials/requests"

/**
 * queued: waiting for the files before it; uploading; processing (reading
 * the file into sections); waiting (rate limited, retries by itself);
 * ready; failed (with Retry); rejected (wrong type or size, never sent).
 */
export type UploadPhase =
  | "queued"
  | "uploading"
  | "processing"
  | "waiting"
  | "ready"
  | "failed"
  | "rejected"

export interface UploadEntry {
  /** Client key: unique even when two picks are the same file. */
  key: string
  name: string
  phase: UploadPhase
  /** Course and exam the file is saved under. */
  courseName: string
  examName?: string
  documentId?: string
  /** Which step failed, so Retry repeats only that step. */
  failedStep?: "upload" | "process"
  /** A sentence under the file name: why it failed, a wait, or the duplicate note. */
  note?: string
  /**
   * "Already in your materials": kept apart from `note` so a ready row shows
   * it again after a failure and Retry, and never the old failure text.
   */
  dedupeNote?: string
}

interface UploadResponse {
  document_id: string
  status: string
  deduped: boolean
  course_name?: string | null
}

const UPLOAD_TIMEOUT_MS = 120_000

const BUSY_PHASES: ReadonlySet<UploadPhase> = new Set(["queued", "uploading", "processing", "waiting"])

let keySeed = 0
function nextKey() {
  keySeed += 1
  return `upload-${Date.now().toString(36)}-${keySeed}`
}

/** The note for a file the server already had. */
export function dedupeNoteFor(existingCourse: string | null | undefined, targetCourse: string): string {
  const course = existingCourse?.trim()
  return course && course.toLowerCase() !== targetCourse.trim().toLowerCase()
    ? `Already in your ${course} materials, so it stays there.`
    : "Already in your materials."
}

/** Document ids of the rows still uploading or processing. */
export function busyDocumentIds(entries: readonly UploadEntry[]): Set<string> {
  const ids = new Set<string>()
  for (const entry of entries) {
    if (entry.documentId && BUSY_PHASES.has(entry.phase)) ids.add(entry.documentId)
  }
  return ids
}

/**
 * Upload course files one at a time, then process each, with per-file
 * status, Retry for the failed step, and automatic waiting when the server
 * asks for it (429). Files are checked for type and size before sending.
 * Pending requests are cancelled when the component unmounts.
 */
export function useMaterialUploads({
  onDocumentChange,
}: {
  /** Called when a file was added or became ready, to refresh lists. */
  onDocumentChange?: () => void
} = {}) {
  const [entries, setEntries] = React.useState<UploadEntry[]>([])
  const [announcement, setAnnouncement] = React.useState("")
  const queue = React.useRef<Promise<void>>(Promise.resolve())
  const files = React.useRef(new Map<string, File>())
  /** document id to row key, to spot the same file picked twice */
  const documentRows = React.useRef(new Map<string, string>())
  const controller = React.useRef<AbortController | null>(null)
  const onChangeRef = React.useRef(onDocumentChange)

  React.useEffect(() => {
    onChangeRef.current = onDocumentChange
  }, [onDocumentChange])

  React.useEffect(() => {
    const ctrl = new AbortController()
    controller.current = ctrl
    return () => ctrl.abort()
  }, [])

  const update = React.useCallback((key: string, patch: Partial<UploadEntry>) => {
    setEntries((list) => list.map((e) => (e.key === key ? { ...e, ...patch } : e)))
  }, [])

  const announce = React.useCallback((message: string) => {
    // Clear first so the same sentence twice is announced twice
    setAnnouncement("")
    requestAnimationFrame(() => setAnnouncement(message))
  }, [])

  const processStep = React.useCallback(
    async (entry: UploadEntry, documentId: string, signal: AbortSignal) => {
      update(entry.key, { phase: "processing", note: undefined, failedStep: undefined })
      try {
        const outcome = await processUntilSettled(documentId, signal, {
          onWait: (seconds) =>
            update(entry.key, {
              phase: "waiting",
              note: `Too many files at once. Processing resumes in ${seconds} seconds.`,
            }),
          onResume: () => update(entry.key, { phase: "processing", note: undefined }),
        })
        if (outcome === "PROCESSED") {
          update(entry.key, { phase: "ready", note: entry.dedupeNote })
          announce(`${entry.name} ready`)
        } else {
          update(entry.key, {
            phase: "failed",
            failedStep: "process",
            note: `Couldn't read ${entry.name}. Check that it has selectable text, then retry.`,
          })
          announce(`Couldn't read ${entry.name}`)
        }
        onChangeRef.current?.()
      } catch (error) {
        if (signal.aborted) return
        update(entry.key, {
          phase: "failed",
          failedStep: "process",
          note: errorMessage(error, `${entry.name} wasn't processed.`),
        })
        announce(`${entry.name} wasn't processed`)
      }
    },
    [announce, update]
  )

  const uploadStep = React.useCallback(
    async (entry: UploadEntry, signal: AbortSignal) => {
      const file = files.current.get(entry.key)
      if (!file) return
      update(entry.key, { phase: "uploading", note: undefined, failedStep: undefined })

      const form = new FormData()
      form.append("file", file)
      form.append("namespace", "COURSE")
      form.append("course_name", entry.courseName)
      if (entry.examName) form.append("exam_name", entry.examName)

      let data: UploadResponse
      try {
        const res = await fetch("/api/content/documents", {
          method: "POST",
          body: form,
          signal: anySignal(signal, AbortSignal.timeout(UPLOAD_TIMEOUT_MS)),
        })
        data = (await readJson(res)) as UploadResponse
      } catch (error) {
        if (signal.aborted) return
        update(entry.key, {
          phase: "failed",
          failedStep: "upload",
          note: errorMessage(error, `${entry.name} wasn't uploaded.`),
        })
        announce(`${entry.name} wasn't uploaded`)
        return
      }

      files.current.delete(entry.key)

      // The same file picked twice in this list: keep the first row
      const existingRow = documentRows.current.get(data.document_id)
      if (existingRow && existingRow !== entry.key) {
        setEntries((list) => list.filter((e) => e.key !== entry.key))
        announce(`${entry.name} is already in the list`)
        return
      }
      documentRows.current.set(data.document_id, entry.key)

      const dedupeNote = data.deduped ? dedupeNoteFor(data.course_name, entry.courseName) : undefined

      if (data.status === "PROCESSED") {
        update(entry.key, { phase: "ready", documentId: data.document_id, note: dedupeNote, dedupeNote })
        announce(`${entry.name} ready`)
        onChangeRef.current?.()
        return
      }
      // Mark the row processing before the lists refresh, so the file's row
      // in the materials list reads Processing too and offers no second run
      update(entry.key, { phase: "processing", documentId: data.document_id, note: dedupeNote, dedupeNote })
      onChangeRef.current?.()
      await processStep({ ...entry, documentId: data.document_id, dedupeNote }, data.document_id, signal)
    },
    [announce, processStep, update]
  )

  const enqueue = React.useCallback((task: (signal: AbortSignal) => Promise<void>) => {
    const signal = controller.current?.signal
    if (!signal) return
    queue.current = queue.current.then(() => (signal.aborted ? undefined : task(signal))).catch(() => undefined)
  }, [])

  /** Check and queue files for the given course (and exam). */
  const addFiles = React.useCallback(
    (picked: FileList | File[], target: { courseName: string; examName?: string }) => {
      const list = Array.from(picked)
      if (list.length === 0) return
      const added: UploadEntry[] = list.map((file) => {
        const problem = fileProblem(file)
        const entry: UploadEntry = {
          key: nextKey(),
          name: file.name,
          phase: problem ? "rejected" : "queued",
          courseName: target.courseName.trim(),
          examName: target.examName?.trim() || undefined,
          note: problem ?? undefined,
        }
        if (!problem) files.current.set(entry.key, file)
        return entry
      })
      setEntries((current) => [...current, ...added])
      const rejected = added.filter((e) => e.phase === "rejected")
      if (rejected.length > 0) {
        announce(
          rejected.length === 1
            ? `${rejected[0].name} can't be uploaded`
            : `${rejected.length} files can't be uploaded`
        )
      }
      for (const entry of added) {
        if (entry.phase === "queued") enqueue((signal) => uploadStep(entry, signal))
      }
    },
    [announce, enqueue, uploadStep]
  )

  /** Repeat the step that failed. */
  const retry = React.useCallback(
    (key: string) => {
      const entry = entries.find((e) => e.key === key)
      if (!entry || entry.phase !== "failed") return
      if (entry.failedStep === "process" && entry.documentId) {
        const documentId = entry.documentId
        update(key, { phase: "queued", note: undefined })
        // processStep only ever restores the duplicate note, never this failure's
        enqueue((signal) => processStep({ ...entry, note: undefined }, documentId, signal))
      } else if (files.current.has(key)) {
        update(key, { phase: "queued", note: undefined })
        enqueue((signal) => uploadStep({ ...entry, note: undefined }, signal))
      }
    },
    [entries, enqueue, processStep, update, uploadStep]
  )

  /** Take a row off the list. A file already saved stays in the materials. */
  const remove = React.useCallback((key: string) => {
    files.current.delete(key)
    for (const [documentId, rowKey] of documentRows.current) {
      if (rowKey === key) documentRows.current.delete(documentId)
    }
    setEntries((list) => list.filter((e) => e.key !== key))
  }, [])

  const busy = entries.some((e) => BUSY_PHASES.has(e.phase))
  const readyIds = entries.flatMap((e) => (e.phase === "ready" && e.documentId ? [e.documentId] : []))
  const busyIds = React.useMemo(() => busyDocumentIds(entries), [entries])

  return { entries, addFiles, retry, remove, busy, readyIds, busyIds, announcement }
}
