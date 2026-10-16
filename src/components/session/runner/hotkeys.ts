/**
 * The runner's keyboard map. One table drives the key handling and the
 * keyboard help, so the two can't drift apart. Pure helpers, unit-tested.
 */

export interface HotkeyEventLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey?: boolean
  repeat?: boolean
  isComposing?: boolean
  defaultPrevented?: boolean
  target: EventTarget | null
}

export interface Binding {
  /** Lowercase key: "1", "q", "enter", "?". */
  key: string
  /** Needs Ctrl (or Cmd on a Mac). Works while typing in a field. */
  mod?: boolean
  run: () => void
}

interface TargetLike {
  tagName?: string
  isContentEditable?: boolean
  type?: string
  getAttribute?: (name: string) => string | null
}

/** A field that takes typed text: single keys belong to it, not to shortcuts. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as TargetLike | null
  if (!el || typeof el !== "object") return false
  if (el.isContentEditable) return true
  const tag = el.tagName?.toUpperCase()
  if (tag === "TEXTAREA" || tag === "SELECT") return true
  if (tag === "INPUT") {
    const type = (el.type ?? "text").toLowerCase()
    return !["radio", "checkbox", "button", "submit", "reset"].includes(type)
  }
  return false
}

/** A control whose own Enter or Space activation must win. */
export function isActivationTarget(target: EventTarget | null): boolean {
  const el = target as TargetLike | null
  if (!el || typeof el !== "object") return false
  const tag = el.tagName?.toUpperCase()
  if (tag === "BUTTON" || tag === "A" || tag === "SUMMARY") return true
  const role = el.getAttribute?.("role")
  return role === "button" || role === "link" || role === "menuitem" || role === "tab"
}

function normalizedKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key.toLowerCase()
}

/**
 * The binding a key press should run, or null. Skips presses already
 * handled (defaultPrevented), held-down repeats, IME composition, Alt
 * combinations, Enter on a focused button or link, and single keys while
 * typing. Ctrl or Cmd bindings work anywhere, fields included.
 */
export function matchHotkey(event: HotkeyEventLike, bindings: readonly Binding[]): Binding | null {
  if (event.defaultPrevented || event.isComposing || event.repeat || event.altKey) return null
  const key = normalizedKey(event.key)
  const mod = event.ctrlKey || event.metaKey

  for (const binding of bindings) {
    if (binding.key !== key) continue
    if (binding.mod) {
      if (mod) return binding
      continue
    }
    if (mod) continue
    if (isTypingTarget(event.target)) continue
    if ((key === "enter" || key === " ") && isActivationTarget(event.target)) continue
    return binding
  }
  return null
}

export interface HotkeyHelpRow {
  keys: readonly string[]
  /** "Mod" is shown as Ctrl or Cmd. */
  label: string
}

/** Every shortcut the session understands, for the keyboard help. */
export const HOTKEY_HELP: readonly HotkeyHelpRow[] = [
  { keys: ["1", "2", "3", "4"], label: "Choose an answer" },
  { keys: ["Q", "W", "E"], label: "Rate how sure you are: Guessing, Unsure, Sure" },
  { keys: ["Enter"], label: "Submit your choice, then go to the next question" },
  { keys: ["Mod", "Enter"], label: "Submit a written answer or a correction" },
  { keys: ["1", "2", "3"], label: "Score your answer: Correct, Partly correct, Incorrect" },
  { keys: ["?"], label: "Show or hide keyboard shortcuts" },
]

/** Confidence keys, left to right: Guessing, Unsure, Sure. */
export const CONFIDENCE_KEYS = ["Q", "W", "E"] as const
