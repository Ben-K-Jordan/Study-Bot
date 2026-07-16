import { prisma } from "@/lib/db";
import { generateSessionId } from "@/lib/session-id";
import { computeFollowups } from "@/lib/spacing";
import { dayKey } from "@/lib/timezone";
import { getBaseUrl } from "@/lib/config";
import { logger } from "@/lib/logger";

/**
 * Follow-up scheduling: turn a completed run's spaced-repetition
 * recommendations (computeFollowups — the same deterministic ladder the end
 * screen displays) into real StudyPlanItems on the user's active plan.
 *
 * Conventions mirror src/services/plan.ts: one Session row per plan item
 * (unique planId+sessionId), RETRIEVAL mode, objectives copied from the
 * source session, times anchored to the plan's availability windows.
 * Idempotency: each created Session carries a `followup_of_run_id` marker in
 * its resources JSON — a second call for the same run returns the existing
 * items instead of double-inserting.
 */

const FOLLOWUP_DURATION_MINUTES = 30;
const DEFAULT_START_TIME = "09:00";
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ScheduledFollowup {
  session_id: string;
  session_url: string;
  /** YYYY-MM-DD in the plan's timezone. */
  date: string;
  days_from_now: number | null;
  start_time: string; // ISO instant
}

export interface SkippedFollowup {
  /** YYYY-MM-DD in the plan's timezone. */
  date: string;
  days_from_now: number;
  reason: "past_exam";
}

export interface PlannedFollowupItem {
  days_from_now: number;
  /** YYYY-MM-DD in the plan's timezone. */
  date: string;
  day_index: number;
  start_time: Date;
  end_time: Date;
}

export interface FollowupScheduleInput {
  /** Graded accuracy of the completed run (0-1). */
  accuracy: number;
  /** When the run ended — the anchor every follow-up offset counts from. */
  endedAt: Date;
  /** IANA timezone of the study plan. */
  timezone: string;
  /** Exam date as YYYY-MM-DD; follow-ups after this day are skipped. */
  examDate: string;
  /** Plan start date as YYYY-MM-DD (dayIndex anchor). */
  planStartDate: string;
  /** Per-day availability windows from the plan config (indexed by dayIndex). */
  availability?: { start: string; end: string }[] | null;
}

/** Difference in calendar days between two YYYY-MM-DD strings. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

/**
 * Convert a wall-clock time in an IANA timezone to a UTC instant.
 * Two-pass correction handles DST transitions; an invalid timezone falls
 * back to the server's local clock (same behavior as dayKey).
 */
function wallTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, mi] = timeStr.split(":").map(Number);
  const target = Date.UTC(y, mo - 1, d, h, mi, 0);
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    let ts = target;
    for (let i = 0; i < 2; i++) {
      const parts: Record<string, string> = {};
      for (const p of dtf.formatToParts(new Date(ts))) parts[p.type] = p.value;
      const wall = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        parts.hour === "24" ? 0 : Number(parts.hour),
        Number(parts.minute),
      );
      const diff = wall - target;
      if (diff === 0) break;
      ts -= diff;
    }
    return new Date(ts);
  } catch {
    return new Date(y, mo - 1, d, h, mi, 0, 0);
  }
}

/**
 * Pure scheduling core: map a run's accuracy + end time onto concrete plan
 * dates. Deterministic — the same run always yields the same schedule.
 */
export function computeFollowupSchedule(input: FollowupScheduleInput): {
  planned: PlannedFollowupItem[];
  skipped: SkippedFollowup[];
} {
  const recommendations = computeFollowups(input.accuracy, input.endedAt);
  const planned: PlannedFollowupItem[] = [];
  const skipped: SkippedFollowup[] = [];

  for (const rec of recommendations) {
    // The recommended calendar day, expressed in the plan's timezone.
    const date = dayKey(
      new Date(input.endedAt.getTime() + rec.days_from_now * DAY_MS),
      input.timezone,
    );
    // YYYY-MM-DD strings compare lexicographically.
    if (date > input.examDate) {
      skipped.push({ date, days_from_now: rec.days_from_now, reason: "past_exam" });
      continue;
    }

    const dayIndex = daysBetween(input.planStartDate, date);
    // Days beyond the plan window reuse the same weekday's window.
    const avail =
      input.availability?.[dayIndex] ??
      input.availability?.[((dayIndex % 7) + 7) % 7];
    const startTime = wallTimeToUtc(date, avail?.start ?? DEFAULT_START_TIME, input.timezone);

    planned.push({
      days_from_now: rec.days_from_now,
      date,
      day_index: dayIndex,
      start_time: startTime,
      end_time: new Date(startTime.getTime() + FOLLOWUP_DURATION_MINUTES * 60000),
    });
  }

  return { planned, skipped };
}

