import { prisma } from "@/lib/db";
import { generateSessionId } from "@/lib/session-id";
import { buildCalendarTitle, buildCalendarDescription } from "@/lib/calendar";
import {
  createSessionSchema,
  SessionMode,
} from "@/lib/validation";
import { logger } from "@/lib/logger";
import { getBaseUrl } from "@/lib/config";
import { computeFollowups } from "@/lib/spacing";
import { dayKey, getUserTimezone, zonedTimeToUtc } from "@/lib/timezone";
import { getDeckPreview } from "@/services/run";
import { computeFollowupSchedule } from "@/services/followups";
import { sessionModeCopy } from "@/components/session/modes";
import type {
  ActiveRunSummary,
  DeckComposition,
  FollowupItem,
  FollowupPreview,
  RatedAnswer,
  RunMetrics,
  SelfScore,
  SessionData,
  SessionResults,
} from "@/components/session/types";

const DAY_MS = 24 * 60 * 60 * 1000;

// Steps and rules written into calendar event descriptions.
function defaultPlanSteps(minutes: number): string[] {
  if (minutes <= 30) {
    return [
      `Minutes 0 to 5: Read the topics for this session`,
      `Minutes 5 to ${minutes - 5}: Answer questions from memory`,
      `Minutes ${minutes - 5} to ${minutes}: Score your answers and log errors`,
    ];
  }
  const workEnd = Math.min(minutes - 15, 55);
  return [
    `Minutes 0 to 5: Read the topics for this session`,
    `Minutes 5 to ${workEnd}: Answer questions from memory, notes closed`,
    `Minutes ${workEnd} to ${workEnd + 10}: Review your errors and write similar questions`,
    `Minutes ${workEnd + 10} to ${minutes}: Score your answers and wrap up`,
  ];
}

function defaultRules(closedBook?: boolean): string[] {
  const rules = ["Put your phone on airplane mode or in another room"];
  if (closedBook) {
    rules.unshift("Answer with your notes closed first, then check");
  }
  rules.push("Stuck for more than 3 minutes? Write down what blocks you and move on");
  return rules;
}

export async function createSession(userId: string, input: unknown) {
  const parsed = createSessionSchema.parse(input);

  const sessionId = generateSessionId();
  const sessionUrl = `${getBaseUrl()}/s/${sessionId}`;

  const calendarTitle = buildCalendarTitle({
    courseName: parsed.course_name,
    examName: parsed.exam_name,
    mode: parsed.mode as SessionMode,
    topicScope: parsed.topic_scope,
  });

  const calendarDescription = buildCalendarDescription({
    outcome: parsed.target_outcome ?? null,
    planSteps: defaultPlanSteps(parsed.planned_minutes),
    rules: defaultRules(parsed.target_outcome?.closed_book_required),
    breaks: parsed.break_protocol ?? null,
    sessionUrl,
    resources: parsed.resources ?? null,
  });

  const session = await prisma.session.create({
    data: {
      sessionId,
      userId,
      courseId: parsed.course_id ?? "",
      courseName: parsed.course_name,
      examId: parsed.exam_id ?? "",
      examName: parsed.exam_name,
      mode: parsed.mode,
      topicScope: parsed.topic_scope,
      objectives: parsed.objectives ?? undefined,
      targetOutcome: parsed.target_outcome ?? undefined,
      breakProtocol: parsed.break_protocol ?? undefined,
      resources: parsed.resources ?? undefined,
      plannedMinutes: parsed.planned_minutes,
    },
  });

  logger.info("session.created", {
    user_id: userId,
    session_id: session.sessionId,
    mode: parsed.mode,
    planned_minutes: parsed.planned_minutes,
  });

  return {
    session_id: session.sessionId,
    session_url: sessionUrl,
    calendar: {
      title: calendarTitle,
      description: calendarDescription,
    },
  };
}

