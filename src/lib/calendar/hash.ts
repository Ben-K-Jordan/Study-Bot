/**
 * Stable hashing for calendar event payloads.
 *
 * Used for "skip unchanged" logic: if the hash of a new payload matches
 * the last-synced hash, the event doesn't need updating.
 *
 * Deterministic: same inputs always produce the same hash regardless of
 * key insertion order.
 */
import { createHash } from "crypto";
import type { CalendarEventPayload } from "./types";

/**
 * Sort object keys recursively for deterministic serialization.
 */
function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return "[" + obj.map(stableStringify).join(",") + "]";
  }
  const sorted = Object.keys(obj as Record<string, unknown>).sort();
  const entries = sorted.map(
    (k) => JSON.stringify(k) + ":" + stableStringify((obj as Record<string, unknown>)[k]),
  );
  return "{" + entries.join(",") + "}";
}

/**
 * Compute a SHA-256 hex hash of the event payload.
 *
 * Only hashes fields that affect the calendar event content (not calendarId).
 */
export function computeEventHash(payload: CalendarEventPayload): string {
  const hashable = {
    summary: payload.summary,
    description: payload.description,
    start: payload.start,
    end: payload.end,
    timeZone: payload.timeZone,
    transparency: payload.transparency,
    extendedProperties: payload.extendedProperties,
  };
  return createHash("sha256").update(stableStringify(hashable)).digest("hex");
}

/**
 * Compute a SHA-256 hex hash of an arbitrary object (stable key ordering).
 */
export function stableHash(obj: unknown): string {
  return createHash("sha256").update(stableStringify(obj)).digest("hex");
}

/**
 * Short hash of user ID for extended properties (no PII).
 */
export function hashUserId(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 16);
}
