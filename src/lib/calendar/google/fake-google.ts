/**
 * Fake Google Calendar provider — complete in-memory simulation.
 *
 * Implements CalendarClient for CI/tests without real Google API calls.
 *
 * Features:
 *   - Deterministic event IDs (seeded counter).
 *   - In-memory calendar and event storage.
 *   - Free/busy query returns deterministic busy blocks.
 *   - Injected failure modes: 401→refresh, invalid_grant, 429→retry.
 *   - Call logging for test assertions.
 *   - upsertEvent with skip-unchanged support.
 */
import type { CalendarClient } from "../provider";
import type {
  CalendarListItem,
  BusyBlock,
  CalendarEventPayload,
  CalendarEventUpsertResult,
  CalendarEvent,
  DeleteEventResult,
  HealthCheckResult,
  FreeBusyOptions,
  EventListOptions,
} from "../types";
import { computeEventHash } from "../hash";

// ---- Error types (mirror Google errors for test compatibility) ----

export class FakeApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "FakeApiError";
    this.status = status;
  }
}

export class FakeReconnectError extends Error {
  code = "GOOGLE_RECONNECT_REQUIRED" as const;
  constructor(reason: string) {
    super(`Reconnect required: ${reason}`);
    this.name = "FakeReconnectError";
  }
}

// ---- Failure injection ----

export interface SimulatedError {
  method: string;
  error: Error;
  /** If true, error fires once then is removed. */
  once?: boolean;
}

// ---- Internal event storage ----

interface StoredEvent extends CalendarEvent {
  calendarId: string;
  extendedProperties?: Record<string, string>;
  description?: string;
  timeZone?: string;
}

// ---- Implementation ----

export class FakeCalendarClient implements CalendarClient {
  private calendars: CalendarListItem[];
  private busyBlocks: BusyBlock[];
  private events = new Map<string, StoredEvent>();
  private nextId: number;

  /** Track call history for test assertions. */
  callLog: { method: string; args: unknown[] }[] = [];

  /** Inject failure modes. */
  simulateErrors: SimulatedError[] = [];

  /** Track whether a "refresh" was attempted (for 401 scenario testing). */
  refreshAttempted = false;

  constructor(options?: {
    calendars?: CalendarListItem[];
    busy?: BusyBlock[];
    seed?: number;
  }) {
    this.calendars = options?.calendars ?? [
      { id: "primary", summary: "Primary", primary: true, accessRole: "owner", timeZone: "America/New_York" },
      { id: "work", summary: "Work Calendar", primary: false, accessRole: "writer", timeZone: "America/New_York" },
    ];
    this.busyBlocks = options?.busy ?? [];
    this.nextId = options?.seed ?? 1;
  }

  // ---- Error injection ----

  private checkError(method: string): void {
    const idx = this.simulateErrors.findIndex((e) => e.method === method);
    if (idx >= 0) {
      const entry = this.simulateErrors[idx];
      if (entry.once) this.simulateErrors.splice(idx, 1);
      throw entry.error;
    }
  }

  // ---- CalendarClient interface ----

  async listCalendars(): Promise<CalendarListItem[]> {
    this.callLog.push({ method: "listCalendars", args: [] });
    this.checkError("listCalendars");
    return [...this.calendars];
  }

  async freeBusy(opts: FreeBusyOptions): Promise<BusyBlock[]> {
    this.callLog.push({ method: "freeBusy", args: [opts] });
    this.checkError("freeBusy");
    const min = new Date(opts.timeMin).getTime();
    const max = new Date(opts.timeMax).getTime();
    return this.busyBlocks.filter((b) => {
      const s = new Date(b.start).getTime();
      const e = new Date(b.end).getTime();
      return s < max && e > min && opts.calendarIds.includes(b.calendarId);
    });
  }

