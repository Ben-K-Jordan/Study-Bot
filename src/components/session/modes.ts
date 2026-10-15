import { MODE_LABELS } from "@/lib/modes";

/**
 * Study mode names and one-line descriptions as the student reads them
 * (VOICE.md, section 2). Names come from the shared MODE_LABELS; the
 * descriptions are worded for the session intro.
 */
export interface SessionModeCopy {
  label: string;
  description: string;
}

export const SESSION_MODES: Record<string, SessionModeCopy> = {
  RETRIEVAL: {
    label: MODE_LABELS.RETRIEVAL,
    description: "Answer from memory, then check against the model answer.",
  },
  INTERLEAVED_PRACTICE: {
    label: MODE_LABELS.INTERLEAVED_PRACTICE,
    description: "Questions from different topics, mixed together.",
  },
  EXAM_SIM: {
    label: MODE_LABELS.EXAM_SIM,
    description:
      "Answer every question first. After the last one, you score each answer against its model answer.",
  },
  ERROR_REPAIR: {
    label: MODE_LABELS.ERROR_REPAIR,
    description: "Retest your unresolved errors, confident ones first.",
  },
  WORKED_EXAMPLES: {
    label: MODE_LABELS.WORKED_EXAMPLES,
    description: "Study a solved problem, then supply the missing steps.",
  },
};

/** Label and description for a mode key; unknown keys read as plain words. */
export function sessionModeCopy(mode: string): SessionModeCopy {
  const known = SESSION_MODES[mode];
  if (known) return known;
  const words = mode.toLowerCase().replace(/_/g, " ");
  return { label: words.charAt(0).toUpperCase() + words.slice(1), description: "" };
}