/**
 * Insert the recommended follow-ups for a completed run into the user's
 * active study plan. Idempotent per run: repeated calls return the already
 * scheduled items ("already_scheduled") instead of inserting duplicates.
 */
export async function scheduleFollowups(userId: string, runId: string) {
  const run = await prisma.sessionRun.findUnique({
    where: { runId },
    select: {
      runId: true,
      userId: true,
      sessionId: true,
      status: true,
      endedAt: true,
      metrics: true,
    },
  });
  if (!run) return { error: "not_found" as const };
  if (run.userId !== userId) return { error: "forbidden" as const };
  if (run.status !== "COMPLETED") return { error: "run_not_completed" as const };

  const session = await prisma.session.findUnique({
    where: { sessionId: run.sessionId },
  });
  if (!session) return { error: "not_found" as const };

  // Active plan: the course's plan with the nearest upcoming exam (same
  // convention as the exam-aware mastery lookup in run.ts).
  const plan = await prisma.studyPlan.findFirst({
    where: { userId, courseName: session.courseName, examDate: { gte: new Date() } },
    orderBy: { examDate: "asc" },
  });
  if (!plan) return { data: { status: "no_plan" as const } };

  const metrics = run.metrics as { accuracy?: number } | null;
  const { planned, skipped } = computeFollowupSchedule({
    accuracy: metrics?.accuracy ?? 0,
    endedAt: run.endedAt ?? new Date(),
    timezone: plan.timezone,
    examDate: plan.examDate.toISOString().split("T")[0],
    planStartDate: plan.startDate.toISOString().split("T")[0],
    availability: (plan.config as { availability?: { start: string; end: string }[] } | null)
      ?.availability,
  });

  const base = getBaseUrl();
  const breakProtocol = (plan.config as { break_protocol_default?: string } | null)
    ?.break_protocol_default ?? "50_10";

  const result = await prisma.$transaction(async (tx) => {
    // Idempotency guard: sessions created by a previous call carry the run
    // marker in their resources JSON.
    const existing = await tx.session.findMany({
      where: {
        userId,
        resources: { path: ["followup_of_run_id"], equals: run.runId },
      },
      select: { sessionId: true, resources: true },
    });

    if (existing.length > 0) {
      const daysBySession = new Map(
        existing.map((s) => [
          s.sessionId,
          (s.resources as { followup_days_from_now?: number } | null)
            ?.followup_days_from_now ?? null,
        ]),
      );
      const items = await tx.studyPlanItem.findMany({
        where: { sessionId: { in: existing.map((s) => s.sessionId) } },
        orderBy: { startTime: "asc" },
      });
      return {
        status: "already_scheduled" as const,
        scheduled: items.map((item) => ({
          session_id: item.sessionId,
          session_url: `${base}/s/${item.sessionId}`,
          date: dayKey(item.startTime, plan.timezone),
          days_from_now: daysBySession.get(item.sessionId) ?? null,
          start_time: item.startTime.toISOString(),
        })),
      };
    }

    const toCreate = planned.map((p) => ({ ...p, sessionId: generateSessionId() }));

    if (toCreate.length > 0) {
      await tx.session.createMany({
        data: toCreate.map((p) => ({
          sessionId: p.sessionId,
          userId,
          courseId: session.courseId,
          courseName: session.courseName,
          examId: session.examId,
          examName: session.examName,
          mode: "RETRIEVAL",
          topicScope: `Follow-up: ${session.topicScope}`,
          objectives: session.objectives ?? undefined,
          targetOutcome: {
            type: "accuracy",
            prompt_count: 8,
            target_accuracy: 0.8,
            closed_book_required: true,
          },
          breakProtocol: { type: breakProtocol, cycles: 1 },
          resources: {
            followup_of_run_id: run.runId,
            followup_days_from_now: p.days_from_now,
          },
          plannedMinutes: FOLLOWUP_DURATION_MINUTES,
        })),
      });

      await tx.studyPlanItem.createMany({
        data: toCreate.map((p) => ({
          planId: plan.planId,
          sessionId: p.sessionId,
          dayIndex: p.day_index,
          startTime: p.start_time,
          endTime: p.end_time,
        })),
      });
    }

    return {
      status: "scheduled" as const,
      scheduled: toCreate.map((p) => ({
        session_id: p.sessionId,
        session_url: `${base}/s/${p.sessionId}`,
        date: p.date,
        days_from_now: p.days_from_now as number | null,
        start_time: p.start_time.toISOString(),
      })),
    };
  });

  logger.info("followups.scheduled", {
    user_id: userId,
    run_id: runId,
    plan_id: plan.planId,
    status: result.status,
    scheduled_count: result.scheduled.length,
    skipped_count: skipped.length,
  });

  return {
    data: {
      status: result.status,
      plan_id: plan.planId,
      timezone: plan.timezone,
      scheduled: result.scheduled as ScheduledFollowup[],
      skipped,
    },
  };
}
