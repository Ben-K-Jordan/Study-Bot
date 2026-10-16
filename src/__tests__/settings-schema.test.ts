/**
 * Study settings validation shared by PUT /api/settings and the Settings form.
 */
import { describe, it, expect } from "vitest";
import {
  SETTINGS_DEFAULTS,
  SETTINGS_FIELD_MESSAGES,
  fieldErrorsFromIssues,
  mergeSettings,
  normalizeTimezone,
  settingsUpdateSchema,
  validateSettings,
} from "@/app/api/settings/schema";

const valid = { ...SETTINGS_DEFAULTS, timezone: "America/New_York" };

describe("validateSettings", () => {
  it("accepts the defaults and a known zone", () => {
    expect(validateSettings(SETTINGS_DEFAULTS)).toEqual({});
    expect(validateSettings(valid)).toEqual({});
  });

  it("asks for an end time after the start time", () => {
    expect(validateSettings({ ...valid, studyStart: "14:00", studyEnd: "13:00" })).toEqual({
      studyEnd: SETTINGS_FIELD_MESSAGES.studyOrder,
    });
    expect(validateSettings({ ...valid, studyStart: "14:00", studyEnd: "14:00" }).studyEnd).toBe(
      SETTINGS_FIELD_MESSAGES.studyOrder,
    );
  });

  it("asks for a time when a field is empty, without the order error", () => {
    expect(validateSettings({ ...valid, studyStart: "" })).toEqual({
      studyStart: SETTINGS_FIELD_MESSAGES.studyStart,
    });
    expect(validateSettings({ ...valid, studyEnd: "" })).toEqual({
      studyEnd: SETTINGS_FIELD_MESSAGES.studyEnd,
    });
  });

  it("keeps the limit and goal inside the server's ranges", () => {
    expect(validateSettings({ ...valid, dailyCap: 20 }).dailyCap).toBe(SETTINGS_FIELD_MESSAGES.dailyCap);
    expect(validateSettings({ ...valid, dailyCap: 481 }).dailyCap).toBe(SETTINGS_FIELD_MESSAGES.dailyCap);
    expect(validateSettings({ ...valid, dailyXpGoal: 5 }).dailyXpGoal).toBe(SETTINGS_FIELD_MESSAGES.dailyXpGoal);
    expect(validateSettings({ ...valid, dailyXpGoal: 500 })).toEqual({});
  });

  it("rejects an unknown time zone with an instruction", () => {
    expect(validateSettings({ ...valid, timezone: "Mars/Olympus_Mons" })).toEqual({
      timezone: SETTINGS_FIELD_MESSAGES.timezone,
    });
  });

  it("writes every message as an instruction without dashes or exclamation marks", () => {
    for (const message of Object.values(SETTINGS_FIELD_MESSAGES)) {
      expect(message).toMatch(/^(Enter|Choose) /);
      expect(message).not.toMatch(/[–—!]/);
    }
  });
});

describe("mergeSettings", () => {
  it("applies only the fields sent and treats a blank zone as not set", () => {
    expect(mergeSettings(valid, { studyEnd: "20:00" })).toEqual({ ...valid, studyEnd: "20:00" });
    expect(mergeSettings(valid, { timezone: "" }).timezone).toBeNull();
    expect(mergeSettings(valid, { timezone: null }).timezone).toBeNull();
    expect(mergeSettings(valid, {}).timezone).toBe("America/New_York");
  });

  it("catches an end time that only conflicts with the saved start time", () => {
    const current = { ...valid, studyStart: "18:00" };
    expect(validateSettings(mergeSettings(current, { studyEnd: "17:00" })).studyEnd).toBe(
      SETTINGS_FIELD_MESSAGES.studyOrder,
    );
  });
});

describe("settingsUpdateSchema and fieldErrorsFromIssues", () => {
  it("maps zod issues to one message per field", () => {
    const parsed = settingsUpdateSchema.safeParse({ studyStart: "9am", dailyCap: 10, dailyXpGoal: "x" });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(fieldErrorsFromIssues(parsed.error.issues)).toEqual({
      studyStart: SETTINGS_FIELD_MESSAGES.studyStart,
      dailyCap: SETTINGS_FIELD_MESSAGES.dailyCap,
      dailyXpGoal: SETTINGS_FIELD_MESSAGES.dailyXpGoal,
    });
  });

  it("ignores issues on unknown paths", () => {
    expect(fieldErrorsFromIssues([{ path: ["other"] }, { path: [] }])).toEqual({});
  });
});

describe("normalizeTimezone", () => {
  it("trims and turns blanks into null", () => {
    expect(normalizeTimezone("  Europe/Paris ")).toBe("Europe/Paris");
    expect(normalizeTimezone("   ")).toBeNull();
    expect(normalizeTimezone(undefined)).toBeNull();
  });
});
