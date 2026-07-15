import { describe, it, expect } from "vitest";
import { buildEventPayload, computeEventHash, _hashUserIdForTest } from "@/lib/google/event-builder";
import type { CalendarEventInput } from "@/lib/google/calendar-client";

const baseInput = {
  planId: "plan_abc123",
  planItemId: "item_def456",
  sessionId: "sess_ghi789",
  userId: "user_42",
  calendarId: "primary",
  courseName: "CS 2110",
  examName: "Prelim 1",
  mode: "RETRIEVAL",
  topicScope: "Loops and invariants",
  plannedMinutes: 80,
  startTime: "2026-04-10T14:00:00Z",
  endTime: "2026-04-10T15:20:00Z",
  timezone: "America/New_York",
  objectives: ["Understand loop invariants", "Write correct loop bounds", "Prove termination"],
  targetOutcome: { prompt_count: 10, target_accuracy: 0.8 },
  breakProtocol: { type: "50_10", cycles: 1 },
  baseUrl: "https://studybot.example.com",
};

describe("buildEventPayload", () => {
  it("builds a complete event payload with all fields", () => {
    const { input, hash } = buildEventPayload(baseInput);

    expect(input.calendarId).toBe("primary");
    expect(input.summary).toContain("CS 2110");
    expect(input.summary).toContain("Prelim 1");
    expect(input.summary).toContain("Retrieval");
    expect(input.summary).toContain("Loops and invariants");
    expect(input.start).toBe("2026-04-10T14:00:00Z");
    expect(input.end).toBe("2026-04-10T15:20:00Z");
    expect(input.transparency).toBe("opaque");
    expect(input.reminders).toEqual({ useDefault: true });
    expect(hash).toHaveLength(64); // sha256 hex
  });

  it("includes session deep link in description", () => {
    const { input } = buildEventPayload(baseInput);
    expect(input.description).toContain("https://studybot.example.com/s/sess_ghi789");
    expect(input.description).toContain("StudyBot session:");
  });

  it("includes objectives with truncation", () => {
    const manyObjectives = Array.from({ length: 8 }, (_, i) => `Objective ${i + 1}`);
    const { input } = buildEventPayload({ ...baseInput, objectives: manyObjectives });
    expect(input.description).toContain("Objective 1");
    expect(input.description).toContain("Objective 5");
    expect(input.description).not.toContain("Objective 6");
    expect(input.description).toContain("+3 more");
  });

  it("includes mode, target, and break protocol", () => {
    const { input } = buildEventPayload(baseInput);
    expect(input.description).toContain("Mode: Retrieval");
    expect(input.description).toContain("10 prompts");
    expect(input.description).toContain("target 80%");
    expect(input.description).toContain("Protocol: 50/10");
    expect(input.description).toContain("phone away");
  });

  it("includes 'Created by Study Bot' footer", () => {
    const { input } = buildEventPayload(baseInput);
    expect(input.description).toContain("Created by Study Bot");
  });

  it("sets sb_* extended properties", () => {
    const { input } = buildEventPayload(baseInput);
    const ext = input.extendedProperties!;
    expect(ext.sb_plan).toBe("plan_abc123");
    expect(ext.sb_item).toBe("item_def456");
    expect(ext.sb_sess).toBe("sess_ghi789");
    expect(ext.sb_uid).toBe(_hashUserIdForTest("user_42"));
    // sb_uid should be 16 hex chars
    expect(ext.sb_uid).toHaveLength(16);
    expect(ext.sb_uid).toMatch(/^[0-9a-f]+$/);
  });

  it("handles missing optional fields gracefully", () => {
    const { input } = buildEventPayload({
      ...baseInput,
      objectives: null,
      targetOutcome: null,
      breakProtocol: null,
    });
    expect(input.description).toContain("StudyBot session:");
    expect(input.description).not.toContain("Objectives:");
    expect(input.description).not.toContain("Target:");
    expect(input.description).not.toContain("Protocol:");
  });
});

describe("computeEventHash", () => {
  it("produces stable hash for same input", () => {
    const input: CalendarEventInput = {
      calendarId: "primary",
      summary: "Test",
      description: "Desc",
      start: "2026-04-10T14:00:00Z",
      end: "2026-04-10T15:00:00Z",
      transparency: "opaque",
      extendedProperties: { sb_plan: "p1" },
    };
    const hash1 = computeEventHash(input);
    const hash2 = computeEventHash(input);
    expect(hash1).toBe(hash2);
  });

  it("changes when summary changes", () => {
    const base: CalendarEventInput = {
      calendarId: "primary",
      summary: "Test A",
      start: "2026-04-10T14:00:00Z",
      end: "2026-04-10T15:00:00Z",
    };
    const modified = { ...base, summary: "Test B" };
    expect(computeEventHash(base)).not.toBe(computeEventHash(modified));
  });

  it("changes when time changes", () => {
    const base: CalendarEventInput = {
      calendarId: "primary",
      summary: "Test",
      start: "2026-04-10T14:00:00Z",
      end: "2026-04-10T15:00:00Z",
    };
    const modified = { ...base, start: "2026-04-10T15:00:00Z" };
    expect(computeEventHash(base)).not.toBe(computeEventHash(modified));
  });

  it("changes when description changes", () => {
    const base: CalendarEventInput = {
      calendarId: "primary",
      summary: "Test",
      description: "Desc A",
      start: "2026-04-10T14:00:00Z",
      end: "2026-04-10T15:00:00Z",
    };
    const modified = { ...base, description: "Desc B" };
    expect(computeEventHash(base)).not.toBe(computeEventHash(modified));
  });

  it("does not change when calendarId changes (not in canonical form)", () => {
    const base: CalendarEventInput = {
      calendarId: "primary",
      summary: "Test",
      start: "2026-04-10T14:00:00Z",
      end: "2026-04-10T15:00:00Z",
    };
    const modified = { ...base, calendarId: "secondary" };
    expect(computeEventHash(base)).toBe(computeEventHash(modified));
  });
});
