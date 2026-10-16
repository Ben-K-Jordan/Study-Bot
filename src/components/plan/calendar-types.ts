/** Google Calendar state for one plan, read on the server. */
export interface CalendarState {
  /** Whether Google Calendar is available here at all. */
  configured: boolean
  /** connected; reconnect (the sign-in expired or errored); not_connected. */
  connection: "connected" | "reconnect" | "not_connected"
  /** The plan's publication, or null when it was never added. */
  publication: {
    status: "PUBLISHED" | "PARTIAL" | "FAILED" | "UNPUBLISHED" | "NOT_PUBLISHED"
    /** Sessions that have an event in Google Calendar. */
    added: number
    /** Sessions in the plan that belong in the calendar (not skipped ones). */
    total: number
    /** What the last request did: added events, or removed them (a partial removal leaves PARTIAL too). */
    last_action: "add" | "remove"
    last_error: string | null
  } | null
}

/**
 * Whether the last Google Calendar request added events or removed them.
 * Adding stamps published_at and last_synced_at with the same moment;
 * removing moves only last_synced_at.
 */
export function lastCalendarAction(publication: {
  published_at: string | null
  last_synced_at: string | null
}): "add" | "remove" {
  const published = publication.published_at ? Date.parse(publication.published_at) : null
  const synced = publication.last_synced_at ? Date.parse(publication.last_synced_at) : null
  if (synced !== null && (published === null || synced > published)) return "remove"
  return "add"
}

/** Whether the plan currently has events in Google Calendar. */
export function isInGoogleCalendar(calendar: CalendarState): boolean {
  const status = calendar.publication?.status
  return (status === "PUBLISHED" || status === "PARTIAL") && (calendar.publication?.added ?? 0) > 0
}
