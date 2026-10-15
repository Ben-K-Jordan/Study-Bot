/**
 * The PUT /api/settings body schema (zod, server side). The shared rules
 * live in ./rules so the Settings form can use them without zod.
 */
import { z } from "zod";
import {
  DAILY_CAP_MINUTES,
  DAILY_XP_GOAL,
  SETTINGS_FIELD_MESSAGES,
  TIME_PATTERN,
  type SettingsField,
  type SettingsFieldErrors,
} from "./rules";

export * from "./rules";

export const settingsUpdateSchema = z.object({
  studyStart: z.string().regex(TIME_PATTERN, SETTINGS_FIELD_MESSAGES.studyStart).optional(),
  studyEnd: z.string().regex(TIME_PATTERN, SETTINGS_FIELD_MESSAGES.studyEnd).optional(),
  dailyCap: z
    .number()
    .int()
    .min(DAILY_CAP_MINUTES.min, SETTINGS_FIELD_MESSAGES.dailyCap)
    .max(DAILY_CAP_MINUTES.max, SETTINGS_FIELD_MESSAGES.dailyCap)
    .optional(),
  dailyXpGoal: z
    .number()
    .int()
    .min(DAILY_XP_GOAL.min, SETTINGS_FIELD_MESSAGES.dailyXpGoal)
    .max(DAILY_XP_GOAL.max, SETTINGS_FIELD_MESSAGES.dailyXpGoal)
    .optional(),
  // Empty string or null clears the zone (UTC day boundaries).
  timezone: z.string().max(100, SETTINGS_FIELD_MESSAGES.timezone).nullable().optional(),
});

export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>;

const FIELDS: readonly SettingsField[] = ["studyStart", "studyEnd", "dailyCap", "dailyXpGoal", "timezone"];

function isField(value: unknown): value is SettingsField {
  return typeof value === "string" && (FIELDS as readonly string[]).includes(value);
}

/** Maps zod issues onto fields, so "Validation failed" never reaches the screen. */
export function fieldErrorsFromIssues(
  issues: readonly { path: readonly PropertyKey[] }[],
): SettingsFieldErrors {
  const errors: SettingsFieldErrors = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (isField(field) && !errors[field]) {
      errors[field] = SETTINGS_FIELD_MESSAGES[field];
    }
  }
  return errors;
}

