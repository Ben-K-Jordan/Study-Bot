/**
 * Build Google Calendar event payloads from StudyPlan data.
 *
 * Deterministic templates — no LLM calls.
 * Includes hash-based change detection for skip-on-unchanged.
 */
import { createHash } from "crypto";
import { buildCalendarTitle, buildCalendarDescription, MODE_LABELS } from "@/lib/calendar";
import { type SessionMode } from "@/lib/validation";
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
  objectives?: string[] | null;
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
    mode: params.mode as SessionMode,
    topicScope: params.topicScope,
  });

  const descriptionParts: string[] = [];

  // Top line: deep link
  descriptionParts.push(`StudyBot session: ${sessionUrl}`);
  descriptionParts.push("");

  // Objectives (max 5 + truncation)
  if (params.objectives && params.objectives.length > 0) {
    const shown = params.objectives.slice(0, 5);
    const remaining = params.objectives.length - shown.length;
    descriptionParts.push("Objectives:");
    for (const obj of shown) {
      descriptionParts.push(`  - ${obj}`);
    }
    if (remaining > 0) {
      descriptionParts.push(`  +${remaining} more`);
    }
    descriptionParts.push("");
  }

  // Mode
  const modeLabel = MODE_LABELS[params.mode] || params.mode;
  descriptionParts.push(`Mode: ${modeLabel}`);

  // Target
  if (params.targetOutcome) {
    const o = params.targetOutcome;
    const parts: string[] = [];
    if (o.prompt_count) parts.push(`${o.prompt_count} prompts`);
    if (o.target_accuracy != null) parts.push(`target ${((o.target_accuracy as number) * 100).toFixed(0)}%`);
    if (parts.length > 0) {
      descriptionParts.push(`Target: ${parts.join(", ")}`);
    }
  }

  // Break protocol
  if (params.breakProtocol) {
    const bp = params.breakProtocol;
    const bpType = bp.type as string | undefined;
    if (bpType) {
      const label = bpType === "50_10" ? "50/10" : bpType === "25_5" ? "25/5" : bpType === "90_15" ? "90/15" : bpType;
      descriptionParts.push(`Protocol: ${label} — phone away`);
    }
  }

  descriptionParts.push("");
  descriptionParts.push("Created by Study Bot");

  const description = descriptionParts.join("\n");

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
 * Short hash of user ID for extended properties (no PII).
 */
function hashUserId(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 16);
}

export { hashUserId as _hashUserIdForTest };
