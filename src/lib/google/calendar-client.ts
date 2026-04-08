/**
 * Google Calendar client interface + implementations.
 *
 * RealGoogleCalendarClient — production HTTP client with:
 *   - Partial responses (fields=...)
 *   - gzip Accept-Encoding
 *   - Automatic 401 token refresh (single retry)
 *   - invalid_grant detection → marks integration DISCONNECTED
 *   - Exponential backoff + jitter for 429/5xx (respects Retry-After)
 *   - Concurrency limiting
 *   - Token redaction in logs
 *
 * FakeGoogleCalendarClient — in-memory for tests.
 */
import { prisma } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";

// ---- Types ----

export interface CalendarEntry {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole?: string;
  timeZone?: string;
}

export interface BusyInterval {
  calendarId: string;
  start: string; // ISO
  end: string;   // ISO
}

export interface FreebusyInput {
  timeMin: string;
  timeMax: string;
  calendarIds: string[];
  timeZone?: string;
}

export interface CalendarEventInput {
  calendarId: string;
  summary: string;
  description?: string;
  start: string; // ISO RFC3339
  end: string;   // ISO RFC3339
  timeZone?: string;
  transparency?: "opaque" | "transparent";
  reminders?: { useDefault: boolean; overrides?: { method: string; minutes: number }[] };
  extendedProperties?: Record<string, string>;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  htmlLink?: string;
  etag?: string;
  updated?: string;
  status?: string;           // "confirmed" | "tentative" | "cancelled"
  transparency?: string;     // "opaque" (busy) | "transparent" (free)
  location?: string;         // event location (for travel time estimation)
  selfResponseStatus?: string; // "accepted" | "declined" | "tentative" | "needsAction"
  allDay?: boolean;          // true if this is an all-day event (date, not dateTime)
  description?: string;      // event description (for category detection)
  colorId?: string;          // Google Calendar color ID
}

export interface EventListOptions {
  calendarId: string;
  privateExtendedProperty?: string; // e.g. "sb_item=<planItemId>"
  maxResults?: number;
  timeMin?: string; // ISO RFC3339
  timeMax?: string; // ISO RFC3339
  singleEvents?: boolean; // expand recurring events
}

// ---- Interface ----

export interface GoogleCalendarClient {
  listCalendars(): Promise<CalendarEntry[]>;
  freebusyQuery(input: FreebusyInput): Promise<BusyInterval[]>;
  createEvent(input: CalendarEventInput): Promise<CalendarEvent>;
  updateEvent(calendarId: string, eventId: string, input: Partial<CalendarEventInput>): Promise<CalendarEvent>;
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
  listEvents(options: EventListOptions): Promise<CalendarEvent[]>;
}

// ---- Error types ----

export class GoogleApiError extends Error {
  status: number;
  retryAfterMs?: number;
  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.name = "GoogleApiError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export class GoogleReconnectError extends Error {
  code = "GOOGLE_RECONNECT_REQUIRED" as const;
  constructor(reason: string) {
    super(`Google reconnect required: ${reason}`);
    this.name = "GoogleReconnectError";
  }
}

// ---- Retry helper ----

const MAX_RETRIES = 4; // 5 total attempts
const BASE_DELAY_MS = 500;

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  isRetryable: (err: unknown) => boolean = defaultRetryable,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_RETRIES || !isRetryable(err)) throw err;
      // Respect Retry-After header if present
      let delay: number;
      if (err instanceof GoogleApiError && err.retryAfterMs) {
        delay = err.retryAfterMs + Math.random() * 200;
      } else {
        delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 200;
      }
      logger.warn("google.retry", { label, attempt: attempt + 1, delay_ms: Math.round(delay) });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

function defaultRetryable(err: unknown): boolean {
  if (err instanceof GoogleApiError) {
    return err.status === 429 || err.status >= 500;
  }
  return false;
}

// ---- Partial response fields ----

