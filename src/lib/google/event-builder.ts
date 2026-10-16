/**
 * Build Google Calendar event payloads from StudyPlan data.
 *
 * Deterministic templates, no LLM calls. The title and description are the
 * same plain text as the .ics export (src/lib/calendar.ts). Includes a
 * hash for skipping events that haven't changed; changing the text changes
 * the hash, so the next publish updates every event once.
 */
import { createHash } from "crypto";
import { buildCalendarDescription, buildCalendarTitle, type CalendarDescriptionParams } from "@/lib/calendar";
import { type CalendarEventInput } from "./calendar-client";

export interface EventBuildInput {
  planId: string;
  planItemId: string;
  sessionId: string;
  userId: string;
  calendarId: string;
  courseName: string;
  examName: string;
  mode: string;
  topicScope: string;
  plannedMinutes: number;
  startTime: string; // ISO
  endTime: string;   // ISO
  timezone?: string;
  /** Topic titles, or the session's objectives as stored ({ id, title } objects). */
  objectives?: unknown;
  targetOutcome?: Record<string, unknown> | null;
  breakProtocol?: Record<string, unknown> | null;
  baseUrl: string;
}

export interface BuiltEvent {
  input: CalendarEventInput;
  hash: string;
}

/**
 * Build a CalendarEventInput + canonical hash from plan item data.
 */
export function buildEventPayload(params: EventBuildInput): BuiltEvent {
  const sessionUrl = `${params.baseUrl}/s/${params.sessionId}`;

  const summary = buildCalendarTitle({
    courseName: params.courseName,
    examName: params.examName,
    mode: params.mode,
    topicScope: params.topicScope,
  });

  const description = buildCalendarDescription({
    courseName: params.courseName,
    examName: params.examName,
    mode: params.mode,
    topics: params.objectives,
    topicScope: params.topicScope,
    outcome: (params.targetOutcome ?? null) as CalendarDescriptionParams["outcome"],
    breaks: (params.breakProtocol ?? null) as CalendarDescriptionParams["breaks"],
    sessionUrl,
  });

  // Extended properties for reconciliation
  const extendedProperties: Record<string, string> = {
    sb_plan: params.planId,
    sb_item: params.planItemId,
    sb_sess: params.sessionId,
    sb_uid: hashUserId(params.userId),
  };

  const input: CalendarEventInput = {
    calendarId: params.calendarId,
    summary,
    description,
    start: params.startTime,
    end: params.endTime,
    timeZone: params.timezone,
    transparency: "opaque",
    reminders: { useDefault: true },
    extendedProperties,
  };

  const hash = computeEventHash(input);

  return { input, hash };
}

/**
 * Canonical SHA-256 hash of the event payload for change detection.
 * Deterministic: same inputs always produce the same hash.
 */
export function computeEventHash(input: CalendarEventInput): string {
  const canonical = JSON.stringify({
    summary: input.summary,
    description: input.description,
    start: input.start,
    end: input.end,
    timeZone: input.timeZone,
    transparency: input.transparency,
    extendedProperties: input.extendedProperties,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Short hash of a user ID for extended properties (no PII).
 */
export function hashUserId(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 16);
}
