/**
 * Unit tests for Google Calendar hardening sprint.
 *
 * Tests:
 * - Token encryption roundtrip + missing key behavior
 * - Event hash stability and skip-unchanged logic
 * - GoogleReconnectError propagation
 * - FakeClient error simulation
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  FakeGoogleCalendarClient,
  GoogleApiError,
  GoogleReconnectError,
} from "@/lib/google/calendar-client";
import { buildEventPayload, computeEventHash } from "@/lib/google/event-builder";

// ---- Token encryption ----

describe("token encryption", () => {
  it("fails without TOKEN_ENC_KEY in production", async () => {
    const origEnv = { ...process.env };
    delete process.env.TOKEN_ENC_KEY;
    delete process.env.GOOGLE_TOKEN_ENC_KEY;
    process.env.NODE_ENV = "production";

    // Dynamic import to get fresh module
    vi.resetModules();
    try {
      const { encrypt } = await import("@/lib/crypto");
      expect(() => encrypt("test")).toThrow("TOKEN_ENC_KEY");
    } finally {
      Object.assign(process.env, origEnv);
      vi.resetModules();
    }
  });

  it("accepts TOKEN_ENC_KEY as primary env var", async () => {
    const origEnv = { ...process.env };
    delete process.env.GOOGLE_TOKEN_ENC_KEY;
    process.env.TOKEN_ENC_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    vi.resetModules();
    try {
      const { encrypt, decrypt } = await import("@/lib/crypto");
      const enc = encrypt("hello");
      expect(decrypt(enc)).toBe("hello");
    } finally {
      Object.assign(process.env, origEnv);
      vi.resetModules();
    }
  });
});

// ---- Event hash stability ----

describe("event payload hash stability", () => {
  const baseInput = {
    planId: "plan-1",
    planItemId: "item-1",
    sessionId: "sess-1",
    userId: "user-1",
    calendarId: "primary",
    courseName: "CS101",
    examName: "Midterm",
    mode: "RETRIEVAL",
    topicScope: "Linked lists",
    plannedMinutes: 60,
    startTime: "2025-02-01T09:00:00Z",
    endTime: "2025-02-01T10:00:00Z",
    timezone: "America/New_York",
    objectives: ["Obj A", "Obj B"],
    targetOutcome: null,
    breakProtocol: null,
    baseUrl: "http://localhost:3000",
  };

  it("produces identical hash for identical input", () => {
    const a = buildEventPayload(baseInput);
    const b = buildEventPayload(baseInput);
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toHaveLength(64); // SHA-256 hex
  });

  it("changes hash when content changes", () => {
    const a = buildEventPayload(baseInput);
    const b = buildEventPayload({ ...baseInput, startTime: "2025-02-01T10:00:00Z" });
    expect(a.hash).not.toBe(b.hash);
  });

  it("computeEventHash produces same result as buildEventPayload hash", () => {
    const result = buildEventPayload(baseInput);
    const manualHash = computeEventHash(result.input);
    expect(manualHash).toBe(result.hash);
  });

  it("unchanged hash means unchanged content should be skipped", () => {
    const first = buildEventPayload(baseInput);
    const second = buildEventPayload(baseInput);
    // Simulate the skip logic
    const shouldSkip = first.hash === second.hash;
    expect(shouldSkip).toBe(true);
  });
});

// ---- GoogleReconnectError ----

describe("GoogleReconnectError", () => {
  it("has correct code and is distinguishable from GoogleApiError", () => {
    const err = new GoogleReconnectError("invalid_grant");
    expect(err.code).toBe("GOOGLE_RECONNECT_REQUIRED");
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(GoogleApiError);
  });
});

// ---- FakeClient error simulation ----

describe("FakeGoogleCalendarClient", () => {
  let client: FakeGoogleCalendarClient;

  beforeEach(() => {
    client = new FakeGoogleCalendarClient();
  });

  it("simulates 429 rate limit then success", async () => {
    client.simulateErrors.push({
      method: "createEvent",
      error: new GoogleApiError("Rate limit", 429),
      once: true,
    });

    // First call throws
    await expect(
      client.createEvent({
        calendarId: "primary",
        summary: "Test",
        start: "2025-01-01T09:00:00Z",
        end: "2025-01-01T10:00:00Z",
      }),
    ).rejects.toThrow("Rate limit");

    // Second call succeeds (once=true removed the error)
    const event = await client.createEvent({
      calendarId: "primary",
      summary: "Test",
      start: "2025-01-01T09:00:00Z",
      end: "2025-01-01T10:00:00Z",
    });
    expect(event.id).toBeTruthy();
  });

  it("simulates invalid_grant failure mode", async () => {
    client.simulateErrors.push({
      method: "listCalendars",
      error: new GoogleReconnectError("invalid_grant"),
    });

    await expect(client.listCalendars()).rejects.toThrow("invalid_grant");
  });

  it("tracks calls in callLog", async () => {
    await client.listCalendars();
    await client.createEvent({
      calendarId: "primary",
      summary: "Test",
      start: "2025-01-01T09:00:00Z",
      end: "2025-01-01T10:00:00Z",
    });

    expect(client.callLog).toHaveLength(2);
    expect(client.callLog[0].method).toBe("listCalendars");
    expect(client.callLog[1].method).toBe("createEvent");
  });

  it("handles manual deletion → updateEvent returns 404", async () => {
    const event = await client.createEvent({
      calendarId: "primary",
      summary: "Test",
      start: "2025-01-01T09:00:00Z",
      end: "2025-01-01T10:00:00Z",
    });

    client.simulateManualDelete(event.id);

    await expect(
      client.updateEvent("primary", event.id, { summary: "Updated" }),
    ).rejects.toThrow(GoogleApiError);
  });

  it("deleteEvent on missing event is silent (no error)", async () => {
    await expect(
      client.deleteEvent("primary", "nonexistent"),
    ).resolves.toBeUndefined();
  });

  it("returns calendars with accessRole and timeZone", async () => {
    const cals = await client.listCalendars();
    expect(cals[0].accessRole).toBe("owner");
    expect(cals[0].timeZone).toBe("America/New_York");
  });

  it("clearCallLog resets the log", async () => {
    await client.listCalendars();
    expect(client.callLog).toHaveLength(1);
    client.clearCallLog();
    expect(client.callLog).toHaveLength(0);
  });
});
