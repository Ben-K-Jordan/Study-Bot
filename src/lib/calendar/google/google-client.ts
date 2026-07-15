/**
 * Google Calendar adapter — implements CalendarClient using the existing
 * Google Calendar infrastructure.
 *
 * Wraps RealGoogleCalendarClient with the provider-agnostic interface,
 * adding upsertEvent (with skip-unchanged) and healthCheck semantics.
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
import {
  RealGoogleCalendarClient,
  GoogleApiError,
  GoogleReconnectError,
  type CalendarEventInput,
} from "@/lib/google/calendar-client";

// Re-export error types for convenience
export { GoogleApiError, GoogleReconnectError } from "@/lib/google/calendar-client";

/**
 * Convert provider-agnostic payload to Google-specific CalendarEventInput.
 */
function toGoogleInput(calendarId: string, payload: CalendarEventPayload): CalendarEventInput {
  return {
    calendarId,
    summary: payload.summary,
    description: payload.description,
    start: payload.start,
    end: payload.end,
    timeZone: payload.timeZone,
    transparency: payload.transparency,
    reminders: payload.reminders,
    extendedProperties: payload.extendedProperties,
  };
}

/**
 * Convert Google CalendarEvent to provider-agnostic CalendarEvent.
 */
function fromGoogleEvent(ge: { id: string; summary: string; start: string; end: string; htmlLink?: string; etag?: string; updated?: string; status?: string }): CalendarEvent {
  return {
    id: ge.id,
    summary: ge.summary,
    start: ge.start,
    end: ge.end,
    htmlLink: ge.htmlLink,
    etag: ge.etag,
    updated: ge.updated,
    status: ge.status,
  };
}

export class GoogleCalendarAdapter implements CalendarClient {
  private inner: RealGoogleCalendarClient;

  constructor(userId: string) {
    this.inner = new RealGoogleCalendarClient(userId);
  }

  async listCalendars(): Promise<CalendarListItem[]> {
    return this.inner.listCalendars();
  }

  async freeBusy(opts: FreeBusyOptions): Promise<BusyBlock[]> {
    const intervals = await this.inner.freebusyQuery({
      timeMin: opts.timeMin,
      timeMax: opts.timeMax,
      calendarIds: opts.calendarIds,
      timeZone: opts.timeZone,
    });
    return intervals.map((i) => ({
      calendarId: i.calendarId,
      start: i.start,
      end: i.end,
    }));
  }

  async upsertEvent(
    calendarId: string,
    externalKey: string,
    payload: CalendarEventPayload,
    opts?: { existingEventId?: string; lastHash?: string; newHash?: string },
  ): Promise<CalendarEventUpsertResult> {
    const newHash = opts?.newHash ?? computeEventHash(payload);

    // Skip-unchanged: if hashes match, no update needed
    if (opts?.lastHash && opts.lastHash === newHash && opts.existingEventId) {
      return { action: "UNCHANGED", eventId: opts.existingEventId };
    }

    try {
      if (opts?.existingEventId) {
        // Update path
        const event = await this.inner.updateEvent(calendarId, opts.existingEventId, toGoogleInput(calendarId, payload));
        return {
          action: "UPDATED",
          eventId: event.id,
          htmlLink: event.htmlLink,
          etag: event.etag,
        };
      }

      // Try reconciliation: find existing event by extended property
      const existing = await this.inner.listEvents({
        calendarId,
        privateExtendedProperty: externalKey,
        maxResults: 1,
      });

      if (existing.length > 0) {
        const event = await this.inner.updateEvent(calendarId, existing[0].id, toGoogleInput(calendarId, payload));
        return {
          action: "UPDATED",
          eventId: event.id,
          htmlLink: event.htmlLink,
          etag: event.etag,
        };
      }

      // Create new
      const event = await this.inner.createEvent(toGoogleInput(calendarId, payload));
      return {
        action: "CREATED",
        eventId: event.id,
        htmlLink: event.htmlLink,
        etag: event.etag,
      };
    } catch (err) {
      if (err instanceof GoogleReconnectError) throw err;
      if (err instanceof GoogleApiError && err.status === 404 && opts?.existingEventId) {
        // Event was deleted externally — recreate
        try {
          const event = await this.inner.createEvent(toGoogleInput(calendarId, payload));
          return {
            action: "CREATED",
            eventId: event.id,
            htmlLink: event.htmlLink,
            etag: event.etag,
          };
        } catch (createErr) {
          return {
            action: "FAILED",
            error: {
              code: createErr instanceof GoogleApiError ? String(createErr.status) : "UNKNOWN",
              message: String(createErr),
            },
          };
        }
      }
      return {
        action: "FAILED",
        error: {
          code: err instanceof GoogleApiError ? String(err.status) : "UNKNOWN",
          message: String(err),
        },
      };
    }
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<DeleteEventResult> {
    try {
      await this.inner.deleteEvent(calendarId, eventId);
      return { ok: true };
    } catch (err) {
      if (err instanceof GoogleApiError && (err.status === 404 || err.status === 410)) {
        return { ok: true, notFound: true };
      }
      throw err;
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    try {
      await this.inner.listCalendars();
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof GoogleReconnectError
          ? "GOOGLE_RECONNECT_REQUIRED"
          : String(err),
      };
    }
  }

  async listEvents(options: EventListOptions): Promise<CalendarEvent[]> {
    const events = await this.inner.listEvents(options);
    return events.map(fromGoogleEvent);
  }

  async createEvent(calendarId: string, payload: CalendarEventPayload): Promise<CalendarEvent> {
    const event = await this.inner.createEvent(toGoogleInput(calendarId, payload));
    return fromGoogleEvent(event);
  }

  async updateEvent(calendarId: string, eventId: string, payload: Partial<CalendarEventPayload>): Promise<CalendarEvent> {
    const event = await this.inner.updateEvent(calendarId, eventId, toGoogleInput(calendarId, payload as CalendarEventPayload));
    return fromGoogleEvent(event);
  }
}
