/**
 * User-facing copy for Google Calendar results and failures (VOICE.md).
 * Machine codes such as GOOGLE_RECONNECT_REQUIRED stay in API bodies and
 * logs; screens show these sentences instead. Pure, safe on the client.
 */

export const GOOGLE_COPY = {
  reconnect: "Google Calendar needs you to sign in again.",
  notConnected: "Connect Google Calendar to add sessions to it.",
  differentCalendar: "This plan is already in a different Google calendar.",
  planNotFound: "This plan doesn't exist anymore.",
  planForbidden: "This plan belongs to another account.",
  /** The one fallback for any other failure. */
  unavailable: "Google Calendar didn't respond. Retry in a minute.",
} as const;

/**
 * Maps an API error code (body `code` or legacy `error`) to a sentence.
 * The single source for Google Calendar failures: the publish, unpublish
 * and reschedule routes and the screens all use it.
 */
export function googleErrorMessage(code: string | null | undefined): string {
  switch (code) {
    case "GOOGLE_RECONNECT_REQUIRED":
    case "INVALID_GRANT":
      return GOOGLE_COPY.reconnect;
    case "GOOGLE_NOT_CONNECTED":
      return GOOGLE_COPY.notConnected;
    case "ALREADY_PUBLISHED_DIFFERENT_CALENDAR":
      return GOOGLE_COPY.differentCalendar;
    case "not_found":
      return GOOGLE_COPY.planNotFound;
    case "forbidden":
      return GOOGLE_COPY.planForbidden;
    default:
      return GOOGLE_COPY.unavailable;
  }
}

export interface GoogleConnectResult {
  tone: "success" | "error";
  title: string;
  description: string;
}

/**
 * The message for the OAuth callback's landing URL:
 * `/settings?google=connected` or `/settings?google=error&reason=<code>`.
 * `reason` is either the callback's own code or Google's `error` value
 * (access_denied and friends). Returns null when there is nothing to say.
 * `dev` adds setup details meant for whoever runs the server.
 */
export function googleConnectResult(
  google: string | null | undefined,
  reason: string | null | undefined,
  { dev = false }: { dev?: boolean } = {},
): GoogleConnectResult | null {
  if (google === "connected") {
    return {
      tone: "success",
      title: "Google Calendar connected",
      description: "Add a plan's sessions to it from the Plan page.",
    };
  }
  if (google !== "error") return null;

  const title = "Google Calendar not connected";
  switch (reason) {
    case "access_denied":
      return {
        tone: "error",
        title,
        description:
          "Study Bot needs your permission to add sessions to your calendar. Connect again and allow access on Google's page.",
      };
    case "invalid_state":
      return {
        tone: "error",
        title,
        description: "The connection request expired. Connect again.",
      };
    case "missing_params":
      return {
        tone: "error",
        title,
        description: "Google didn't send back the details needed to finish. Connect again.",
      };
    case "not_configured":
      return {
        tone: "error",
        title,
        description: dev
          ? "Google Calendar isn't set up on this server. In .env, set GOOGLE_PROVIDER=\"fake\" for a local test calendar, or GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET for a real one, then restart the server."
          : "Google Calendar isn't available on this server.",
      };
    case "token_exchange_failed":
      return {
        tone: "error",
        title,
        description: "Google didn't confirm the connection. Connect again.",
      };
    case "no_refresh_token":
      return {
        tone: "error",
        title,
        description:
          "Google didn't grant lasting access. Remove Study Bot from the third-party connections in your Google Account, then connect again.",
      };
    default:
      return {
        tone: "error",
        title,
        description: "The connection didn't finish. Connect again in a minute.",
      };
  }
}
