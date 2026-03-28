/**
 * Minimal ICS (iCalendar) file generator.
 * Produces RFC 5545 compliant VCALENDAR with VEVENT entries.
 */

export interface IcsEvent {
  uid: string;
  summary: string;
  description: string;
  dtstart: Date;
  dtend: Date;
  location?: string;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function formatDateUTC(d: Date): string {
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function escapeText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function foldLine(line: string): string {
  const maxLen = 75;
  if (line.length <= maxLen) return line;
  const parts: string[] = [line.slice(0, maxLen)];
  let i = maxLen;
  while (i < line.length) {
    parts.push(" " + line.slice(i, i + maxLen - 1));
    i += maxLen - 1;
  }
  return parts.join("\r\n");
}

export function generateIcs(events: IcsEvent[]): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//StudyBot//WeekPlanner//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  const now = formatDateUTC(new Date());

  for (const event of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(foldLine(`UID:${escapeText(event.uid)}`));
    lines.push(`DTSTAMP:${now}`);
    lines.push(`DTSTART:${formatDateUTC(event.dtstart)}`);
    lines.push(`DTEND:${formatDateUTC(event.dtend)}`);
    lines.push(foldLine(`SUMMARY:${escapeText(event.summary)}`));
    lines.push(foldLine(`DESCRIPTION:${escapeText(event.description)}`));
    if (event.location) {
      lines.push(foldLine(`LOCATION:${escapeText(event.location)}`));
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
