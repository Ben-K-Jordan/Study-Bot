"use client"

import * as React from "react"

import { errorMessage, readJson } from "@/components/plan/api-errors"
import { fileProblem } from "@/components/materials/file-rules"

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
  /** A sentence under the file name: why it failed, or a note such as a duplicate. */
  note?: string
}

interface UploadResponse {
  document_id: string
  status: string
  deduped: boolean
  course_name?: string | null
}

const MAX_WAITS = 3
const UPLOAD_TIMEOUT_MS = 120_000
const PROCESS_TIMEOUT_MS = 180_000

let keySeed = 0
function nextKey() {
  keySeed += 1
  return `upload-${Date.now().toString(36)}-${keySeed}`
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        reject(new DOMException("Aborted", "AbortError"))
      },
      { once: true }
    )
  })
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
      for (let attempt = 0; ; attempt++) {
        update(entry.key, { phase: "processing", note: undefined, failedStep: undefined })
        try {
          const res = await fetch(`/api/content/documents/${documentId}/process`, {
            method: "POST",
            signal: AbortSignal.any([signal, AbortSignal.timeout(PROCESS_TIMEOUT_MS)]),
          })
          if (res.status === 429 && attempt < MAX_WAITS) {
            const seconds = Number(res.headers.get("Retry-After")) || 30
            update(entry.key, {
              phase: "waiting",
              note: `Too many files at once. Processing resumes in ${seconds} seconds.`,
            })
            await sleep(seconds * 1000, signal)
            continue
          }
          const data = (await readJson(res)) as { status?: string }
          if (data?.status === "PROCESSED") {
            update(entry.key, { phase: "ready", note: entry.note })
            announce(`${entry.name} ready`)
            onChangeRef.current?.()
          } else {
            update(entry.key, {
              phase: "failed",
              failedStep: "process",
              note: `Couldn't read ${entry.name}. Check that it has selectable text, then retry.`,
            })
            announce(`Couldn't read ${entry.name}`)
            onChangeRef.current?.()
          }
          return
        } catch (error) {
          if (signal.aborted) return
          update(entry.key, {
            phase: "failed",
            failedStep: "process",
            note: errorMessage(error, `${entry.name} wasn't processed.`),
          })
          announce(`${entry.name} wasn't processed`)
          return
        }
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
          signal: AbortSignal.any([signal, AbortSignal.timeout(UPLOAD_TIMEOUT_MS)]),
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

      let note: string | undefined
      if (data.deduped) {
        const course = data.course_name?.trim()
        note =
          course && course.toLowerCase() !== entry.courseName.trim().toLowerCase()
            ? `Already in your ${course} materials, so it stays there.`
            : "Already in your materials."
      }
      const withNote = { ...entry, note }
      onChangeRef.current?.()

      if (data.status === "PROCESSED") {
        update(entry.key, { phase: "ready", documentId: data.document_id, note })
        announce(`${entry.name} ready`)
        return
      }
      update(entry.key, { documentId: data.document_id, note })
      await processStep(withNote, data.document_id, signal)
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
        enqueue((signal) => processStep(entry, documentId, signal))
      } else if (files.current.has(key)) {
        update(key, { phase: "queued", note: undefined })
        enqueue((signal) => uploadStep(entry, signal))
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

  const busy = entries.some(
    (e) => e.phase === "queued" || e.phase === "uploading" || e.phase === "processing" || e.phase === "waiting"
  )
  const readyIds = entries.flatMap((e) => (e.phase === "ready" && e.documentId ? [e.documentId] : []))

  return { entries, addFiles, retry, remove, busy, readyIds, announcement }
}