const EVENT_FIELDS = "id,etag,updated,htmlLink,summary,description,start,end,status,transparency,location,colorId,attendees(self,responseStatus),extendedProperties";
const CALENDAR_LIST_FIELDS = "items(id,summary,primary,accessRole,timeZone)";

// ---- Concurrency ----

const SYNC_CONCURRENCY = parseInt(process.env.GOOGLE_SYNC_CONCURRENCY || "3", 10);
export { SYNC_CONCURRENCY };

// ---- Real Implementation ----

export class RealGoogleCalendarClient implements GoogleCalendarClient {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  private async getIntegration() {
    const integration = await prisma.googleIntegration.findUnique({
      where: { userId: this.userId },
    });
    if (!integration) throw new GoogleReconnectError("Integration not found");
    if (integration.status === "DISCONNECTED") {
      throw new GoogleReconnectError("Integration disconnected");
    }
    if (!integration.refreshTokenEncrypted) {
      throw new GoogleReconnectError("No refresh token");
    }
    return integration;
  }

  private async getAccessToken(): Promise<string> {
    const integration = await this.getIntegration();

    const now = Date.now();
    const expiryMs = Number(integration.tokenExpiryMs);

    // Refresh if expired or within 60s of expiry
    if (!integration.accessTokenEncrypted || now >= expiryMs - 60_000) {
      return this.refreshAccessToken(integration.id, integration.refreshTokenEncrypted!);
    }

    return decrypt(integration.accessTokenEncrypted);
  }

  private async refreshAccessToken(integrationId: string, refreshTokenEncrypted: string): Promise<string> {
    const refreshToken = decrypt(refreshTokenEncrypted);
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("Google OAuth credentials not configured");

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      logger.error("google.token_refresh_failed", { user_id: this.userId, status: res.status });

      // Detect invalid_grant → mark DISCONNECTED
      if (res.status === 400 || errBody.includes("invalid_grant")) {
        await prisma.googleIntegration.update({
          where: { id: integrationId },
          data: {
            status: "DISCONNECTED",
            accessTokenEncrypted: null,
            refreshTokenEncrypted: null,
            lastErrorCode: "INVALID_GRANT",
            lastErrorMessage: "Refresh token revoked or expired. Please reconnect.",
          },
        });
        throw new GoogleReconnectError("invalid_grant");
      }
      throw new GoogleApiError("Failed to refresh Google token", res.status);
    }

    const data = await res.json();
    const newAccessToken = data.access_token as string;
    const expiresIn = (data.expires_in as number) || 3600;

    await prisma.googleIntegration.update({
      where: { id: integrationId },
      data: {
        accessTokenEncrypted: encrypt(newAccessToken),
        tokenExpiryMs: BigInt(Date.now() + expiresIn * 1000),
        lastRefreshAt: new Date(),
        lastErrorCode: null,
        lastErrorMessage: null,
        status: "CONNECTED",
      },
    });

