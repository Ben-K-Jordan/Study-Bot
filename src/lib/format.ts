/**
 * Every date, time, number, list and plural on screen goes through here,
 * with the "en-US" locale and the student's time zone (pass `timeZone` from
 * Settings when you have it; otherwise the runtime's zone is used).
 *
 * Never call toLocaleDateString() without options, never use
 * hour: "2-digit", and never build plurals with `n === 1 ? "" : "s"`.
 */

export const LOCALE = "en-US";

export type DateInput = Date | string | number;

export interface ZoneOptions {
  /** IANA zone such as "America/New_York". Defaults to the runtime zone. */
  timeZone?: string;
}

const MS_PER_DAY = 86_400_000;

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

// Intl formatters are costly to build, so they are cached by their options.
const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();

function dateTimeFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let format = dateTimeFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(LOCALE, options);
    dateTimeFormats.set(key, format);
  }
  return format;
}

/** 2:00 PM */
export function formatTime(value: DateInput, { timeZone }: ZoneOptions = {}): string {
  return dateTimeFormat({ hour: "numeric", minute: "2-digit", timeZone }).format(toDate(value));
}

/** 2:00 – 2:30 PM (Intl inserts thin spaces around the dash; match with \s*) */
export function formatTimeRange(
  start: DateInput,
  end: DateInput,
  { timeZone }: ZoneOptions = {}
): string {
  return dateTimeFormat({ hour: "numeric", minute: "2-digit", timeZone }).formatRange(
    toDate(start),
    toDate(end)
  );
}

/** Oct 14 */
export function formatDateShort(value: DateInput, { timeZone }: ZoneOptions = {}): string {
  return dateTimeFormat({ month: "short", day: "numeric", timeZone }).format(toDate(value));
}

/** Wed, Oct 14 */
export function formatDateWeekday(value: DateInput, { timeZone }: ZoneOptions = {}): string {
  return dateTimeFormat({ weekday: "short", month: "short", day: "numeric", timeZone }).format(
    toDate(value)
  );
}

/** Wednesday, October 14 */
export function formatDayHeading(value: DateInput, { timeZone }: ZoneOptions = {}): string {
  return dateTimeFormat({ weekday: "long", month: "long", day: "numeric", timeZone }).format(
    toDate(value)
  );
}

/** Oct 14, 2026: for other years and created dates */
export function formatDateFull(value: DateInput, { timeZone }: ZoneOptions = {}): string {
  return dateTimeFormat({ dateStyle: "medium", timeZone }).format(toDate(value));
}

/** Oct 14 this year, Oct 14, 2025 in any other year. */
export function formatDate(
  value: DateInput,
  { timeZone, now = new Date() }: ZoneOptions & { now?: DateInput } = {}
): string {
  const sameYear = calendarDay(value, timeZone).year === calendarDay(now, timeZone).year;
  return sameYear ? formatDateShort(value, { timeZone }) : formatDateFull(value, { timeZone });
}

/** Wed, Oct 14 at 2:00 PM */
export function formatDateTime(value: DateInput, { timeZone }: ZoneOptions = {}): string {
  return `${formatDateWeekday(value, { timeZone })} at ${formatTime(value, { timeZone })}`;
}

interface CalendarDay {
  year: number;
  month: number;
  day: number;
}

/** The year, month and day a moment falls on in `timeZone`. */
export function calendarDay(value: DateInput, timeZone?: string): CalendarDay {
  const parts = dateTimeFormat({
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone,
  }).formatToParts(toDate(value));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/**
 * Whole calendar days from `now` to `value` in the time zone: 0 today,
 * 1 tomorrow, -1 yesterday. Daylight saving changes don't shift the count.
 */
export function daysUntil(
  value: DateInput,
  { timeZone, now = new Date() }: ZoneOptions & { now?: DateInput } = {}
): number {
  const a = calendarDay(now, timeZone);
  const b = calendarDay(value, timeZone);
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / MS_PER_DAY
  );
}

const relativeFormat = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });

/** today, tomorrow, yesterday, in 3 days, 3 days ago */
export function formatRelativeDay(
  value: DateInput,
  options: ZoneOptions & { now?: DateInput } = {}
): string {
  return relativeFormat.format(daysUntil(value, options), "day");
}

const numberFormat = new Intl.NumberFormat(LOCALE);

/** 1,234 */
export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

const percentFormat = new Intl.NumberFormat(LOCALE, { style: "percent", maximumFractionDigits: 0 });

/** 83% from a ratio between 0 and 1 */
export function formatPercent(ratio: number): string {
  return percentFormat.format(ratio);
}

const minuteFormat = new Intl.NumberFormat(LOCALE, {
  style: "unit",
  unit: "minute",
  unitDisplay: "short",
  maximumFractionDigits: 0,
});
const hourFormat = new Intl.NumberFormat(LOCALE, {
  style: "unit",
  unit: "hour",
  unitDisplay: "short",
  maximumFractionDigits: 1,
});

/** 25 min, 2.5 hr. Minutes under 120, hours from there; under a minute reads "Under 1 min". */
export function formatDuration(minutes: number): string {
  if (minutes < 1) return `Under ${minuteFormat.format(1)}`;
  if (minutes < 120) return minuteFormat.format(Math.round(minutes));
  return hourFormat.format(minutes / 60);
}

const listFormats = new Map<Intl.ListFormatType, Intl.ListFormat>();

/** Recursion, Stacks, and Big-O ("or" with type: "disjunction") */
export function formatList(
  items: readonly string[],
  type: Intl.ListFormatType = "conjunction"
): string {
  let format = listFormats.get(type);
  if (!format) {
    format = new Intl.ListFormat(LOCALE, { style: "long", type });
    listFormats.set(type, format);
  }
  return format.format(items);
}

const pluralRules = new Intl.PluralRules(LOCALE);

export interface PluralForms {
  /** Used for 0 when given: "No sessions today". */
  zero?: string;
  one: string;
  other: string;
}

/**
 * One whole message per form; "#" becomes the formatted count.
 * plural(3, { zero: "No sessions today", one: "# session today", other: "# sessions today" })
 */
export function plural(count: number, forms: PluralForms): string {
  if (count === 0 && forms.zero !== undefined) return forms.zero;
  const form = pluralRules.select(count) === "one" ? forms.one : forms.other;
  return form.replaceAll("#", formatNumber(count));
}

/**
 * The exam countdown as one whole message: "Prelim 1 is today",
 * "Prelim 1 is tomorrow", "Prelim 1 is in 9 days", "Prelim 1 was 2 days ago".
 */
export function formatCountdown(
  examName: string,
  examDate: DateInput,
  options: ZoneOptions & { now?: DateInput } = {}
): string {
  const days = daysUntil(examDate, options);
  if (days === 0) return `${examName} is today`;
  if (days === 1) return `${examName} is tomorrow`;
  if (days > 1) return `${examName} is in ${plural(days, { one: "# day", other: "# days" })}`;
  return `${examName} was ${plural(-days, { one: "# day", other: "# days" })} ago`;
}
