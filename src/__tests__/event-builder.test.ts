import { describe, it, expect } from "vitest";
import { buildEventPayload, computeEventHash, hashUserId } from "@/lib/google/event-builder";
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
    expect(input.summary).toContain("Understand loop invariants");
    expect(input.start).toBe("2026-04-10T14:00:00Z");
    expect(input.end).toBe("2026-04-10T15:20:00Z");
    expect(input.transparency).toBe("opaque");
    expect(input.reminders).toEqual({ useDefault: true });
    expect(hash).toHaveLength(64); // sha256 hex
  });

  it("includes session deep link in description", () => {
    const { input } = buildEventPayload(baseInput);
    expect(input.description).toContain("Open the session: https://studybot.example.com/s/sess_ghi789");
  });

  it("titles the event mode first, then the topics, course and exam", () => {
    const { input } = buildEventPayload(baseInput);
    // The same topics as the description, from the objectives
    expect(input.summary).toBe(
      "Retrieval: Understand loop invariants, Write correct loop bounds, and Prove termination · CS 2110 Prelim 1",
    );
  });

  it("names the first 3 topics in the title and counts the rest", () => {
    const manyObjectives = Array.from({ length: 6 }, (_, i) => `Topic ${i + 1}`);
    const { input } = buildEventPayload({ ...baseInput, mode: "EXAM_SIM", objectives: manyObjectives });
    expect(input.summary).toBe("Exam simulation: Topic 1, Topic 2, Topic 3, and 3 more · CS 2110 Prelim 1");
  });

  it("titles a follow-up stored with the old marker by its topics alone", () => {
    const { input } = buildEventPayload({
      ...baseInput,
      topicScope: "Follow-up: Recursion, Stacks",
      objectives: null,
    });
    expect(input.summary).toBe("Retrieval: Recursion and Stacks · CS 2110 Prelim 1");
    expect(input.description).toContain("Topics: Recursion and Stacks");
  });

  it("lists the first topics and counts the rest", () => {
    const manyObjectives = Array.from({ length: 8 }, (_, i) => `Objective ${i + 1}`);
    const { input } = buildEventPayload({ ...baseInput, objectives: manyObjectives });
    expect(input.description).toContain("Objective 1");
    expect(input.description).toContain("Objective 6");
    expect(input.description).not.toContain("Objective 7");
    expect(input.description).toContain("and 2 more");
  });

  it("reads objectives stored as { id, title } objects", () => {
    const { input } = buildEventPayload({
      ...baseInput,
      objectives: [
        { id: "loops", title: "Loop invariants" },
        { id: "bounds", title: "Loop bounds" },
      ],
    });
    expect(input.description).toContain("Topics: Loop invariants and Loop bounds");
    expect(input.description).not.toContain("[object Object]");
  });

  it("states the mode, questions and target in plain words", () => {
    const { input } = buildEventPayload(baseInput);
    expect(input.description).toContain("Retrieval session for CS 2110 Prelim 1");
    expect(input.description).toContain("10 questions. Target accuracy: 80%.");
    // One block: no break line
    expect(input.description).not.toContain("break");
    expect(input.description).not.toMatch(/StudyBot|Protocol|prompts|\+\d+ more/);
  });

  it("includes 'Added by Study Bot' footer", () => {
    const { input } = buildEventPayload(baseInput);
    expect(input.description).toContain("Added by Study Bot");
  });

  it("sets sb_* extended properties", () => {
    const { input } = buildEventPayload(baseInput);
    const ext = input.extendedProperties!;
    expect(ext.sb_plan).toBe("plan_abc123");
    expect(ext.sb_item).toBe("item_def456");
    expect(ext.sb_sess).toBe("sess_ghi789");
    expect(ext.sb_uid).toBe(hashUserId("user_42"));
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
    expect(input.description).toContain("Open the session:");
    expect(input.description).toContain("Topics: Loops and invariants");
    expect(input.description).not.toContain("questions");
    expect(input.description).not.toContain("Target accuracy");
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

describe("hashUserId", () => {
  it("produces a consistent 16-char hex string", () => {
    const hash = hashUserId("user-123");
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(hashUserId("user-123")).toBe(hash);
  });

  it("gives different users different hashes", () => {
    expect(hashUserId("user-1")).not.toBe(hashUserId("user-2"));
  });
});