  async upsertEvent(
    calendarId: string,
    externalKey: string,
    payload: CalendarEventPayload,
    opts?: { existingEventId?: string; lastHash?: string; newHash?: string },
  ): Promise<CalendarEventUpsertResult> {
    this.callLog.push({ method: "upsertEvent", args: [calendarId, externalKey, payload, opts] });
    this.checkError("upsertEvent");

    const newHash = opts?.newHash ?? computeEventHash(payload);

    // Skip-unchanged
    if (opts?.lastHash && opts.lastHash === newHash && opts.existingEventId) {
      return { action: "UNCHANGED", eventId: opts.existingEventId };
    }

    // Update existing
    if (opts?.existingEventId) {
      const existing = this.events.get(opts.existingEventId);
      if (!existing) {
        // Externally deleted — recreate
        const event = this.insertEvent(calendarId, payload);
        return { action: "CREATED", eventId: event.id, htmlLink: event.htmlLink, etag: event.etag };
      }
      this.applyUpdate(existing, payload);
      return { action: "UPDATED", eventId: existing.id, htmlLink: existing.htmlLink, etag: existing.etag };
    }

    // Try reconciliation by extended property key
    const [propKey, propValue] = externalKey.split("=", 2);
    for (const ev of this.events.values()) {
      if (ev.calendarId === calendarId && ev.extendedProperties?.[propKey] === propValue) {
        this.applyUpdate(ev, payload);
        return { action: "UPDATED", eventId: ev.id, htmlLink: ev.htmlLink, etag: ev.etag };
      }
    }

    // Create new
    const event = this.insertEvent(calendarId, payload);
    return { action: "CREATED", eventId: event.id, htmlLink: event.htmlLink, etag: event.etag };
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<DeleteEventResult> {
    this.callLog.push({ method: "deleteEvent", args: [calendarId, eventId] });
    this.checkError("deleteEvent");
    if (!this.events.has(eventId)) {
      return { ok: true, notFound: true };
    }
    this.events.delete(eventId);
    return { ok: true };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    this.callLog.push({ method: "healthCheck", args: [] });
    this.checkError("healthCheck");
    return { ok: true };
  }

  async listEvents(options: EventListOptions): Promise<CalendarEvent[]> {
    this.callLog.push({ method: "listEvents", args: [options] });
    this.checkError("listEvents");
    const results: CalendarEvent[] = [];
    for (const event of this.events.values()) {
      if (event.calendarId !== options.calendarId) continue;
      if (options.privateExtendedProperty) {
        const [key, value] = options.privateExtendedProperty.split("=", 2);
        if (!event.extendedProperties || event.extendedProperties[key] !== value) continue;
      }
      results.push({
        id: event.id,
        summary: event.summary,
        start: event.start,
        end: event.end,
        htmlLink: event.htmlLink,
        etag: event.etag,
        updated: event.updated,
      });
      if (results.length >= (options.maxResults ?? 10)) break;
    }
    return results;
  }

  async createEvent(calendarId: string, payload: CalendarEventPayload): Promise<CalendarEvent> {
    this.callLog.push({ method: "createEvent", args: [calendarId, payload] });
    this.checkError("createEvent");
    return this.insertEvent(calendarId, payload);
  }

  async updateEvent(calendarId: string, eventId: string, payload: Partial<CalendarEventPayload>): Promise<CalendarEvent> {
    this.callLog.push({ method: "updateEvent", args: [calendarId, eventId, payload] });
    this.checkError("updateEvent");
    const existing = this.events.get(eventId);
    if (!existing) throw new FakeApiError("Event not found", 404);
    this.applyUpdate(existing, payload);
    return {
      id: existing.id,
      summary: existing.summary,
      start: existing.start,
      end: existing.end,
      htmlLink: existing.htmlLink,
      etag: existing.etag,
      updated: existing.updated,
    };
  }

  // ---- Test helpers ----

  /** Set busy blocks for freeBusy queries. */
  setBusy(busy: BusyBlock[]) {
    this.busyBlocks = busy;
  }

  /** Get all stored events. */
  getEvents(): StoredEvent[] {
    return [...this.events.values()];
  }

  /** Simulate external event deletion (e.g. user deletes in Google UI). */
  simulateManualDelete(eventId: string) {
    this.events.delete(eventId);
  }

  /** Reset call log. */
  clearCallLog() {
    this.callLog.length = 0;
  }

  /** Reset all state. */
  reset() {
    this.events.clear();
    this.callLog.length = 0;
    this.simulateErrors.length = 0;
    this.nextId = 1;
    this.refreshAttempted = false;
  }

  // ---- Internal helpers ----

  private insertEvent(calendarId: string, payload: CalendarEventPayload): StoredEvent {
    const id = `fake_event_${this.nextId++}`;
    const event: StoredEvent = {
      id,
      calendarId,
      summary: payload.summary,
      description: payload.description,
      start: payload.start,
      end: payload.end,
      timeZone: payload.timeZone,
      htmlLink: `https://calendar.google.com/event?eid=${id}`,
      etag: `"etag_${id}"`,
      updated: new Date().toISOString(),
      extendedProperties: payload.extendedProperties,
    };
    this.events.set(id, event);
    return event;
  }

  private applyUpdate(event: StoredEvent, payload: Partial<CalendarEventPayload>) {
    if (payload.summary !== undefined) event.summary = payload.summary;
    if (payload.description !== undefined) event.description = payload.description;
    if (payload.start !== undefined) event.start = payload.start;
    if (payload.end !== undefined) event.end = payload.end;
    if (payload.timeZone !== undefined) event.timeZone = payload.timeZone;
    if (payload.extendedProperties !== undefined) event.extendedProperties = payload.extendedProperties;
    event.updated = new Date().toISOString();
    event.etag = `"etag_${event.id}_${Date.now()}"`;
  }
}
