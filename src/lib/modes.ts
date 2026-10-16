/**
 * Study mode names as the student reads them (VOICE.md, section 2). The one
 * source for the screens, Google Calendar event titles and the .ics export.
 * Screens that also describe a mode keep their own one-line descriptions.
 */
export const MODE_LABELS: Record<string, string> = {
  RETRIEVAL: "Retrieval",
  INTERLEAVED_PRACTICE: "Interleaved practice",
  EXAM_SIM: "Exam simulation",
  ERROR_REPAIR: "Error repair",
  WORKED_EXAMPLES: "Worked examples",
};

/** "Interleaved practice" for INTERLEAVED_PRACTICE; unknown or missing keys read as the fallback. */
export function modeLabel(mode: string | null | undefined, fallback = "Session"): string {
  if (!mode) return fallback;
  return MODE_LABELS[mode] ?? fallback;
}
