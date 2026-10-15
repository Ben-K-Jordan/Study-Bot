/**
 * The Google Calendar status the Settings and plan pages read.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { toGoogleStatus } from "@/app/api/integrations/google/status/status-dto";

const row = {
  status: "CONNECTED",
  connectedEmail: "ben@example.com",
  scopeString: "a b",
  calendarIdSelected: "primary",
  busyCalendarIds: "primary, work@group.calendar.google.com",
  timezone: "America/New_York",
  lastHealthyAt: new Date("2026-10-14T12:00:00Z"),
  lastErrorCode: null,
  lastErrorMessage: null,
  tokenExpiryMs: BigInt(1000),
};

describe("toGoogleStatus", () => {
  it("reports no integration as disconnected, with the e2e-visible defaults", () => {
    expect(toGoogleStatus(null)).toEqual({
      status: "DISCONNECTED",
      connected: false,
      needs_reconnect: false,
      scopes: [],
      default_calendar_id: "primary",
      busy_calendar_ids: ["primary"],
    });
  });

  it("reports a connected integration with its calendars", () => {
    const status = toGoogleStatus(row);
    expect(status.connected).toBe(true);
    expect(status.needs_reconnect).toBe(false);
    expect(status.connected_email).toBe("ben@example.com");
    expect(status.busy_calendar_ids).toEqual(["primary", "work@group.calendar.google.com"]);
    expect(status.scopes).toEqual(["a", "b"]);
  });

  it("asks for a reconnect when Google revoked access", () => {
    const status = toGoogleStatus({ ...row, status: "DISCONNECTED", lastErrorCode: "INVALID_GRANT" });
    expect(status).toMatchObject({ connected: false, needs_reconnect: true, connected_email: "ben@example.com" });
  });

  it("doesn't ask for a reconnect after a deliberate disconnect", () => {
    expect(toGoogleStatus({ ...row, status: "DISCONNECTED" }).needs_reconnect).toBe(false);
  });

  it("treats an ERROR status as needing a reconnect", () => {
    expect(toGoogleStatus({ ...row, status: "ERROR" })).toMatchObject({
      status: "ERROR",
      connected: false,
      needs_reconnect: true,
    });
  });
});
