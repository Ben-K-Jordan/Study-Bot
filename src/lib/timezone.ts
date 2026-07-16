/**
 * User timezone helpers.
 *
 * Day boundaries for streaks, freezes, and the successive relearning
 * criterion should follow the student's clock, not the server's: a 9pm
 * study session should count toward *their* today. A null timezone falls
 * back to UTC, which preserves the previous behavior for users who never
 * set one.
 */
import { prisma } from "@/lib/db";

/** Calendar day key (YYYY-MM-DD) for a date in the given IANA timezone. */
export function dayKey(date: Date, timeZone?: string | null): string {
  if (!timeZone) return date.toISOString().slice(0, 10);
  try {
    // en-CA formats as YYYY-MM-DD
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Whether a string is a valid IANA timezone identifier. */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * The user's configured timezone, or null (= UTC day boundaries).
 * Stored on UserGameState and editable in Settings.
 */
export async function getUserTimezone(userId: string): Promise<string | null> {
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
