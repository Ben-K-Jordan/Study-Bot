/**
 * Study settings rules shared by PUT /api/settings and the Settings form:
 * defaults, ranges, field messages and the cross-field checks. No zod and
 * no Prisma, so the client bundle stays small.
 */

export interface UserSettings {
  /** "HH:MM", 24-hour, wall clock in the student's time zone. */
  studyStart: string;
  studyEnd: string;
  /** Minutes of study a new plan may schedule per day. */
  dailyCap: number;
  dailyXpGoal: number;
  /** IANA time zone, or null for UTC day boundaries. */
  timezone: string | null;
}

/** Matches the Prisma defaults on UserGameState. */
export const SETTINGS_DEFAULTS: UserSettings = {
  studyStart: "09:00",
  studyEnd: "17:00",
  dailyCap: 180,
  dailyXpGoal: 50,
  timezone: null,
};

export const DAILY_CAP_MINUTES = { min: 30, max: 480 } as const;
export const DAILY_XP_GOAL = { min: 10, max: 500 } as const;

export type SettingsField = keyof UserSettings;
export type SettingsFieldErrors = Partial<Record<SettingsField, string>>;

/** Field errors are instructions, written per VOICE.md. */
export const SETTINGS_FIELD_MESSAGES = {
  studyStart: "Enter a start time, like 9:00 AM.",
  studyEnd: "Enter an end time, like 5:00 PM.",
  studyOrder: "Choose an end time after the start time.",
  dailyCap: "Choose a daily limit between 30 minutes and 8 hours.",
  dailyXpGoal: "Choose a goal between 10 and 500 XP.",
  timezone: "Choose a time zone from the list, like America/New_York.",
} as const;

export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Whether `tz` is an IANA zone this runtime knows. */
export function isKnownTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Normalizes the zone: blank means "not set". */
export function normalizeTimezone(tz: string | null | undefined): string | null {
  const trimmed = tz?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Checks a complete set of settings, including the rules a single field
 * can't express (the end time comes after the start time). Returns an
 * empty object when everything is valid.
 */
export function validateSettings(values: UserSettings): SettingsFieldErrors {
  const errors: SettingsFieldErrors = {};
  if (!TIME_PATTERN.test(values.studyStart)) errors.studyStart = SETTINGS_FIELD_MESSAGES.studyStart;
  if (!TIME_PATTERN.test(values.studyEnd)) errors.studyEnd = SETTINGS_FIELD_MESSAGES.studyEnd;
  if (!errors.studyStart && !errors.studyEnd && values.studyEnd <= values.studyStart) {
    errors.studyEnd = SETTINGS_FIELD_MESSAGES.studyOrder;
  }
  if (
    !Number.isInteger(values.dailyCap) ||
    values.dailyCap < DAILY_CAP_MINUTES.min ||
    values.dailyCap > DAILY_CAP_MINUTES.max
  ) {
    errors.dailyCap = SETTINGS_FIELD_MESSAGES.dailyCap;
  }
  if (
    !Number.isInteger(values.dailyXpGoal) ||
    values.dailyXpGoal < DAILY_XP_GOAL.min ||
    values.dailyXpGoal > DAILY_XP_GOAL.max
  ) {
    errors.dailyXpGoal = SETTINGS_FIELD_MESSAGES.dailyXpGoal;
  }
  if (values.timezone !== null && !isKnownTimezone(values.timezone)) {
    errors.timezone = SETTINGS_FIELD_MESSAGES.timezone;
  }
  return errors;
}

/** Applies a partial update onto the current settings. */
export function mergeSettings(current: UserSettings, update: Partial<UserSettings>): UserSettings {
  return {
    studyStart: update.studyStart ?? current.studyStart,
    studyEnd: update.studyEnd ?? current.studyEnd,
    dailyCap: update.dailyCap ?? current.dailyCap,
    dailyXpGoal: update.dailyXpGoal ?? current.dailyXpGoal,
    timezone: update.timezone === undefined ? current.timezone : normalizeTimezone(update.timezone),
  };
}

/** The response body for a rejected update. */
export const SETTINGS_INVALID_MESSAGE = "Settings not saved. Check the highlighted fields.";