    return newAccessToken;
  }

  /**
   * Core API request with auth, retry, and 401 refresh-once semantics.
   */
  private async apiRequest(
    url: string,
    options: RequestInit & { retryLabel?: string } = {},
  ): Promise<Response> {
    const { retryLabel, ...fetchOpts } = options;

    const doFetch = async () => {
      const token = await this.getAccessToken();
      const res = await fetch(url, {
        ...fetchOpts,
        headers: {
          Authorization: `Bearer ${token}`,
          "Accept-Encoding": "gzip",
          "User-Agent": "StudyBot/1.0 (gzip)",
          ...(fetchOpts.headers || {}),
        },
      });

      if (!res.ok) {
        if (res.status === 401) {
          // Try refresh once — getAccessToken on next retry will force refresh
          const integration = await this.getIntegration();
          try {
            await this.refreshAccessToken(integration.id, integration.refreshTokenEncrypted!);
          } catch (refreshErr) {
            if (refreshErr instanceof GoogleReconnectError) throw refreshErr;
            throw new GoogleApiError("Unauthorized after refresh attempt", 401);
          }
          // Retry with new token
          const newToken = await this.getAccessToken();
          const retryRes = await fetch(url, {
            ...fetchOpts,
            headers: {
              Authorization: `Bearer ${newToken}`,
              "Accept-Encoding": "gzip",
              "User-Agent": "StudyBot/1.0 (gzip)",
              ...(fetchOpts.headers || {}),
            },
          });
          if (!retryRes.ok) {
            throw new GoogleApiError(`Google API ${retryRes.status} after refresh`, retryRes.status);
          }
          return retryRes;
        }

        // Parse Retry-After for 429
        let retryAfterMs: number | undefined;
        if (res.status === 429) {
          const retryAfter = res.headers.get("Retry-After");
          if (retryAfter) {
            const secs = parseInt(retryAfter, 10);
            if (!isNaN(secs)) retryAfterMs = secs * 1000;
          }
        }

        throw new GoogleApiError(`Google API ${res.status}`, res.status, retryAfterMs);
      }
      return res;
    };

    return withRetry(retryLabel || "api_request", doFetch);
  }

  async listCalendars(): Promise<CalendarEntry[]> {
    const res = await this.apiRequest(
      `https://www.googleapis.com/calendar/v3/users/me/calendarList?fields=${CALENDAR_LIST_FIELDS}`,
      { retryLabel: "listCalendars" },
    );
    const data = await res.json();
    return (data.items || []).map((c: Record<string, unknown>) => ({
      id: c.id as string,
      summary: c.summary as string,
      primary: c.primary as boolean | undefined,
      accessRole: c.accessRole as string | undefined,
      timeZone: c.timeZone as string | undefined,
    }));
  }

  async freebusyQuery(input: FreebusyInput): Promise<BusyInterval[]> {
    const res = await this.apiRequest(
      "https://www.googleapis.com/calendar/v3/freeBusy",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timeMin: input.timeMin,
          timeMax: input.timeMax,
          timeZone: input.timeZone || "UTC",
          items: input.calendarIds.map((id) => ({ id })),
        }),
        retryLabel: "freebusyQuery",
      },
    );
    const data = await res.json();
    const intervals: BusyInterval[] = [];
    for (const [calId, cal] of Object.entries(data.calendars || {})) {
      const busyList = (cal as { busy?: { start: string; end: string }[] }).busy || [];
      for (const b of busyList) {
        intervals.push({ calendarId: calId, start: b.start, end: b.end });
      }
    }
    return intervals;
  }

  async createEvent(input: CalendarEventInput): Promise<CalendarEvent> {
    const body = buildEventBody(input);
    const res = await this.apiRequest(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events?fields=${EVENT_FIELDS}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        retryLabel: "createEvent",
      },
    );
    // Update lastHealthyAt on successful write
    this.touchHealthy().catch(() => {});
    return parseEventResponse(await res.json());
  }

  async updateEvent(calendarId: string, eventId: string, input: Partial<CalendarEventInput>): Promise<CalendarEvent> {
    const body: Record<string, unknown> = {};
    if (input.summary) body.summary = input.summary;
    if (input.description !== undefined) body.description = input.description;
    if (input.start) body.start = { dateTime: input.start, timeZone: input.timeZone };
    if (input.end) body.end = { dateTime: input.end, timeZone: input.timeZone };
    if (input.transparency) body.transparency = input.transparency;
    if (input.reminders) body.reminders = input.reminders;
    if (input.extendedProperties) body.extendedProperties = { private: input.extendedProperties };

    const res = await this.apiRequest(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?fields=${EVENT_FIELDS}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        retryLabel: "updateEvent",
      },
    );
    this.touchHealthy().catch(() => {});
    return parseEventResponse(await res.json());
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    try {
      await this.apiRequest(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        { method: "DELETE", retryLabel: "deleteEvent" },
      );
    } catch (err) {
      // 404/410 = already deleted, treat as success
      if (err instanceof GoogleApiError && (err.status === 404 || err.status === 410)) return;
      throw err;
    }
    this.touchHealthy().catch(() => {});
  }

  async listEvents(options: EventListOptions): Promise<CalendarEvent[]> {
    const params = new URLSearchParams({ fields: `items(${EVENT_FIELDS})` });
    if (options.privateExtendedProperty) {
      params.set("privateExtendedProperty", options.privateExtendedProperty);
    }
    params.set("maxResults", String(options.maxResults ?? 10));
    if (options.timeMin) params.set("timeMin", options.timeMin);
    if (options.timeMax) params.set("timeMax", options.timeMax);
    if (options.singleEvents) {
      params.set("singleEvents", "true");
      params.set("orderBy", "startTime");
    }

    const res = await this.apiRequest(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(options.calendarId)}/events?${params}`,
      { retryLabel: "listEvents" },
    );
    const data = await res.json();
    return (data.items || []).map(parseEventResponse);
  }

  /** Fire-and-forget: update lastHealthyAt timestamp */
  private async touchHealthy(): Promise<void> {
    await prisma.googleIntegration.updateMany({
      where: { userId: this.userId, status: "CONNECTED" },
      data: { lastHealthyAt: new Date() },
    });
  }
}

function buildEventBody(input: CalendarEventInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    summary: input.summary,
    description: input.description,
    start: { dateTime: input.start, timeZone: input.timeZone },
    end: { dateTime: input.end, timeZone: input.timeZone },
    transparency: input.transparency || "opaque",
    reminders: input.reminders || { useDefault: true },
  };
  if (input.extendedProperties) {
    body.extendedProperties = { private: input.extendedProperties };
  }
  return body;
}

function parseEventResponse(data: Record<string, unknown>): CalendarEvent {
  const startObj = data.start as { dateTime?: string; date?: string } | undefined;
  const endObj = data.end as { dateTime?: string; date?: string } | undefined;

  // All-day events use "date" (YYYY-MM-DD), timed events use "dateTime" (ISO)
  const allDay = !startObj?.dateTime && !!startObj?.date;
  const startStr = startObj?.dateTime ?? (startObj?.date ? `${startObj.date}T00:00:00` : "");
  const endStr = endObj?.dateTime ?? (endObj?.date ? `${endObj.date}T23:59:59` : "");

  // Extract self attendance status from attendees array
  let selfResponseStatus: string | undefined;
  const attendees = data.attendees as { self?: boolean; responseStatus?: string }[] | undefined;
  if (attendees) {
    const self = attendees.find((a) => a.self === true);
    if (self) selfResponseStatus = self.responseStatus;
  }

  return {
    id: data.id as string,
    summary: (data.summary as string) || "",
    start: startStr,
    end: endStr,
    htmlLink: (data.htmlLink as string) || undefined,
    etag: (data.etag as string) || undefined,
    updated: (data.updated as string) || undefined,
    status: (data.status as string) || undefined,
    transparency: (data.transparency as string) || undefined,
    location: (data.location as string) || undefined,
    selfResponseStatus,
    allDay,
    description: (data.description as string) || undefined,
    colorId: (data.colorId as string) || undefined,
  };
}

// ---- Fake Implementation (for tests) ----

export class FakeGoogleCalendarClient implements GoogleCalendarClient {
  private calendars: CalendarEntry[];
  private busy: BusyInterval[];
  private events: Map<string, CalendarEvent & { calendarId: string; extendedProperties?: Record<string, string> }> = new Map();
  private nextId = 1;
  /** Track call counts for test assertions */
  callLog: { method: string; args: unknown[] }[] = [];
  /** Simulate specific error scenarios */
  simulateErrors: { method: string; error: Error; once?: boolean }[] = [];

  constructor(
    calendars: CalendarEntry[] = [
      { id: "primary", summary: "Primary", primary: true, accessRole: "owner", timeZone: "America/New_York" },
    ],
    busy: BusyInterval[] = [],
  ) {
    this.calendars = calendars;
    this.busy = busy;
  }

  private checkError(method: string): void {
    const idx = this.simulateErrors.findIndex((e) => e.method === method);
    if (idx >= 0) {
      const err = this.simulateErrors[idx];
      if (err.once) this.simulateErrors.splice(idx, 1);
      throw err.error;
    }
  }

  async listCalendars(): Promise<CalendarEntry[]> {
    this.callLog.push({ method: "listCalendars", args: [] });
    this.checkError("listCalendars");
    return this.calendars;
  }

  async freebusyQuery(input: FreebusyInput): Promise<BusyInterval[]> {
    this.callLog.push({ method: "freebusyQuery", args: [input] });
    this.checkError("freebusyQuery");
    const min = new Date(input.timeMin).getTime();
    const max = new Date(input.timeMax).getTime();
    return this.busy.filter((b) => {
      const s = new Date(b.start).getTime();
      const e = new Date(b.end).getTime();
      return s < max && e > min && input.calendarIds.includes(b.calendarId);
    });
  }

  setBusy(busy: BusyInterval[]) {
    this.busy = busy;
  }

  async createEvent(input: CalendarEventInput): Promise<CalendarEvent> {
    this.callLog.push({ method: "createEvent", args: [input] });
    this.checkError("createEvent");
    const id = `fake_event_${this.nextId++}`;
    const event = {
      id,
      summary: input.summary,
      start: input.start,
      end: input.end,
      calendarId: input.calendarId,
      htmlLink: `https://calendar.google.com/event?eid=${id}`,
      etag: `"etag_${id}"`,
      updated: new Date().toISOString(),
      extendedProperties: input.extendedProperties,
    };
    this.events.set(id, event);
    return {
      id: event.id,
      summary: event.summary,
      start: event.start,
      end: event.end,
      htmlLink: event.htmlLink,
      etag: event.etag,
      updated: event.updated,
    };
  }

  async updateEvent(calendarId: string, eventId: string, input: Partial<CalendarEventInput>): Promise<CalendarEvent> {
    this.callLog.push({ method: "updateEvent", args: [calendarId, eventId, input] });
    this.checkError("updateEvent");
    const existing = this.events.get(eventId);
    if (!existing) throw new GoogleApiError("Event not found", 404);
    if (input.summary) existing.summary = input.summary;
    if (input.start) existing.start = input.start;
    if (input.end) existing.end = input.end;
    if (input.extendedProperties) existing.extendedProperties = input.extendedProperties;
    existing.updated = new Date().toISOString();
    existing.etag = `"etag_${eventId}_${Date.now()}"`;
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

  async deleteEvent(_calendarId: string, eventId: string): Promise<void> {
    this.callLog.push({ method: "deleteEvent", args: [_calendarId, eventId] });
    this.checkError("deleteEvent");
    if (!this.events.has(eventId)) return; // Already deleted, no error
    this.events.delete(eventId);
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
      // Filter by time window if specified
      if (options.timeMin && event.end <= options.timeMin) continue;
      if (options.timeMax && event.start >= options.timeMax) continue;
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

  getEvents(): CalendarEvent[] {
    return [...this.events.values()];
  }

  /** Remove a specific event from internal store (simulate manual deletion in Google) */
  simulateManualDelete(eventId: string) {
    this.events.delete(eventId);
  }

  clearCallLog() {
    this.callLog.length = 0;
  }
}

// ---- Singleton provider for dependency injection ----

let _clientFactory: ((userId: string) => GoogleCalendarClient) | null = null;

export function setGoogleClientFactory(factory: (userId: string) => GoogleCalendarClient) {
  _clientFactory = factory;
}

export function resetGoogleClientFactory() {
  _clientFactory = null;
}

export function getGoogleClient(userId: string): GoogleCalendarClient {
  if (_clientFactory) return _clientFactory(userId);
  if (process.env.GOOGLE_PROVIDER === "fake") {
    return new FakeGoogleCalendarClient();
  }
  return new RealGoogleCalendarClient(userId);
}
