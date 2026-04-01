/**
 * Google Calendar client interface + implementations.
 * RealGoogleCalendarClient uses Google APIs.
 * FakeGoogleCalendarClient is injected for tests.
 */
import { prisma } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";

// ---- Types ----

export interface CalendarEntry {
  id: string;
  summary: string;
  primary?: boolean;
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

// ---- Interface ----

export interface GoogleCalendarClient {
  listCalendars(): Promise<CalendarEntry[]>;
  freebusyQuery(input: FreebusyInput): Promise<BusyInterval[]>;
}

// ---- Real Implementation ----

export class RealGoogleCalendarClient implements GoogleCalendarClient {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  private async getAccessToken(): Promise<string> {
    const integration = await prisma.googleIntegration.findUnique({
      where: { userId: this.userId },
    });
    if (!integration) throw new Error("Google integration not found");

    const now = Date.now();
    const expiryMs = Number(integration.tokenExpiryMs);

    // Refresh if expired or within 60s of expiry
    if (now >= expiryMs - 60_000) {
      return this.refreshAccessToken(integration);
    }

    if (!integration.accessTokenEncrypted) {
      return this.refreshAccessToken(integration);
    }

    return decrypt(integration.accessTokenEncrypted);
  }

  private async refreshAccessToken(integration: { id: string; refreshTokenEncrypted: string }): Promise<string> {
    const refreshToken = decrypt(integration.refreshTokenEncrypted);
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
      const err = await res.text();
      logger.error("google.token_refresh_failed", { user_id: this.userId, status: res.status, body: err });
      throw new Error("Failed to refresh Google token");
    }

    const data = await res.json();
    const newAccessToken = data.access_token as string;
    const expiresIn = (data.expires_in as number) || 3600;

    await prisma.googleIntegration.update({
      where: { id: integration.id },
      data: {
        accessTokenEncrypted: encrypt(newAccessToken),
        tokenExpiryMs: BigInt(Date.now() + expiresIn * 1000),
      },
    });

    return newAccessToken;
  }

  async listCalendars(): Promise<CalendarEntry[]> {
    const token = await this.getAccessToken();
    const res = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`CalendarList failed: ${res.status}`);
    const data = await res.json();
    return (data.items || []).map((c: { id: string; summary: string; primary?: boolean }) => ({
      id: c.id,
      summary: c.summary,
      primary: c.primary,
    }));
  }

  async freebusyQuery(input: FreebusyInput): Promise<BusyInterval[]> {
    const token = await this.getAccessToken();
    const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timeMin: input.timeMin,
        timeMax: input.timeMax,
        timeZone: input.timeZone || "UTC",
        items: input.calendarIds.map((id) => ({ id })),
      }),
    });
    if (!res.ok) throw new Error(`Freebusy failed: ${res.status}`);
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
}

// ---- Fake Implementation (for tests) ----

export class FakeGoogleCalendarClient implements GoogleCalendarClient {
  private calendars: CalendarEntry[];
  private busy: BusyInterval[];

  constructor(
    calendars: CalendarEntry[] = [{ id: "primary", summary: "Primary", primary: true }],
    busy: BusyInterval[] = []
  ) {
    this.calendars = calendars;
    this.busy = busy;
  }

  async listCalendars(): Promise<CalendarEntry[]> {
    return this.calendars;
  }

  async freebusyQuery(input: FreebusyInput): Promise<BusyInterval[]> {
    // Filter busy intervals that overlap the requested time range
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
  return new RealGoogleCalendarClient(userId);
}
