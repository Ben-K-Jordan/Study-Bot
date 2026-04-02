/**
 * Provider-agnostic calendar integration types.
 *
 * These types form the contract between the calendar module and the rest of
 * the application. Provider-specific implementations (Google, Outlook, etc.)
 * implement the CalendarClient interface from ./provider.ts using these types.
 */

// ---- Provider enum ----

export type CalendarProvider = "GOOGLE"; // future: "OUTLOOK" | "APPLE"

// ---- Integration status ----

export type CalendarIntegrationStatus = "CONNECTED" | "DISCONNECTED" | "ERROR";

// ---- Event upsert result ----

export interface CalendarEventUpsertResult {
  action: "CREATED" | "UPDATED" | "UNCHANGED" | "FAILED";
  eventId?: string;
  htmlLink?: string;
  etag?: string;
  error?: { code: string; message: string };
}

// ---- Publish summary ----

export interface CalendarPublishSummary {
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  total: number;
}

// ---- Calendar list item ----

export interface CalendarListItem {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole?: string;
  timeZone?: string;
}

// ---- Busy block ----

export interface BusyBlock {
  calendarId: string;
  start: string; // ISO 8601
  end: string;   // ISO 8601
}

// ---- Event payload (for upsert) ----

export interface CalendarEventPayload {
  summary: string;
  description?: string;
  start: string; // ISO RFC3339
  end: string;   // ISO RFC3339
  timeZone?: string;
  transparency?: "opaque" | "transparent";
  reminders?: { useDefault: boolean; overrides?: { method: string; minutes: number }[] };
  extendedProperties?: Record<string, string>;
}

// ---- Event (returned from provider) ----

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  htmlLink?: string;
  etag?: string;
  updated?: string;
  status?: string;
}

// ---- Free/Busy query options ----

export interface FreeBusyOptions {
  timeMin: string;
  timeMax: string;
  calendarIds: string[];
  timeZone?: string;
}

// ---- Event list options ----

export interface EventListOptions {
  calendarId: string;
  privateExtendedProperty?: string;
  maxResults?: number;
}

// ---- Delete result ----

export interface DeleteEventResult {
  ok: boolean;
  notFound?: boolean;
}

// ---- Health check result ----

export interface HealthCheckResult {
  ok: boolean;
  reason?: string;
}
