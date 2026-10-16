/**
 * Browser storage for the runner. Every access is wrapped: storage can be
 * missing or throw (private windows, blocked site data) and the session
 * must work without it.
 */
import type { Draft } from "./question-reducer"

/** The in-progress answer for one question. Kept until the server accepts it. */
export function draftKey(runId: string, phase: string, index: number): string {
  return `draft:${runId}:${phase}:${index}`
}

/**
 * A stored draft, keeping only fields of the right type. The question
 * state checks the values themselves (a choice that still exists, a
 * confidence on the 1, 3, 5 scale).
 */
export function parseDraft(raw: string | null): Draft | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return null
    const value = parsed as Record<string, unknown>
    const draft: Draft = {}
    if (typeof value.answer === "string") draft.answer = value.answer
    if (typeof value.choice === "number") draft.choice = value.choice
    if (typeof value.confidence === "number") draft.confidence = value.confidence
    if (typeof value.correction_rule === "string") draft.correction_rule = value.correction_rule
    if (typeof value.variant_question === "string") draft.variant_question = value.variant_question
    if (typeof value.error_type === "string") draft.error_type = value.error_type
    return draft
  } catch {
    return null
  }
}

export function readDraft(key: string): Draft | null {
  try {
    return parseDraft(window.localStorage.getItem(key))
  } catch {
    return null
  }
}

export function writeDraft(key: string, draft: Draft | null): void {
  try {
    if (draft) window.localStorage.setItem(key, JSON.stringify(draft))
    else window.localStorage.removeItem(key)
  } catch {
    // Storage unavailable: the answer still lives in memory.
  }
}

/** Same as writeDraft, for a draft already serialized (an effect dependency). */
export function writeDraftJson(key: string, json: string | null): void {
  try {
    if (json) window.localStorage.setItem(key, json)
    else window.localStorage.removeItem(key)
  } catch {
    // Storage unavailable: the answer still lives in memory.
  }
}

const SHORTCUTS_KEY = "study-bot:session-shortcuts:v1"

/** Single-key shortcuts are on unless the student turned them off. */
export function readShortcutsEnabled(): boolean {
  try {
    return window.localStorage.getItem(SHORTCUTS_KEY) !== "off"
  } catch {
    return true
  }
}

export function writeShortcutsEnabled(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.removeItem(SHORTCUTS_KEY)
    else window.localStorage.setItem(SHORTCUTS_KEY, "off")
  } catch {
    // Not remembered; the choice still applies until the page reloads.
  }
}
