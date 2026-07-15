/**
 * Calendar module — barrel exports.
 *
 * Usage:
 *   import { CalendarClient, CalendarEvent, computeEventHash } from "@/lib/calendar";
 *   import { FakeCalendarClient } from "@/lib/calendar/google/fake-google";
 *   import { GoogleCalendarAdapter } from "@/lib/calendar/google/google-client";
 */

// Provider-agnostic types
export type {
  CalendarProvider,
  CalendarIntegrationStatus,
  CalendarEventUpsertResult,
  CalendarPublishSummary,
  CalendarListItem,
  BusyBlock,
  CalendarEventPayload,
  CalendarEvent,
  FreeBusyOptions,
  EventListOptions,
  DeleteEventResult,
  HealthCheckResult,
} from "./types";

// Provider interface
export type { CalendarClient } from "./provider";

// Hashing
export { computeEventHash, stableHash, hashUserId } from "./hash";

// Google adapter
export { GoogleCalendarAdapter } from "./google/google-client";
export { GoogleApiError, GoogleReconnectError } from "./google/google-client";

// Fake client for tests
export { FakeCalendarClient, FakeApiError, FakeReconnectError } from "./google/fake-google";

// ---- Factory ----

import type { CalendarClient } from "./provider";
import { GoogleCalendarAdapter } from "./google/google-client";

let _clientFactory: ((userId: string) => CalendarClient) | null = null;

/**
 * Override the calendar client factory (for tests).
 */
export function setCalendarClientFactory(factory: (userId: string) => CalendarClient) {
  _clientFactory = factory;
}

/**
 * Reset to default factory.
 */
export function resetCalendarClientFactory() {
  _clientFactory = null;
}

/**
 * Get a CalendarClient for the given user.
 *
 * In production: returns GoogleCalendarAdapter.
 * In tests: returns whatever was set via setCalendarClientFactory.
 */
export function getCalendarClient(userId: string): CalendarClient {
  if (_clientFactory) return _clientFactory(userId);
  return new GoogleCalendarAdapter(userId);
}
