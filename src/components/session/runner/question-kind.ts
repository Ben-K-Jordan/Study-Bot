/**
 * What kind of question is on screen, and how its stored text splits into
 * the parts the lesson draws. Pure functions, unit-tested.
 */
import { promptStepCount, type RunnerPrompt } from "./types"

export type QuestionKind =
  | { type: "pretest" }
  | { type: "repair"; original: string | null; inSession: boolean }
  | { type: "review" }
  | { type: "worked-study" }
  | { type: "worked-completion"; missing: 1 | 2; stepCount: number | null }
  | { type: "worked-full" }
  | { type: "standard" }

const REPAIR_SOURCES = new Set(["VARIANT_REPAIR", "ERROR_LOG"])
const REPAIR_PACKS = new Set(["VARIANT_REPAIR", "CROSS_SESSION_REPAIR"])

export function questionKind(prompt: RunnerPrompt): QuestionKind {
  const pack = prompt.meta?.pack
  if (pack === "PRE_TEST") return { type: "pretest" }
  if (
    (prompt.source_type && REPAIR_SOURCES.has(prompt.source_type)) ||
    (pack && REPAIR_PACKS.has(pack))
  ) {
    const original = prompt.meta?.original_prompt_text?.trim() || null
    return {
      type: "repair",
      original,
      inSession: pack === "VARIANT_REPAIR" || prompt.source_type === "VARIANT_REPAIR",
    }
  }
  if (pack === "WARMUP") return { type: "review" }
  if (pack === "WORKED_EXAMPLE") return { type: "worked-study" }
  if (pack === "WE_COMPLETION_1") return { type: "worked-completion", missing: 1, stepCount: promptStepCount(prompt) }
  if (pack === "WE_COMPLETION_2") return { type: "worked-completion", missing: 2, stepCount: promptStepCount(prompt) }
  if (pack === "WE_FULL") return { type: "worked-full" }
  return { type: "standard" }
}

export function isPretestKind(kind: QuestionKind): boolean {
  return kind.type === "pretest"
}

export function isRepairKind(kind: QuestionKind): boolean {
  return kind.type === "repair"
}

/** A multiple-choice question the runner can draw (2 to 4 choices). */
export function isMcqPrompt(prompt: RunnerPrompt): boolean {
  return (
    prompt.format === "MCQ" &&
    Array.isArray(prompt.choices) &&
    prompt.choices.length >= 2 &&
    prompt.choices.length <= 4
  )
}

/**
 * The question as a heading plus the paragraphs after it. The first
 * paragraph is the question (the h1); the rest are instructions or context
 * drawn below it.
 */
export function splitQuestion(text: string): { heading: string; body: string } {
  const normalized = text.replace(/\r\n/g, "\n").trim()
  const parts = normalized.split(/\n\s*\n/)
  const heading = (parts.shift() ?? "").trim()
  return { heading, body: parts.join("\n\n").trim() }
}

export interface WorkedStep {
  action: string
  why: string
}

// "Step 2: Factor out x. Why: Both terms share it." and the older
// "Step 2: Factor out x \u2014 why: Both terms share it".
const STEP_LINE = /^Step\s+(\d+):\s*(.+?)(?:\s+\u2014\s+why:\s*|\.\s+Why:\s*)(.+)$/i

/** The worked-example study text: problem, solution steps, then the question. */
export function parseWorkedExample(text: string): {
  problem: string
  steps: WorkedStep[]
  question: string
} {
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  const before: string[] = []
  const after: string[] = []
  const steps: WorkedStep[] = []
  for (const line of lines) {
    const match = line.trim().match(STEP_LINE)
    if (match) {
      steps.push({ action: match[2].trim().replace(/\.$/, ""), why: match[3].trim().replace(/\.$/, "") })
    } else if (steps.length === 0) {
      before.push(line)
    } else {
      after.push(line)
    }
  }
  return {
    problem: before.join("\n").trim(),
    steps,
    question: after.join("\n").trim(),
  }
}

// The closing instruction on a completion problem, old and new wording.
const COMPLETION_TRAILER =
  /\n*\s*\(?The (?:final|last) (?:two )?steps? (?:is|are) missing\b[^\n]*\)?\s*$/i

/** A completion problem without the "steps are missing" line the screen draws itself. */
export function stripCompletionTrailer(text: string): string {
  return text.replace(COMPLETION_TRAILER, "").trim()
}

export interface Highlighted {
  text: string
  mark: boolean
}

/**
 * Display cleanup for a source snippet: drop markdown heading markers and
 * emphasis symbols, then split on the search highlighter's <<term>> marks.
 * Returns plain segments the screen renders as text and <mark> nodes (no
 * HTML strings).
 */
export function highlightSnippet(snippet: string): Highlighted[] {
  const cleaned = snippet
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\s+#{1,6}\s*$/gm, "")
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/\*(?=\S)([^*\n]*\S)\*/g, "$1")
  const segments: Highlighted[] = []
  const pattern = /<<(.+?)>>/g
  let last = 0
  for (const match of cleaned.matchAll(pattern)) {
    const start = match.index ?? 0
    if (start > last) segments.push({ text: cleaned.slice(last, start), mark: false })
    segments.push({ text: match[1], mark: true })
    last = start + match[0].length
  }
  if (last < cleaned.length) segments.push({ text: cleaned.slice(last), mark: false })
  return segments.filter((s) => s.text.length > 0)
}

/**
 * Explanation text with its [n] citations turned into markdown links the
 * renderer draws as source buttons. Numbers outside 1..sourceCount stay
 * as written.
 */
export function linkCitations(text: string, sourceCount: number): string {
  if (sourceCount <= 0) return text
  return text.replace(/\[(\d{1,2})\](?!\()/g, (whole, digits: string) => {
    const n = Number(digits)
    return n >= 1 && n <= sourceCount ? `[${n}](#source-${n})` : whole
  })
}

/** "Source 2: Lecture 5, page 3" (page left out when unknown or 0). */
export function sourceLabel(n: number, source: { doc_title: string; page_number: number | null }): string {
  const page = source.page_number && source.page_number > 0 ? `, page ${source.page_number}` : ""
  return `Source ${n}: ${source.doc_title}${page}`
}
