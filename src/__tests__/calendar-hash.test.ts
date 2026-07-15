/**
 * Unit tests for calendar event hashing.
 *
 * Tests:
 * - Stable hash for same object regardless of key insertion order
 * - Hash changes when content changes
 * - hashUserId produces consistent short hashes
 */
import { describe, it, expect } from "vitest";
import { computeEventHash, stableHash, hashUserId } from "@/lib/calendar/hash";
import type { CalendarEventPayload } from "@/lib/calendar/types";

describe("computeEventHash", () => {
  const basePayload: CalendarEventPayload = {
    summary: "CS101 | Midterm | Retrieval: Linked lists",
    description: "StudyBot session: http://localhost:3000/s/abc",
    start: "2025-06-01T09:00:00Z",
    end: "2025-06-01T10:00:00Z",
    timeZone: "America/New_York",
    transparency: "opaque",
    extendedProperties: { sb_plan: "plan-1", sb_item: "item-1" },
  };

  it("produces identical hash for identical input", () => {
    const a = computeEventHash(basePayload);
    const b = computeEventHash(basePayload);
    expect(a).toBe(b);
    expect(a).toHaveLength(64); // SHA-256 hex
  });

  it("changes hash when summary changes", () => {
    const modified = { ...basePayload, summary: "Different title" };
    expect(computeEventHash(modified)).not.toBe(computeEventHash(basePayload));
  });

  it("changes hash when start time changes", () => {
    const modified = { ...basePayload, start: "2025-06-01T10:00:00Z" };
    expect(computeEventHash(modified)).not.toBe(computeEventHash(basePayload));
  });

  it("changes hash when description changes", () => {
    const modified = { ...basePayload, description: "Different description" };
    expect(computeEventHash(modified)).not.toBe(computeEventHash(basePayload));
  });

  it("changes hash when extended properties change", () => {
    const modified = { ...basePayload, extendedProperties: { sb_plan: "plan-2", sb_item: "item-1" } };
    expect(computeEventHash(modified)).not.toBe(computeEventHash(basePayload));
  });

  it("is stable regardless of key insertion order in extended properties", () => {
    const a: CalendarEventPayload = {
      ...basePayload,
      extendedProperties: { sb_plan: "plan-1", sb_item: "item-1", sb_sess: "sess-1" },
    };
    const b: CalendarEventPayload = {
      ...basePayload,
      extendedProperties: { sb_sess: "sess-1", sb_item: "item-1", sb_plan: "plan-1" },
    };
    expect(computeEventHash(a)).toBe(computeEventHash(b));
  });
});

describe("stableHash", () => {
  it("produces same hash regardless of key insertion order", () => {
    const a = { z: 1, a: 2, m: 3 };
    const b = { a: 2, m: 3, z: 1 };
    expect(stableHash(a)).toBe(stableHash(b));
  });

  it("handles nested objects", () => {
    const a = { outer: { z: 1, a: 2 }, b: 3 };
    const b = { b: 3, outer: { a: 2, z: 1 } };
    expect(stableHash(a)).toBe(stableHash(b));
  });

  it("different values produce different hashes", () => {
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
  });
});

describe("hashUserId", () => {
  it("produces consistent 16-char hex string", () => {
    const hash = hashUserId("user-123");
    expect(hash).toHaveLength(16);
    expect(/^[0-9a-f]{16}$/.test(hash)).toBe(true);

    // Same input → same output
    expect(hashUserId("user-123")).toBe(hash);
  });

  it("different users produce different hashes", () => {
    expect(hashUserId("user-1")).not.toBe(hashUserId("user-2"));
  });
});
