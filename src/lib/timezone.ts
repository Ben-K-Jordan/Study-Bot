/**
 * User timezone helpers.
 *
 * Day boundaries for streaks, freezes, and the successive relearning
 * criterion should follow the student's clock, not the server's: a 9pm
 * study session should count toward *their* today. A null timezone falls
 * back to UTC, which preserves the previous behavior for users who never
 * set one.
 *
 * Study plans carry their own timezone (StudyPlan.timezone). Availability
 * windows like "09:00" are wall-clock times in that zone, so scheduling code
 * converts them with zonedTimeToUtc rather than Date#setHours, which would
 * use the server's zone.
 */
import { cache } from "react";
import { prisma } from "@/lib/db";

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Formatters, one per zone
// ---------------------------------------------------------------------------

/**
 * Intl formatters are costly to build (about 70 µs each), and dayKey runs
 * once per row when a year of activity is bucketed into days, so each zone's
 * formatter is built once and reused. Only valid zones are stored. The cap
 * bounds the maps when callers pass arbitrary strings (Intl accepts any
 * letter case of a zone name).
 */
const MAX_CACHED_ZONES = 500;

const DAY_OPTIONS: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit" };
const WALL_CLOCK_OPTIONS: Intl.DateTimeFormatOptions = {
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
};

const dayFormatters = new Map<string, Intl.DateTimeFormat>();
const wallClockFormatters = new Map<string, Intl.DateTimeFormat>();

/** The stored formatter for `timeZone`, built on first use; null when the zone is invalid. */
function formatterFor(
  store: Map<string, Intl.DateTimeFormat>,
  locale: string,
  options: Intl.DateTimeFormatOptions,
  timeZone: string,
): Intl.DateTimeFormat | null {
  const stored = store.get(timeZone);
  if (stored) return stored;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone });
  } catch {
    return null;
  }
  if (store.size >= MAX_CACHED_ZONES) store.clear();
  store.set(timeZone, formatter);
  return formatter;
}

/** en-CA formats as YYYY-MM-DD. */
const dayFormatter = (timeZone: string) => formatterFor(dayFormatters, "en-CA", DAY_OPTIONS, timeZone);
const wallClockFormatter = (timeZone: string) =>
  formatterFor(wallClockFormatters, "en-US", WALL_CLOCK_OPTIONS, timeZone);

/** Calendar day key (YYYY-MM-DD) for a date in the given IANA timezone. */
export function dayKey(date: Date, timeZone?: string | null): string {
  const formatter = timeZone ? dayFormatter(timeZone) : null;
  return formatter ? formatter.format(date) : date.toISOString().slice(0, 10);
}

/** Whether a string is a valid IANA timezone identifier. */
export function isValidTimezone(tz: string): boolean {
  return typeof tz === "string" && tz !== "" && wallClockFormatter(tz) !== null;
}

/** The day key `days` calendar days after `key` (YYYY-MM-DD in, YYYY-MM-DD out). */
export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Whole calendar days from day key `from` to day key `to` (negative if earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

/** Wall-clock fields of an instant in a timezone (UTC when null or invalid). */
function wallClock(date: Date, timeZone?: string | null) {
  const formatter = timeZone ? wallClockFormatter(timeZone) : null;
  if (formatter) {
    const parts: Record<string, string> = {};
    for (const p of formatter.formatToParts(date)) parts[p.type] = p.value;
    return {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
      hour: Number(parts.hour) % 24,
      minute: Number(parts.minute),
    };
  }
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}

/** Hour of day as a decimal (e.g. 14.5 for 14:30) in the given timezone. */
export function hourOfDay(date: Date, timeZone?: string | null): number {
  const { hour, minute } = wallClock(date, timeZone);
  return hour + minute / 60;
}

/**
 * The UTC instant of a wall-clock time ("HH:MM") on a calendar day
 * (YYYY-MM-DD) in an IANA timezone. A two-pass correction handles DST
 * transitions. A null or invalid timezone is treated as UTC, like dayKey.
 */
export function zonedTimeToUtc(key: string, time: string, timeZone?: string | null): Date {
  const [y, mo, d] = key.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const target = Date.UTC(y, mo - 1, d, h, mi, 0);
  let ts = target;
  for (let i = 0; i < 2; i++) {
    const wall = wallClock(new Date(ts), timeZone);
    const diff =
      Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) - target;
    if (diff === 0) break;
    ts -= diff;
  }
  return new Date(ts);
}

// ---------------------------------------------------------------------------
// The student's zone
// ---------------------------------------------------------------------------

/** The zone saved in Settings (UserGameState.timezone), or null. */
export async function getStoredTimezone(userId: string): Promise<string | null> {
  try {
    const state = await prisma.userGameState.findUnique({
      where: { userId },
      select: { timezone: true },
    });
    return state?.timezone ?? null;
  } catch {
    return null;
  }
}

/** The zone of the student's newest plan (plans record the zone they were made in), or null. */
async function newestPlanTimezone(userId: string): Promise<string | null> {
  try {
    const plan = await prisma.studyPlan.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { timezone: true },
    });
    return plan?.timezone ?? null;
  } catch {
    return null;
  }
}

/**
 * Settings first, then the newest plan's zone. Pass the settings value when
 * you already have it to skip a query; `undefined` means "look it up".
 */
async function findTimezone(userId: string, settingsZone?: string | null): Promise<string | null> {
  const settings = settingsZone !== undefined ? settingsZone : await getStoredTimezone(userId);
  if (settings && isValidTimezone(settings)) return settings;
  const planZone = await newestPlanTimezone(userId);
  return planZone && isValidTimezone(planZone) ? planZone : null;
}

/**
 * The time zone that decides what "today" is for this student on every
 * screen: streaks, XP today, cards due today, chat day labels, session dates
 * and the relearning criterion. Settings first, then the zone of the
 * student's newest plan, then UTC. Deduplicated per request in Server
 * Components (React.cache); elsewhere each call reads the database.
 */
export const resolveTimeZone = cache(
  async (userId: string, settingsZone?: string | null): Promise<string> =>
    (await findTimezone(userId, settingsZone)) ?? "UTC",
);

/**
 * The same zone as resolveTimeZone, but null when the student has neither a
 * Settings zone nor a plan (null means UTC day boundaries). For the value
 * saved in Settings alone, use getStoredTimezone.
 */
export const getUserTimezone = cache(
  async (userId: string): Promise<string | null> => findTimezone(userId),
);
