import { MODE_LABELS } from "@/lib/modes"

/**
 * Study modes and session lengths as the student sees them. Pure data, so
 * the Study screen and the recommendation service share one source for the
 * labels (VOICE.md, section 2) and the length presets.
 */

export const STUDY_MODE_KEYS = [
  "RETRIEVAL",
  "INTERLEAVED_PRACTICE",
  "EXAM_SIM",
  "ERROR_REPAIR",
  "WORKED_EXAMPLES",
] as const

export type StudyModeKey = (typeof STUDY_MODE_KEYS)[number]

export interface StudyMode {
  key: StudyModeKey
  label: string
  description: string
}

export const STUDY_MODES: readonly StudyMode[] = [
  {
    key: "RETRIEVAL",
    label: MODE_LABELS.RETRIEVAL,
    description: "Answer from memory, then check against the model answer.",
  },
  {
    key: "INTERLEAVED_PRACTICE",
    label: MODE_LABELS.INTERLEAVED_PRACTICE,
    description: "Questions from different topics, mixed together.",
  },
  {
    key: "EXAM_SIM",
    label: MODE_LABELS.EXAM_SIM,
    description: "Answer every question first. Feedback comes after the last one.",
  },
  {
    key: "ERROR_REPAIR",
    label: MODE_LABELS.ERROR_REPAIR,
    description: "Retest your unresolved errors, confident ones first.",
  },
  {
    key: "WORKED_EXAMPLES",
    label: MODE_LABELS.WORKED_EXAMPLES,
    description: "Study a solved problem, then supply the missing steps.",
  },
]

const MODE_BY_KEY = new Map(STUDY_MODES.map((mode) => [mode.key, mode]))

export function isStudyModeKey(value: unknown): value is StudyModeKey {
  return typeof value === "string" && MODE_BY_KEY.has(value as StudyModeKey)
}

/** "Interleaved practice" for INTERLEAVED_PRACTICE; unknown keys read as "Session". */
export function studyModeLabel(key: string): string {
  return MODE_BY_KEY.get(key as StudyModeKey)?.label ?? "Session"
}

/** Session lengths offered on the Study screen, in minutes. */
export const SESSION_LENGTHS = [15, 30, 45] as const

export type SessionLength = (typeof SESSION_LENGTHS)[number]

export const DEFAULT_SESSION_LENGTH: SessionLength = 30

export function isSessionLength(value: unknown): value is SessionLength {
  return SESSION_LENGTHS.includes(value as SessionLength)
}

/** About one question every 3 minutes: 15 min = 5, 30 min = 10, 45 min = 15. */
export function questionCountFor(minutes: SessionLength): number {
  return Math.round(minutes / 3)
}

/**
 * One work block with no break inside it. Each length fits inside its
 * block, so no break interrupts a session started from Study.
 */
export function breakProtocolFor(minutes: SessionLength): { type: string; cycles: number } {
  return { type: minutes <= 25 ? "25_5" : minutes <= 50 ? "50_10" : "90_15", cycles: 1 }
}