export async function getSession(userId: string, sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { sessionId },
  });

  if (!session) {
    return { error: "not_found" as const };
  }

  if (session.userId !== userId) {
    return { error: "forbidden" as const };
  }

  return {
    data: {
      session_id: session.sessionId,
      user_id: session.userId,
      course_id: session.courseId,
      course_name: session.courseName,
      exam_id: session.examId,
      exam_name: session.examName,
      mode: session.mode,
      topic_scope: session.topicScope,
      objectives: session.objectives,
      target_outcome: session.targetOutcome,
      break_protocol: session.breakProtocol,
      resources: session.resources,
      planned_minutes: session.plannedMinutes,
      created_at: session.createdAt.toISOString(),
      updated_at: session.updatedAt.toISOString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Session screen (/s/[sessionId])
// ---------------------------------------------------------------------------

interface DeckPromptMeta {
  pack?: unknown;
  source_error_log_id?: unknown;
}

function promptMeta(value: unknown): DeckPromptMeta {
  return value && typeof value === "object" ? (value as DeckPromptMeta) : {};
}

const REPAIR_PACKS = new Set(["CROSS_SESSION_REPAIR", "VARIANT_REPAIR"]);

/** A repair question retests a logged error. */
function isRepairPrompt(meta: DeckPromptMeta, sourceType?: string | null): boolean {
  return (
    sourceType === "ERROR_LOG" ||
    sourceType === "VARIANT_REPAIR" ||
    (typeof meta.pack === "string" && REPAIR_PACKS.has(meta.pack)) ||
    typeof meta.source_error_log_id === "string"
  );
}

/**
 * What an open run's deck holds, read from the deck itself, so a resumed
 * session states its composition as plainly as a new one.
 */
export function compositionFromDeck(prompts: unknown, promptCount: number): DeckComposition {
  const list = Array.isArray(prompts) ? prompts : [];
  let pretest = 0;
  let review = 0;
  let repair = 0;
  for (const prompt of list) {
    const meta = promptMeta((prompt as { meta?: unknown } | null)?.meta);
    if (meta.pack === "PRE_TEST") pretest += 1;
    else if (meta.pack === "WARMUP") review += 1;
    else if (isRepairPrompt(meta)) repair += 1;
  }
  const total = Math.max(promptCount, list.length);
  return {
    total,
    new_count: Math.max(0, total - pretest - review - repair),
    diagnostic_count: pretest,
    review_count: review,
    repair_count: repair,
  };
}

/** A date-only exam day as an instant at noon in the zone, so it formats as that day anywhere near it. */
function examDayInstant(examDate: Date, timeZone: string | null): string {
  const key = examDate.toISOString().slice(0, 10);
  return zonedTimeToUtc(key, "12:00", timeZone).toISOString();
}

/**
 * Whether the session exists and belongs to this user: one indexed lookup,
 * so the page can answer 404 before it starts streaming.
 */
export async function isSessionOwner(userId: string, sessionId: string): Promise<boolean> {
  const session = await prisma.session.findUnique({
    where: { sessionId },
    select: { userId: true },
  });
  return session?.userId === userId;
}

export interface SessionScreenData {
  session: SessionData;
  /** Streams to the preflight; never rejects. */
  deckPreview: Promise<DeckComposition | null>;
  /** Results of the last finished run when the page opens on them. */
  results: SessionResults | null;
}

/**
 * Everything the session page needs, for the owner only. Anyone else gets
 * the same not_found as a missing session, so session links can't be
 * probed. Independent queries run together; the deck preview (the slowest
 * part) is returned as a promise so the page can stream it.
 */
export async function getSessionScreen(
  userId: string,
  sessionId: string,
): Promise<{ error: "not_found" } | { data: SessionScreenData }> {
  const [session, lastCompleted, planItem, userTimezone] = await Promise.all([
    prisma.session.findUnique({
      where: { sessionId },
      include: {
        runs: {
          where: { status: { in: ["CREATED", "ACTIVE"] } },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    }),
    prisma.sessionRun.findFirst({
      where: { sessionId, userId, status: "COMPLETED" },
      orderBy: { endedAt: "desc" },
      select: { runId: true, metrics: true, endedAt: true },
    }),
    prisma.studyPlanItem.findFirst({
      where: { sessionId, plan: { userId } },
      select: { startTime: true, plan: { select: { examDate: true, timezone: true } } },
    }),
    getUserTimezone(userId),
  ]);

  if (!session || session.userId !== userId) return { error: "not_found" };

  const timezone = userTimezone ?? planItem?.plan.timezone ?? null;
  const mode = sessionModeCopy(session.mode);
  const outcome = (session.targetOutcome as Record<string, unknown> | null) ?? null;
  const objectives = (session.objectives as { id: string; title: string }[] | null) ?? null;
  const openRun = session.runs[0] ?? null;

  const activeRun: ActiveRunSummary | null = openRun
    ? {
        run_id: openRun.runId,
        phase: openRun.phase,
        current_index: openRun.currentIndex,
        prompt_count: openRun.promptCount,
        answered_count: openRun.answeredCount,
        started_at: openRun.startedAt?.toISOString() ?? null,
      }
    : null;

  const deckPreview: Promise<DeckComposition | null> = openRun
    ? Promise.resolve(compositionFromDeck(openRun.prompts, openRun.promptCount))
    : getDeckPreview(userId, {
        courseName: session.courseName,
        mode: session.mode,
        objectives,
        promptCount: typeof outcome?.prompt_count === "number" ? outcome.prompt_count : 10,
      }).catch((err: unknown) => {
        logger.warn("session.deck_preview_failed", { session_id: sessionId, error: String(err) });
        return null;
      });

  const results =
    lastCompleted && !openRun
      ? await buildRunResults(userId, lastCompleted.runId, timezone).catch((err: unknown) => {
          logger.error("session.results_failed", { session_id: sessionId, error: String(err) });
          return null;
        })
      : null;

  const data: SessionData = {
    session_id: session.sessionId,
    course_name: session.courseName,
    exam_name: session.examName,
    mode: session.mode,
    mode_label: mode.label,
    mode_description: mode.description,
    topic_scope: session.topicScope,
    planned_minutes: session.plannedMinutes,
    target_outcome: outcome,
    break_protocol: (session.breakProtocol as Record<string, unknown> | null) ?? null,
    objectives,
    deck_preview: null,
    has_active_run: openRun != null,
    active_run_id: openRun?.runId ?? null,
    active_run: activeRun,
    last_completed_run: lastCompleted
      ? {
          run_id: lastCompleted.runId,
          metrics: (lastCompleted.metrics as Record<string, unknown>) ?? {},
          ended_at: lastCompleted.endedAt?.toISOString() ?? null,
        }
      : null,
    timezone,
    exam_date: planItem ? examDayInstant(planItem.plan.examDate, timezone) : null,
    scheduled_at: planItem?.startTime.toISOString() ?? null,
  };

  return { data: { session: data, deckPreview, results } };
}

// ---------------------------------------------------------------------------
// Results (end screen)
// ---------------------------------------------------------------------------

function asSelfScore(value: string | null): SelfScore | null {
  return value === "CORRECT" || value === "PARTIAL" || value === "INCORRECT" ? value : null;
}

function normalizeMetrics(value: unknown): RunMetrics {
  const m = (value && typeof value === "object" ? value : {}) as Partial<RunMetrics>;
  return {
    attempts_count: m.attempts_count ?? 0,
    correct_count: m.correct_count ?? 0,
    partial_count: m.partial_count ?? 0,
    incorrect_count: m.incorrect_count ?? 0,
    accuracy: m.accuracy ?? 0,
    time_spent_seconds: m.time_spent_seconds ?? 0,
    pretest_count: m.pretest_count,
    pretest_correct: m.pretest_correct,
  };
}

/**
 * Follow-up sessions for a finished run, with the dates the scheduler will
 * use (or used): the plan's dates and times when a plan exists, else the
 * recommended days in the student's zone. Dates are anchored to when the
 * run ended, so they never drift after a reload.
 */
export async function getFollowupPreview(
  userId: string,
  run: { runId: string; endedAt: Date | null; accuracy: number },
  courseName: string,
  userTimezone: string | null,
): Promise<FollowupPreview> {
  const existing = await prisma.session.findMany({
    where: { userId, resources: { path: ["followup_of_run_id"], equals: run.runId } },
    select: { sessionId: true, resources: true },
  });

  if (existing.length > 0) {
    const daysBySession = new Map(
      existing.map((s) => [
        s.sessionId,
        (s.resources as { followup_days_from_now?: number } | null)?.followup_days_from_now ?? null,
      ]),
    );
    const items = await prisma.studyPlanItem.findMany({
      where: { sessionId: { in: existing.map((s) => s.sessionId) }, plan: { userId } },
      orderBy: { startTime: "asc" },
      select: { sessionId: true, startTime: true, plan: { select: { timezone: true, examName: true } } },
    });
    const timezone = items[0]?.plan.timezone ?? userTimezone ?? "UTC";
    return {
      status: "scheduled",
      timezone,
      exam_name: items[0]?.plan.examName ?? null,
      items: items.map((item) => ({
        date: dayKey(item.startTime, timezone),
        at: item.startTime.toISOString(),
        days_from_now: daysBySession.get(item.sessionId) ?? null,
        session_id: item.sessionId,
      })),
      skipped: [],
    };
  }

  // The plan scheduleFollowups adds to: this course's plan with the nearest
  // upcoming exam.
  const plan = await prisma.studyPlan.findFirst({
    where: { userId, courseName, examDate: { gte: new Date() } },
    orderBy: { examDate: "asc" },
  });
  const endedAt = run.endedAt ?? new Date();

  if (!plan) {
    const timezone = userTimezone ?? "UTC";
    const items: FollowupItem[] = computeFollowups(run.accuracy, endedAt).map((rec) => {
      const date = dayKey(new Date(endedAt.getTime() + rec.days_from_now * DAY_MS), timezone);
      return {
        date,
        at: zonedTimeToUtc(date, "12:00", timezone).toISOString(),
        days_from_now: rec.days_from_now,
      };
    });
    return { status: "no_plan", timezone, exam_name: null, items, skipped: [] };
  }

  const { planned, skipped } = computeFollowupSchedule({
    accuracy: run.accuracy,
    endedAt,
    timezone: plan.timezone,
    examDate: plan.examDate.toISOString().split("T")[0],
    planStartDate: dayKey(plan.startDate, plan.timezone),
    availability: (plan.config as { availability?: { start: string; end: string }[] } | null)
      ?.availability,
  });

  return {
    status: "not_scheduled",
    timezone: plan.timezone,
    exam_name: plan.examName,
    items: planned.map((p) => ({
      date: p.date,
      at: p.start_time.toISOString(),
      days_from_now: p.days_from_now,
    })),
    skipped: skipped.map((s) => ({
      date: s.date,
      at: zonedTimeToUtc(s.date, "12:00", plan.timezone).toISOString(),
      days_from_now: s.days_from_now,
    })),
  };
}

type ResultsError = "not_found" | "forbidden" | "not_completed";

async function buildRunResults(
  userId: string,
  runId: string,
  userTimezone: string | null,
  sessionId?: string,
): Promise<SessionResults> {
  const result = await loadRunResults(userId, runId, userTimezone, sessionId);
  if ("error" in result) throw new Error(result.error);
  return result.data;
}

async function loadRunResults(
  userId: string,
  runId: string,
  userTimezone: string | null,
  sessionId?: string,
): Promise<{ error: ResultsError } | { data: SessionResults }> {
  const run = await prisma.sessionRun.findUnique({
    where: { runId },
    select: {
      runId: true,
      sessionId: true,
      userId: true,
      status: true,
      mode: true,
      metrics: true,
      prompts: true,
      answeredCount: true,
      scoredCount: true,
      startedAt: true,
      endedAt: true,
      session: { select: { courseName: true } },
      attempts: {
        orderBy: { promptIndex: "asc" },
        select: { promptIndex: true, selfScore: true, confidenceRating: true },
      },
      runPrompts: { select: { promptIndex: true, sourceType: true, meta: true } },
      _count: { select: { errorLogs: true } },
    },
  });

  if (!run || (sessionId !== undefined && run.sessionId !== sessionId)) return { error: "not_found" };
  if (run.userId !== userId) return { error: "forbidden" };
  if (run.status !== "COMPLETED") return { error: "not_completed" };

  // Which questions were pretests or repairs: the normalized rows, falling
  // back to the legacy deck for runs saved before they existed.
  const kinds = new Map<number, { pretest: boolean; repair: boolean }>();
  if (run.runPrompts.length > 0) {
    for (const row of run.runPrompts) {
      const meta = promptMeta(row.meta);
      kinds.set(row.promptIndex, {
        pretest: meta.pack === "PRE_TEST",
        repair: isRepairPrompt(meta, row.sourceType),
      });
    }
  } else if (Array.isArray(run.prompts)) {
    run.prompts.forEach((prompt, index) => {
      const meta = promptMeta((prompt as { meta?: unknown } | null)?.meta);
      kinds.set(index, { pretest: meta.pack === "PRE_TEST", repair: isRepairPrompt(meta) });
    });
  }

  const metrics = normalizeMetrics(run.metrics);
  const answers: RatedAnswer[] = [];
  let pretestAnswered = 0;
  let repairAnswered = 0;
  for (const attempt of run.attempts) {
    const kind = kinds.get(attempt.promptIndex);
    if (kind?.pretest) {
      pretestAnswered += 1;
      continue;
    }
    if (kind?.repair) repairAnswered += 1;
    const score = asSelfScore(attempt.selfScore);
    if (!score) continue;
    answers.push({
      prompt_index: attempt.promptIndex,
      confidence: attempt.confidenceRating,
      score,
    });
  }

  const followups =
    metrics.attempts_count > 0
      ? await getFollowupPreview(
          userId,
          { runId: run.runId, endedAt: run.endedAt, accuracy: metrics.accuracy },
          run.session.courseName,
          userTimezone,
        )
      : null;

  return {
    data: {
      run_id: run.runId,
      session_id: run.sessionId,
      mode: run.mode,
      started_at: run.startedAt?.toISOString() ?? null,
      ended_at: run.endedAt?.toISOString() ?? null,
      metrics,
      question_count: run.attempts.length,
      pretest_count: Math.max(metrics.pretest_count ?? 0, pretestAnswered),
      repair_count: repairAnswered,
      errors_logged: run._count.errorLogs,
      answered_count: run.answeredCount,
      scored_count: run.scoredCount,
      answers,
      followups,
    },
  };
}

/**
 * Results of one finished run of a session, for its owner. The run must
 * belong to the session in the URL.
 */
export async function getSessionResults(userId: string, sessionId: string, runId: string) {
  const userTimezone = await getUserTimezone(userId);
  return loadRunResults(userId, runId, userTimezone, sessionId);
}
