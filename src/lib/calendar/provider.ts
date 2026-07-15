/**
 * CalendarClient — provider-agnostic interface for calendar operations.
 *
 * All API routes and services interact with calendars through this interface.
 * Concrete implementations:
 *   - GoogleCalendarAdapter (src/lib/calendar/google/google-client.ts)
 *   - FakeCalendarClient   (src/lib/calendar/google/fake-google.ts)
 *
 * No route or service should call Google (or any provider) directly.
 */
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
} from "./types";

export interface CalendarClient {
  /** List calendars the user has access to. */
  listCalendars(): Promise<CalendarListItem[]>;

  /** Query free/busy blocks for one or more calendars. */
  freeBusy(opts: FreeBusyOptions): Promise<BusyBlock[]>;

  /**
   * Create or update a calendar event.
   *
   * @param calendarId  Target calendar.
   * @param externalKey Private extended-property key for reconciliation
   *                    (e.g. "sb_item=<planItemId>").
   * @param payload     Event payload to write.
   * @param opts        Optional: existingEventId for update path,
   *                    lastHash for skip-unchanged.
   */
  upsertEvent(
    calendarId: string,
    externalKey: string,
    payload: CalendarEventPayload,
    opts?: { existingEventId?: string; lastHash?: string; newHash?: string },
  ): Promise<CalendarEventUpsertResult>;

  /** Delete a calendar event. Returns { ok, notFound }. */
  deleteEvent(calendarId: string, eventId: string): Promise<DeleteEventResult>;

  /** Verify credentials are valid and API is reachable. */
  healthCheck(): Promise<HealthCheckResult>;

  /** List events matching filter criteria. */
  listEvents(options: EventListOptions): Promise<CalendarEvent[]>;

  /** Create a single event (low-level, used by upsertEvent internally). */
  createEvent(calendarId: string, payload: CalendarEventPayload): Promise<CalendarEvent>;

  /** Update a single event (low-level, used by upsertEvent internally). */
  updateEvent(calendarId: string, eventId: string, payload: Partial<CalendarEventPayload>): Promise<CalendarEvent>;
}
