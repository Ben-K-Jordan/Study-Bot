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
    /** Sessions in the plan. */
    total: number
    last_error: string | null
  } | null
}

/** Whether the plan currently has events in Google Calendar. */
export function isInGoogleCalendar(calendar: CalendarState): boolean {
  const status = calendar.publication?.status
  return (status === "PUBLISHED" || status === "PARTIAL") && (calendar.publication?.added ?? 0) > 0
}
