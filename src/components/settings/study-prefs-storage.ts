import type { UserSettings } from "@/app/api/settings/rules"

/**
 * localStorage["study_bot_prefs"] = { studyStart, studyEnd, dailyCap }.
 * The plan page reads it as a fallback when /api/settings fails, so it is
 * written only with values the server accepted (after a load or a save).
 */
export const STUDY_PREFS_KEY = "study_bot_prefs"

export function storeStudyPrefs(settings: Pick<UserSettings, "studyStart" | "studyEnd" | "dailyCap">) {
  try {
    window.localStorage.setItem(
      STUDY_PREFS_KEY,
      JSON.stringify({
        studyStart: settings.studyStart,
        studyEnd: settings.studyEnd,
        dailyCap: settings.dailyCap,
      })
    )
  } catch {
    // Storage blocked or full: the plan page falls back to its defaults.
  }
}
