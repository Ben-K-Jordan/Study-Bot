/**
 * Whether students can connect Google Calendar on this server: the
 * in-memory fake provider (GOOGLE_PROVIDER=fake, development and tests)
 * always connects, and the real one needs an OAuth client id. The connect
 * route follows the same rule, so Settings and Plan never hide a calendar
 * that would connect, or offer one that can't.
 */
export function isGoogleCalendarAvailable(): boolean {
  return process.env.GOOGLE_PROVIDER === "fake" || Boolean(process.env.GOOGLE_CLIENT_ID);
}
