/**
 * Generate a Google Calendar "Add Event" URL.
 * Opens Google Calendar with a prefilled event — no OAuth needed.
 *
 * See: https://github.com/niclasleonbock/google-calendar-link
 */

function formatGCalDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function buildGoogleCalendarLink(params: {
  title: string;
  startTime: Date;
  endTime: Date;
  description?: string;
  location?: string;
}): string {
  const base = "https://calendar.google.com/calendar/render";
  const query = new URLSearchParams({
    action: "TEMPLATE",
    text: params.title,
    dates: `${formatGCalDate(params.startTime)}/${formatGCalDate(params.endTime)}`,
  });

  if (params.description) {
    query.set("details", params.description);
  }
  if (params.location) {
    query.set("location", params.location);
  }

  return `${base}?${query.toString()}`;
}
