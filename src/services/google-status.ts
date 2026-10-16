import { prisma } from "@/lib/db";

/**
 * The Google Calendar connection as the Settings page and the plan page
 * read it. `needs_reconnect` is true when Google revoked access (the token
 * refresh failed), as opposed to the student disconnecting on purpose.
 */
export interface GoogleStatus {
  status: "CONNECTED" | "DISCONNECTED" | "ERROR";
  connected: boolean;
  needs_reconnect: boolean;
  connected_email?: string | null;
  scopes: string[];
  default_calendar_id: string;
  busy_calendar_ids: string[];
  timezone?: string | null;
  last_healthy_at?: string | null;
  last_error?: { code: string; message: string | null } | null;
  /** Legacy fields for backward compat. */
  selected_calendar_id?: string;
  token_expiry?: number;
}

interface IntegrationRow {
  status: string;
  connectedEmail: string | null;
  scopeString: string;
  calendarIdSelected: string;
  busyCalendarIds: string;
  timezone: string | null;
  lastHealthyAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  tokenExpiryMs: bigint;
}

const RECONNECT_CODES = new Set(["INVALID_GRANT", "GOOGLE_RECONNECT_REQUIRED"]);

function splitIds(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

export function toGoogleStatus(integration: IntegrationRow | null): GoogleStatus {
  if (!integration || integration.status === "DISCONNECTED") {
    const revoked = Boolean(integration?.lastErrorCode && RECONNECT_CODES.has(integration.lastErrorCode));
    return {
      status: "DISCONNECTED",
      connected: false,
      needs_reconnect: revoked,
      ...(revoked ? { connected_email: integration?.connectedEmail ?? null } : {}),
      scopes: [],
      default_calendar_id: "primary",
      busy_calendar_ids: ["primary"],
    };
  }

  const status = integration.status === "CONNECTED" ? "CONNECTED" : "ERROR";
  return {
    status,
    connected: status === "CONNECTED",
    needs_reconnect: status === "ERROR",
    connected_email: integration.connectedEmail,
    scopes: integration.scopeString.split(" ").filter(Boolean),
    default_calendar_id: integration.calendarIdSelected,
    busy_calendar_ids: splitIds(integration.busyCalendarIds),
    timezone: integration.timezone,
    last_healthy_at: integration.lastHealthyAt?.toISOString() ?? null,
    last_error: integration.lastErrorCode
      ? { code: integration.lastErrorCode, message: integration.lastErrorMessage }
      : null,
    selected_calendar_id: integration.calendarIdSelected,
    token_expiry: Number(integration.tokenExpiryMs),
  };
}

export async function readGoogleStatus(userId: string): Promise<GoogleStatus> {
  const integration = await prisma.googleIntegration.findUnique({ where: { userId } });
  return toGoogleStatus(integration);
}
