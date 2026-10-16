import { anySignal } from "@/lib/abort"
import { readJson } from "@/components/plan/api-errors"

export { anySignal }

/** Waits `ms`, or rejects with an AbortError as soon as `signal` aborts. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException("Aborted", "AbortError"))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

const PROCESS_TIMEOUT_MS = 180_000
/** 429s waited out before giving up. */
const MAX_RATE_LIMIT_WAITS = 3
/** While another request processes the file: check every 5 seconds, for up to 3 minutes. */
const BUSY_POLL_MS = 5_000
const MAX_BUSY_POLLS = 36

/** Why a file couldn't be read, and what to do about it. */
export function unreadableNote(name: string, outcome: "FAILED" | "TOO_LONG"): string {
  return outcome === "TOO_LONG"
    ? `${name} is too long to read. Split it into smaller files, then upload those.`
    : `Couldn't read ${name}. Check that it has selectable text, then retry.`
}

/** FAILED: the file couldn't be read. TOO_LONG: it is over the reading limits, so splitting it helps. */
export type ProcessOutcome = "PROCESSED" | "FAILED" | "TOO_LONG"

/**
 * POST /api/content/documents/{id}/process until the file is ready or
 * couldn't be read. A 429 waits out Retry-After (calling `onWait` with the
 * seconds, then `onResume`). PROCESSING means another request (another tab,
 * a second click) is reading the file, so this checks back until it is done
 * instead of starting a second run. Throws ApiError for other failed
 * responses, and a DOMException on timeout or when `signal` aborts.
 */
export async function processUntilSettled(
  documentId: string,
  signal: AbortSignal,
  hooks: { onWait?: (seconds: number) => void; onResume?: () => void } = {}
): Promise<ProcessOutcome> {
  let waits = 0
  let polls = 0
  for (;;) {
    const res = await fetch(`/api/content/documents/${encodeURIComponent(documentId)}/process`, {
      method: "POST",
      signal: anySignal(signal, AbortSignal.timeout(PROCESS_TIMEOUT_MS)),
    })
    if (res.status === 429 && waits < MAX_RATE_LIMIT_WAITS) {
      waits++
      const seconds = Number(res.headers.get("Retry-After")) || 30
      hooks.onWait?.(seconds)
      await sleep(seconds * 1000, signal)
      hooks.onResume?.()
      continue
    }
    const data = (await readJson(res)) as { status?: string; reason?: string } | null
    if (data?.status === "PROCESSED") return "PROCESSED"
    if (data?.status === "PROCESSING") {
      // Still going after 3 minutes: report a timeout, not an unreadable file
      if (polls >= MAX_BUSY_POLLS) throw new DOMException("Still processing", "TimeoutError")
      polls++
      await sleep(BUSY_POLL_MS, signal)
      continue
    }
    return data?.reason === "too_long" ? "TOO_LONG" : "FAILED"
  }
}
