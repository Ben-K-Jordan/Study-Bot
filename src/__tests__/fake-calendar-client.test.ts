/**
 * Unit tests for FakeCalendarClient.
 *
 * Tests:
 * - insert/update/delete lifecycle
 * - 404 delete treated as notFound (not error)
 * - upsertEvent skip-unchanged
 * - upsertEvent reconciliation via extended property
 * - freeBusy query filtering
 * - error injection (401, invalid_grant, 429)
 * - call log tracking
 * - healthCheck
 */
import { describe, it, expect, beforeEach } from "vitest";
import { FakeCalendarClient, FakeApiError, FakeReconnectError } from "@/lib/calendar/google/fake-google";
import { computeEventHash } from "@/lib/calendar/hash";
import type { CalendarEventPayload } from "@/lib/calendar/types";

const testPayload: CalendarEventPayload = {
  summary: "Test Event",
  start: "2025-06-01T09:00:00Z",
  end: "2025-06-01T10:00:00Z",
  timeZone: "America/New_York",
  extendedProperties: { sb_item: "item-1" },
};

describe("FakeCalendarClient", () => {
  let client: FakeCalendarClient;

  beforeEach(() => {
    client = new FakeCalendarClient({ seed: 100 });
  });

  describe("listCalendars", () => {
    it("returns default calendars (primary + work)", async () => {
      const cals = await client.listCalendars();
      expect(cals).toHaveLength(2);
      expect(cals[0].id).toBe("primary");
      expect(cals[0].primary).toBe(true);
      expect(cals[1].id).toBe("work");
    });
  });

  describe("event lifecycle: create → update → delete", () => {
    it("creates, updates, and deletes an event", async () => {
      // Create
      const created = await client.createEvent("primary", testPayload);
      expect(created.id).toBe("fake_event_100");
      expect(created.summary).toBe("Test Event");

      // Update
      const updated = await client.updateEvent("primary", created.id, { summary: "Updated" });
      expect(updated.id).toBe(created.id);
      expect(updated.summary).toBe("Updated");

      // Delete
      const result = await client.deleteEvent("primary", created.id);
      expect(result.ok).toBe(true);
      expect(result.notFound).toBeUndefined();

      // Verify gone
      expect(client.getEvents()).toHaveLength(0);
    });
  });

  describe("deleteEvent — missing event", () => {
    it("returns ok=true with notFound=true for nonexistent event", async () => {
      const result = await client.deleteEvent("primary", "nonexistent");
      expect(result.ok).toBe(true);
      expect(result.notFound).toBe(true);
    });
  });

  describe("updateEvent — missing event", () => {
    it("throws FakeApiError(404) for nonexistent event", async () => {
      await expect(
        client.updateEvent("primary", "nonexistent", { summary: "X" }),
      ).rejects.toThrow(FakeApiError);
      try {
        await client.updateEvent("primary", "nonexistent", { summary: "X" });
      } catch (err) {
        expect((err as FakeApiError).status).toBe(404);
      }
    });
  });

  describe("upsertEvent", () => {
    it("creates new event when no existing event", async () => {
      const result = await client.upsertEvent("primary", "sb_item=item-1", testPayload);
      expect(result.action).toBe("CREATED");
      expect(result.eventId).toBeTruthy();
    });

    it("updates existing event by existingEventId", async () => {
      const created = await client.createEvent("primary", testPayload);
      const modified = { ...testPayload, summary: "Updated" };
      const result = await client.upsertEvent("primary", "sb_item=item-1", modified, {
        existingEventId: created.id,
      });
      expect(result.action).toBe("UPDATED");
      expect(result.eventId).toBe(created.id);
    });

    it("skips when hash is unchanged", async () => {
      const created = await client.createEvent("primary", testPayload);
      const hash = computeEventHash(testPayload);
      const result = await client.upsertEvent("primary", "sb_item=item-1", testPayload, {
        existingEventId: created.id,
        lastHash: hash,
        newHash: hash,
      });
      expect(result.action).toBe("UNCHANGED");
    });

    it("reconciles by extended property when no existingEventId", async () => {
      await client.createEvent("primary", testPayload);
      const modified = { ...testPayload, summary: "Reconciled" };
      const result = await client.upsertEvent("primary", "sb_item=item-1", modified);
      expect(result.action).toBe("UPDATED");
    });

    it("recreates when existingEventId was externally deleted", async () => {
      const created = await client.createEvent("primary", testPayload);
      client.simulateManualDelete(created.id);
      const result = await client.upsertEvent("primary", "sb_item=item-1", testPayload, {
        existingEventId: created.id,
      });
      expect(result.action).toBe("CREATED");
    });
  });

  describe("freeBusy", () => {
    it("returns busy blocks within time range", async () => {
      client.setBusy([
        { calendarId: "primary", start: "2025-06-01T10:00:00Z", end: "2025-06-01T11:00:00Z" },
        { calendarId: "primary", start: "2025-06-02T10:00:00Z", end: "2025-06-02T11:00:00Z" },
        { calendarId: "work", start: "2025-06-01T12:00:00Z", end: "2025-06-01T13:00:00Z" },
      ]);

      const result = await client.freeBusy({
        timeMin: "2025-06-01T00:00:00Z",
        timeMax: "2025-06-01T23:59:59Z",
        calendarIds: ["primary"],
      });

      expect(result).toHaveLength(1);
      expect(result[0].calendarId).toBe("primary");
    });
  });

  describe("listEvents", () => {
    it("filters by calendarId", async () => {
      await client.createEvent("primary", testPayload);
      const results = await client.listEvents({ calendarId: "work" });
      expect(results).toHaveLength(0);

      const results2 = await client.listEvents({ calendarId: "primary" });
      expect(results2).toHaveLength(1);
    });

    it("filters by privateExtendedProperty", async () => {
      await client.createEvent("primary", testPayload);
      await client.createEvent("primary", { ...testPayload, extendedProperties: { sb_item: "item-2" } });

      const results = await client.listEvents({
        calendarId: "primary",
        privateExtendedProperty: "sb_item=item-1",
      });
      expect(results).toHaveLength(1);
    });
  });

  describe("healthCheck", () => {
    it("returns ok by default", async () => {
      const result = await client.healthCheck();
      expect(result.ok).toBe(true);
    });

    it("returns failure when error injected", async () => {
      client.simulateErrors.push({
        method: "healthCheck",
        error: new FakeReconnectError("invalid_grant"),
      });
      await expect(client.healthCheck()).rejects.toThrow("invalid_grant");
    });
  });

  describe("error injection", () => {
    it("simulates 429 rate limit then success (once=true)", async () => {
      client.simulateErrors.push({
        method: "createEvent",
        error: new FakeApiError("Rate limit", 429),
        once: true,
      });

      // First call throws
      await expect(client.createEvent("primary", testPayload)).rejects.toThrow("Rate limit");

      // Second call succeeds (error was once)
      const event = await client.createEvent("primary", testPayload);
      expect(event.id).toBeTruthy();
    });

    it("simulates invalid_grant reconnect error", async () => {
      client.simulateErrors.push({
        method: "listCalendars",
        error: new FakeReconnectError("invalid_grant"),
      });

      await expect(client.listCalendars()).rejects.toThrow("invalid_grant");
      // Error persists (once not set)
      await expect(client.listCalendars()).rejects.toThrow("invalid_grant");
    });

    it("simulates 401 then refresh success scenario", async () => {
      client.simulateErrors.push({
        method: "listCalendars",
        error: new FakeApiError("Unauthorized", 401),
        once: true,
      });

      // First call fails
      await expect(client.listCalendars()).rejects.toThrow("Unauthorized");

      // After "refresh" (simulated by once=true removal), next call works
      const cals = await client.listCalendars();
      expect(cals.length).toBeGreaterThan(0);
    });
  });

  describe("call log", () => {
    it("tracks all method calls", async () => {
      await client.listCalendars();
      await client.createEvent("primary", testPayload);
      await client.healthCheck();

      expect(client.callLog).toHaveLength(3);
      expect(client.callLog[0].method).toBe("listCalendars");
      expect(client.callLog[1].method).toBe("createEvent");
      expect(client.callLog[2].method).toBe("healthCheck");
    });

    it("clearCallLog resets the log", async () => {
      await client.listCalendars();
      expect(client.callLog).toHaveLength(1);
      client.clearCallLog();
      expect(client.callLog).toHaveLength(0);
    });
  });

  describe("deterministic event IDs", () => {
    it("generates predictable IDs from seed", async () => {
      const a = await client.createEvent("primary", testPayload);
      const b = await client.createEvent("primary", testPayload);
      expect(a.id).toBe("fake_event_100");
      expect(b.id).toBe("fake_event_101");
    });
  });

  describe("reset", () => {
    it("clears all state", async () => {
      await client.createEvent("primary", testPayload);
      client.simulateErrors.push({ method: "test", error: new Error("x") });
      client.reset();
      expect(client.getEvents()).toHaveLength(0);
      expect(client.callLog).toHaveLength(0);
      expect(client.simulateErrors).toHaveLength(0);
    });
  });
});
