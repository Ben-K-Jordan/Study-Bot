import { prisma } from "@/lib/db";
import { generateSessionId } from "@/lib/session-id";
import { buildCalendarTitle, buildCalendarDescription } from "@/lib/calendar";
import { createPlanSchema, SessionMode } from "@/lib/validation";
import type { PlanBlock } from "@/lib/plan-generator";
import { generatePlanWithResearch, StudyPreferences } from "@/lib/research-plan-generator";
import { generateIcs, IcsEvent } from "@/lib/ics";
import { logger } from "@/lib/logger";
import { getGoogleClient } from "@/lib/google/calendar-client";
import { computeFreeSlots, fitBlocksIntoSlots, filterBusyEvents, eventsToBufferedIntervals, type TimeInterval } from "@/lib/google/free-slots";
import { buildGoogleCalendarLink } from "@/lib/gcal-link";
import { createProvider } from "@/lib/ai/provider-factory";
import type { GatewayContext } from "@/lib/ai/gateway";
import { buildContentAwarePlanInput, extractObjectivesFromContent } from "@/services/content-plan";
import { buildObjectiveAnchors } from "@/services/anchors";
import {
  applyPreExamTaper,
  adjustDurationByMode,
  fitBlocksScored,
  estimateBedtime,
  type CalendarEvent as IntelEvent,
  type Chronotype,
  type SessionMode as IntelMode,
} from "@/lib/schedule-intelligence";
import { getBaseUrl } from "@/lib/config";
import {
  addDays,
  dayKey,
  daysBetween,
  getUserTimezone,
  isValidTimezone,
  zonedTimeToUtc,
} from "@/lib/timezone";
import { dateColumnKey, dateColumnValue } from "@/lib/plan-dates";
import { classifyPlanItem, countPlanItems, runStateFromStatuses, type PlanItemCounts, type PlanItemState, type RunState } from "@/lib/plan-status";
import { calendarErrorMessage, unpublishPlanFromGoogle } from "@/services/publish";

/** Used when neither the request nor the user's settings name a timezone. */
const DEFAULT_PLAN_TIMEZONE = "America/New_York";

/** Where a new plan's topics came from. */
export type TopicsSource = "typed" | "materials" | "fallback";

/**
 * Availability windows ("09:00") are wall-clock times in the plan's timezone.
 * Day 0 is the calendar day the plan starts on, in that same zone.
 */
function computeStartTime(
  startDay: string,
  dayIndex: number,
  timeStr: string,
  timeZone: string,
): Date {
  return zonedTimeToUtc(addDays(startDay, dayIndex), timeStr, timeZone);
}

export async function createPlan(userId: string, input: unknown) {
  const parsed = createPlanSchema.parse(input);

  // The plan's timezone: the one sent with the request, else the user's
  // setting, else the default. Invalid names are skipped.
  const timeZone =
    [parsed.timezone, await getUserTimezone(userId)].find(
      (tz): tz is string => !!tz && isValidTimezone(tz),
    ) ?? DEFAULT_PLAN_TIMEZONE;

  const planId = generateSessionId();
  const startDate = new Date();
  const startDay = dayKey(startDate, timeZone);
  // The plan covers 7 calendar days: day 0 through day 6. Both are DATE
  // columns, so write the calendar day itself, never an instant (an evening
  // instant is already tomorrow in UTC).
  const startDateColumn = dateColumnValue(startDay);
  const endDateColumn = dateColumnValue(addDays(startDay, 6));

  // Build AI gateway context (null if mock — will use deterministic fallback)
  let gatewayCtx: GatewayContext | null = null;
  const providerName = process.env.AI_PROVIDER || "mock";
  if (providerName !== "mock") {
    gatewayCtx = { userId, provider: createProvider() };
  }

  const preferences: StudyPreferences = {
    chronotype: parsed.chronotype,
    preferredSessionMinutes: parsed.preferred_session_minutes,
    studyStyle: parsed.study_style,
  };

  // If no manual objectives, extract them from uploaded content via AI.
  // topicsSource tells the screen whether the materials supplied the topics
  // or general review topics stood in (it must say so).
  let objectives = parsed.objectives;
  let topicsSource: TopicsSource = "typed";
  if (objectives.length === 0 && parsed.document_ids.length > 0) {
    topicsSource = "materials";
    try {
      const suggested = await extractObjectivesFromContent(
        userId,
        parsed.course_name,
        parsed.exam_name,
        parsed.document_ids,
      );
      objectives = suggested.map((s) => s.title).filter(Boolean);
      if (objectives.length < 3) {
        // Pad with generic fallbacks so the plan generator has enough to work with
        topicsSource = "fallback";
        const fallbacks = ["Review key concepts", "Practice problem solving", "Consolidate understanding"];
        while (objectives.length < 3) {
          objectives.push(fallbacks[objectives.length] || `Study topic ${objectives.length + 1}`);
        }
      }
      logger.info("plan.objectives_extracted", {
        user_id: userId,
        count: objectives.length,
        from_documents: parsed.document_ids.length,
      });
    } catch (err) {
      logger.warn("plan.objectives_extraction_failed", { user_id: userId, error: String(err) });
      objectives = ["Review key concepts", "Practice problem solving", "Consolidate understanding"];
      topicsSource = "fallback";
    }
  }

  // Check if the user has uploaded content for this course and enrich the plan input
  let contentContext: string | undefined;
  try {
    const contentMeta = await buildContentAwarePlanInput(
      userId,
      parsed.course_name,
      parsed.exam_name,
      parsed.document_ids,
    );
    if (contentMeta.hasContent) {
      contentContext = contentMeta.contentContext;
      logger.info("plan.content_aware", {
        user_id: userId,
        document_count: contentMeta.documentCount,
        total_chunks: contentMeta.totalChunks,
      });
    }
  } catch (err) {
    // Content enrichment failure must not block plan creation
    logger.warn("plan.content_aware_failed", { user_id: userId, error: String(err) });
  }

  const planResult = await generatePlanWithResearch(
    {
      objectives,
      dailyCap: parsed.daily_study_cap_minutes,
      breakProtocol: parsed.break_protocol_default,
      availability: parsed.availability,
      examDate: parsed.exam_date,
      preferences,
      contentContext,
    },
    gatewayCtx,
  );

  // --- Schedule Intelligence: taper + dynamic duration ---

  // 1. Apply pre-exam taper (reduce volume in final 48h before exam)
  // exam_date (YYYY-MM-DD) is a calendar day in the plan's timezone
  const examDateObj = zonedTimeToUtc(parsed.exam_date, "00:00", timeZone);
  let blocks = applyPreExamTaper(planResult.blocks, examDateObj, startDate, timeZone);

  // 2. Apply dynamic session duration caps by cognitive load
  blocks = blocks.map((b) => ({
    ...b,
    plannedMinutes: adjustDurationByMode(b.plannedMinutes, b.mode),
  }));

  logger.info("plan.intelligence_applied", {
    user_id: userId,
    original_blocks: planResult.blocks.length,
    tapered_blocks: blocks.length,
  });

  // If Google availability is requested, fetch busy times + events and use scored fitting
  let googleFreeSlotsByDay: Map<number, TimeInterval[]> | null = null;
  let googleEventsByDay: Map<number, IntelEvent[]> | null = null;
  let inferredBedtime = 23;

  if (parsed.use_google_availability) {
    const integration = await prisma.googleIntegration.findUnique({
      where: { userId },
    });

    if (integration) {
      const client = getGoogleClient(userId);
      const calendarId = integration.calendarIdSelected || "primary";
      // Check busy calendars for availability blocking
      const busyCalendarIds: string[] = integration.busyCalendarIds
        ? integration.busyCalendarIds.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
      // Scrape ALL accessible calendars for comprehensive exercise/meeting detection
      let allCalendarIds: string[];
      try {
        const calendars = await client.listCalendars();
        allCalendarIds = calendars.map((c) => c.id);
        // Ensure the primary + busy calendars are always included
        for (const cid of [calendarId, ...busyCalendarIds]) {
          if (!allCalendarIds.includes(cid)) allCalendarIds.push(cid);
        }
      } catch {
        // Fallback: just use selected + busy calendars
        allCalendarIds = [...new Set([calendarId, ...busyCalendarIds])];
      }

      // Query the 7-day window, from now until midnight after day 6
      const timeMin = startDate.toISOString();
      const timeMax = zonedTimeToUtc(addDays(startDay, 7), "00:00", timeZone).toISOString();

      try {
        // Fetch events from ALL calendars (for exercise/meeting/fatigue detection)
        const eventLists = await Promise.all(
          allCalendarIds.map((cid) =>
            client.listEvents({
              calendarId: cid,
              timeMin,
              timeMax,
              singleEvents: true,
              maxResults: 250,
            }).catch(() => []),
          ),
        );

        const rawEvents = eventLists.flat();

        // Filter out declined, cancelled, and transparent (free) events
        const busyEvents = filterBusyEvents(rawEvents);

        // Convert to buffered intervals (adds context-switching + travel time)
        const busyIntervals = eventsToBufferedIntervals(busyEvents);

        // Keep ALL events (including declined) for intelligence scoring
        // (exercise detection doesn't care about acceptance status)
        const allEvents: IntelEvent[] = rawEvents
          .filter((e) => e.start && e.end && e.status !== "cancelled")
          .map((e) => ({
            summary: e.summary || "",
            start: new Date(e.start).getTime(),
            end: new Date(e.end).getTime(),
          }));

        // Estimate bedtime from event patterns
        inferredBedtime = estimateBedtime(allEvents, timeZone);

        // Group events by day index
        googleEventsByDay = new Map();
        for (const event of allEvents) {
          const dayIdx = daysBetween(startDay, dayKey(new Date(event.start), timeZone));
          if (dayIdx < 0 || dayIdx >= 7) continue;
          if (!googleEventsByDay.has(dayIdx)) googleEventsByDay.set(dayIdx, []);
          googleEventsByDay.get(dayIdx)!.push(event);
        }

        // Compute free slots per day using buffered busy intervals
        googleFreeSlotsByDay = new Map();
        for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
          const dayAvail = parsed.availability[dayIdx];
          const dayStart = computeStartTime(startDay, dayIdx, dayAvail.start, timeZone);
          const dayEnd = computeStartTime(startDay, dayIdx, dayAvail.end, timeZone);
          const freeSlots = computeFreeSlots(dayStart.getTime(), dayEnd.getTime(), busyIntervals);
          googleFreeSlotsByDay.set(dayIdx, freeSlots);
        }

        logger.info("plan.google_availability", {
          user_id: userId,
          total_events_scraped: rawEvents.length,
          busy_events: busyEvents.length,
          declined_filtered: rawEvents.length - busyEvents.length,
          calendars_scraped: allCalendarIds.length,
          inferred_bedtime: inferredBedtime,
        });
      } catch (err) {
        logger.error("plan.google_availability_failed", { user_id: userId, error: String(err) });
        // Fall back to regular scheduling
      }
    }
  }

  // Track cumulative start offset per day for multiple blocks on same day
  const dayOffsets: Record<number, number> = {};

  // Pre-compute all items before any DB writes
  const items: {
    sessionId: string;
    sessionUrl: string;
    dayIndex: number;
    startTime: Date;
    endTime: Date;
    calendar: { title: string; description: string };
    block: PlanBlock;
  }[] = [];

  // If using Google availability, group blocks by day and use scored fitting
  if (googleFreeSlotsByDay) {
    // Group blocks by day
    const blocksByDay = new Map<number, PlanBlock[]>();
    for (const block of blocks) {
      if (!blocksByDay.has(block.dayIndex)) blocksByDay.set(block.dayIndex, []);
      blocksByDay.get(block.dayIndex)!.push(block);
    }

    for (const [dayIdx, dayBlocks] of blocksByDay.entries()) {
      const freeSlots = googleFreeSlotsByDay.get(dayIdx) || [];
      const durations = dayBlocks.map((b) => b.plannedMinutes * 60000);
      const dayEvents = googleEventsByDay?.get(dayIdx) || [];

      // Use cognitively-scored slot fitting when we have event data
      const scheduled = dayEvents.length > 0
        ? fitBlocksScored({
            blockDurationsMs: durations,
            blockModes: dayBlocks.map((b) => b.mode as IntelMode),
            freeSlots,
            chronotype: (parsed.chronotype || "flexible") as Chronotype,
            dayEvents,
            bedtimeHour: inferredBedtime,
            courseName: parsed.course_name,
            blockTopicScopes: dayBlocks.map((b) => b.topicScope),
            timeZone,
          })
        : fitBlocksIntoSlots(durations, freeSlots);

      for (let i = 0; i < dayBlocks.length; i++) {
        const block = dayBlocks[i];
        const slot = scheduled[i];
        if (!slot) continue; // Block doesn't fit: skip it

        const sessionId = generateSessionId();
        const sessionUrl = `${getBaseUrl()}/s/${sessionId}`;

        const calendarTitle = buildCalendarTitle({
          courseName: parsed.course_name,
          examName: parsed.exam_name,
          mode: block.mode as SessionMode,
          topicScope: block.topicScope,
        });

        const calendarDescription = buildCalendarDescription({
          outcome: block.targetOutcome,
          sessionUrl,
          breaks: { type: parsed.break_protocol_default, cycles: 1 },
        });

        items.push({
          sessionId,
          sessionUrl,
          dayIndex: block.dayIndex,
          startTime: new Date(slot.start),
          endTime: new Date(slot.end),
          calendar: { title: calendarTitle, description: calendarDescription },
          block,
        });
      }
    }
  } else {
    // Original scheduling: sequential blocks within availability windows
    for (const block of blocks) {
      const sessionId = generateSessionId();
      const sessionUrl = `${getBaseUrl()}/s/${sessionId}`;

      const calendarTitle = buildCalendarTitle({
        courseName: parsed.course_name,
        examName: parsed.exam_name,
        mode: block.mode as SessionMode,
        topicScope: block.topicScope,
      });

      const calendarDescription = buildCalendarDescription({
        outcome: block.targetOutcome,
        sessionUrl,
        breaks: { type: parsed.break_protocol_default, cycles: 1 },
      });

      // Compute start/end times
      const dayAvail = parsed.availability[block.dayIndex];
      const offsetMinutes = dayOffsets[block.dayIndex] || 0;
      const baseStart = computeStartTime(startDay, block.dayIndex, dayAvail.start, timeZone);
      const startTime = new Date(baseStart.getTime() + offsetMinutes * 60000);
      const endTime = new Date(startTime.getTime() + block.plannedMinutes * 60000);
      dayOffsets[block.dayIndex] = offsetMinutes + block.plannedMinutes;

      items.push({
        sessionId,
        sessionUrl,
        dayIndex: block.dayIndex,
        startTime,
        endTime,
        calendar: { title: calendarTitle, description: calendarDescription },
        block,
      });
    }
  }

  // Transactional: create all sessions + plan + items atomically
  await prisma.$transaction(async (tx) => {
    // Batch-create all sessions in one query instead of N sequential creates
    await tx.session.createMany({
      data: items.map((item) => ({
        sessionId: item.sessionId,
        userId,
        courseId: parsed.course_id ?? "",
        courseName: parsed.course_name,
        examId: parsed.exam_id ?? "",
        examName: parsed.exam_name,
        mode: item.block.mode,
        topicScope: item.block.topicScope,
        objectives: item.block.objectives as object,
        targetOutcome: item.block.targetOutcome as object,
        breakProtocol: { type: parsed.break_protocol_default, cycles: 1 },
        plannedMinutes: item.block.plannedMinutes,
      })),
    });

    await tx.studyPlan.create({
      data: {
        planId,
        userId,
        courseId: parsed.course_id ?? "",
        courseName: parsed.course_name,
        examId: parsed.exam_id ?? "",
        examName: parsed.exam_name,
        examDate: dateColumnValue(parsed.exam_date),
        timezone: timeZone,
        startDate: startDateColumn,
        endDate: endDateColumn,
        config: {
          objectives: parsed.objectives,
          availability: parsed.availability,
          daily_study_cap_minutes: parsed.daily_study_cap_minutes,
          break_protocol_default: parsed.break_protocol_default,
          chronotype: parsed.chronotype,
          preferred_session_minutes: parsed.preferred_session_minutes,
          study_style: parsed.study_style,
        },
        items: {
          create: items.map((item) => ({
            sessionId: item.sessionId,
            dayIndex: item.dayIndex,
            startTime: item.startTime,
            endTime: item.endTime,
          })),
        },
      },
    });
  });

  logger.info("plan.created", {
    user_id: userId,
    plan_id: planId,
    items_count: items.length,
  });

  // Fire-and-forget: pre-build objective anchors so the feedback fast path
  // (objective -> top chunks) is warm before the first session runs. Failure
  // is non-fatal — feedback falls back to FTS when no anchors exist.
  const anchorObjectives = Array.from(
    new Map(
      items.flatMap((item) => item.block.objectives).map((o) => [o.id, o]),
    ).values(),
  );
  if (anchorObjectives.length > 0) {
    void buildObjectiveAnchors(
      userId,
      parsed.course_name,
      parsed.exam_name,
      anchorObjectives,
    )
      .then((res) =>
        // Exam-scoped search only matches documents tagged with this exact
        // exam name. When none are, rebuild unscoped (anchors keyed by "") —
        // the feedback lookup serves both keys, preferring exact matches.
        res.anchors_created === 0
          ? buildObjectiveAnchors(userId, parsed.course_name, undefined, anchorObjectives)
          : res,
      )
      .catch((err) => {
        logger.warn("plan.anchor_build_failed", {
          user_id: userId,
          plan_id: planId,
          error: String(err),
        });
      });
  }

  const baseUrl = getBaseUrl();

  return {
    plan_id: planId,
    course_name: parsed.course_name,
    exam_name: parsed.exam_name,
    exam_date: parsed.exam_date,
    timezone: timeZone,
    ai_generated: planResult.aiGenerated,
    reasoning: planResult.reasoning ?? null,
    /** "typed", "materials", or "fallback" (general review topics stood in). */
    topics_source: topicsSource,
    ics_download_url: `${baseUrl}/api/plans/${planId}/ics`,
    items: items.map((item) => ({
      day_index: item.dayIndex,
      start_time: item.startTime.toISOString(),
      end_time: item.endTime.toISOString(),
      session_id: item.sessionId,
      session_url: item.sessionUrl,
      mode: item.block.mode,
      topic_scope: item.block.topicScope,
      planned_minutes: item.block.plannedMinutes,
      calendar: item.calendar,
      gcal_link: buildGoogleCalendarLink({
        title: item.calendar.title,
        startTime: item.startTime,
        endTime: item.endTime,
        description: item.calendar.description,
      }),
    })),
  };
}

export async function getPlan(userId: string, planId: string) {
  const plan = await prisma.studyPlan.findUnique({
    where: { planId },
    include: { items: { orderBy: [{ dayIndex: "asc" }, { startTime: "asc" }] } },
  });

  if (!plan) return { error: "not_found" as const };
  if (plan.userId !== userId) return { error: "forbidden" as const };

  // Fetch sessions for all items
  const sessionIds = plan.items.map((i) => i.sessionId);
  const sessions = await prisma.session.findMany({
    where: { sessionId: { in: sessionIds } },
  });
  const sessionMap = new Map(sessions.map((s) => [s.sessionId, s]));

  const base = getBaseUrl();

  // Pre-compute calendar title + description per session (avoids recomputing in the item loop)
  const calendarMeta = new Map<string, { title: string; description: string }>();
  for (const session of sessions) {
    calendarMeta.set(session.sessionId, {
      title: buildCalendarTitle({
        courseName: session.courseName,
        examName: session.examName,
        mode: session.mode as SessionMode,
        topicScope: session.topicScope,
      }),
      description: buildCalendarDescription({
        outcome: session.targetOutcome as Record<string, unknown> | null,
        sessionUrl: `${base}/s/${session.sessionId}`,
        breaks: session.breakProtocol as Record<string, unknown> | null,
      }),
    });
  }

  return {
    data: {
      plan_id: plan.planId,
      user_id: plan.userId,
      ics_download_url: `${base}/api/plans/${plan.planId}/ics`,
      course_name: plan.courseName,
      exam_name: plan.examName,
      exam_date: dateColumnKey(plan.examDate),
      timezone: plan.timezone,
      start_date: dateColumnKey(plan.startDate),
      end_date: dateColumnKey(plan.endDate),
      config: plan.config,
      created_at: plan.createdAt.toISOString(),
      items: plan.items.map((item) => {
        const session = sessionMap.get(item.sessionId);
        const cal = calendarMeta.get(item.sessionId);
        return {
          id: item.id,
          day_index: item.dayIndex,
          start_time: item.startTime.toISOString(),
          end_time: item.endTime.toISOString(),
          status: item.status,
          locked: item.locked,
          completed_at: item.completedAt?.toISOString() ?? null,
          missed_at: item.missedAt?.toISOString() ?? null,
          original_start_at: item.originalStartAt?.toISOString() ?? null,
          original_end_at: item.originalEndAt?.toISOString() ?? null,
          session_id: item.sessionId,
          session_url: `${base}/s/${item.sessionId}`,
          mode: session?.mode ?? "",
          topic_scope: session?.topicScope ?? "",
          planned_minutes: session?.plannedMinutes ?? 0,
          // Per-session block objectives (additive) so the UI can show a short
          // focus line instead of the whole plan's topic scope
          objectives: (session?.objectives ?? []) as { id: string; title: string }[],
          calendar: cal ?? null,
          gcal_link: cal
            ? buildGoogleCalendarLink({
                title: cal.title,
                startTime: item.startTime,
                endTime: item.endTime,
                description: cal.description,
              })
            : null,
        };
      }),
    },
  };
}

export async function generatePlanIcs(
  userId: string,
  planId: string,
): Promise<{ data: string; filename: string } | { error: "not_found" | "forbidden" }> {
  const result = await getPlan(userId, planId);
  if (!result.data) return { error: result.error ?? "not_found" };

  const events: IcsEvent[] = result.data.items.map((item) => ({
    uid: `${planId}-${item.session_id}-${item.start_time}`,
    summary: item.calendar?.title ?? `Study: ${item.topic_scope}`,
    description: item.calendar?.description ?? item.session_url,
    dtstart: new Date(item.start_time),
    dtend: new Date(item.end_time),
  }));

  const slug = `${result.data.course_name} ${result.data.exam_name}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return { data: generateIcs(events), filename: `${slug || "study-plan"}-plan.ics` };
}

// ---------------------------------------------------------------------------
// Plan screen reads and writes
// ---------------------------------------------------------------------------

/** Topic titles of a session: its objectives, else its comma-joined scope. */
function sessionTopics(objectives: unknown, topicScope: string): string[] {
  if (Array.isArray(objectives)) {
    const titles = objectives
      .map((o) =>
        typeof o === "string"
          ? o
          : o && typeof o === "object" && "title" in o
            ? String((o as { title: unknown }).title ?? "")
            : "",
      )
      .map((t) => t.trim())
      .filter(Boolean);
    if (titles.length > 0) return titles;
  }
  return topicScope
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Run state per session id, from the sessions' run statuses. */
async function runStatesFor(sessionIds: string[]): Promise<Map<string, RunState>> {
  if (sessionIds.length === 0) return new Map();
  const runs = await prisma.sessionRun.findMany({
    where: { sessionId: { in: sessionIds } },
    select: { sessionId: true, status: true },
  });
  const bySession = new Map<string, string[]>();
  for (const run of runs) {
    const list = bySession.get(run.sessionId) ?? [];
    list.push(run.status);
    bySession.set(run.sessionId, list);
  }
  return new Map([...bySession].map(([id, statuses]) => [id, runStateFromStatuses(statuses)]));
}

export interface PlanSummary {
  plan_id: string;
  course_name: string;
  exam_name: string;
  /** YYYY-MM-DD */
  exam_date: string;
  timezone: string;
  created_at: string;
  counts: PlanItemCounts;
  /** Whether the plan has events in Google Calendar. */
  in_google_calendar: boolean;
}

/**
 * The student's plans with session counts, newest first. Light: no session
 * payloads, one query for plans and items and one for run states.
 */
export async function listPlanSummaries(userId: string, now: Date = new Date()): Promise<PlanSummary[]> {
  const plans = await prisma.studyPlan.findMany({
    where: { userId },
    select: {
      planId: true,
      courseName: true,
      examName: true,
      examDate: true,
      timezone: true,
      createdAt: true,
      items: { select: { sessionId: true, status: true, endTime: true } },
      publications: { select: { status: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const runStates = await runStatesFor(plans.flatMap((p) => p.items.map((i) => i.sessionId)));

  return plans.map((plan) => ({
    plan_id: plan.planId,
    course_name: plan.courseName,
    exam_name: plan.examName,
    exam_date: dateColumnKey(plan.examDate),
    timezone: plan.timezone,
    created_at: plan.createdAt.toISOString(),
    counts: countPlanItems(
      plan.items.map((item) =>
        classifyPlanItem(item, runStates.get(item.sessionId) ?? "none", now, plan.timezone),
      ),
    ),
    in_google_calendar: plan.publications.some(
      (p) => p.status === "PUBLISHED" || p.status === "PARTIAL",
    ),
  }));
}

export interface PlanViewItem {
  id: string;
  session_id: string;
  start_time: string;
  end_time: string;
  /** Derived state: done, in_progress, missed, skipped, or scheduled. */
  state: PlanItemState;
  /** The stored status (SCHEDULED, RESCHEDULED, ...). */
  status: string;
  locked: boolean;
  mode: string;
  topics: string[];
  planned_minutes: number;
  /** Where the session was before a reschedule moved it, else null. */
  original_start_time: string | null;
}

export interface PlanView {
  plan_id: string;
  course_name: string;
  exam_name: string;
  exam_date: string;
  timezone: string;
  start_date: string;
  created_at: string;
  items: PlanViewItem[];
  counts: PlanItemCounts;
}

/** One plan for the Plan screen, items in time order with derived states. */
export async function getPlanView(
  userId: string,
  planId: string,
  now: Date = new Date(),
): Promise<{ data: PlanView } | { error: "not_found" | "forbidden" }> {
  const plan = await prisma.studyPlan.findUnique({
    where: { planId },
    include: { items: { orderBy: [{ startTime: "asc" }, { dayIndex: "asc" }] } },
  });
  if (!plan) return { error: "not_found" };
  if (plan.userId !== userId) return { error: "forbidden" };

  const sessionIds = plan.items.map((i) => i.sessionId);
  const [sessions, runStates] = await Promise.all([
    prisma.session.findMany({
      where: { sessionId: { in: sessionIds } },
      select: { sessionId: true, mode: true, topicScope: true, objectives: true, plannedMinutes: true },
    }),
    runStatesFor(sessionIds),
  ]);
  const sessionMap = new Map(sessions.map((s) => [s.sessionId, s]));

  const items: PlanViewItem[] = plan.items.map((item) => {
    const session = sessionMap.get(item.sessionId);
    return {
      id: item.id,
      session_id: item.sessionId,
      start_time: item.startTime.toISOString(),
      end_time: item.endTime.toISOString(),
      state: classifyPlanItem(item, runStates.get(item.sessionId) ?? "none", now, plan.timezone),
      status: item.status,
      locked: item.locked,
      mode: session?.mode ?? "",
      topics: session ? sessionTopics(session.objectives, session.topicScope) : [],
      planned_minutes: session?.plannedMinutes ?? 0,
      original_start_time: item.originalStartAt?.toISOString() ?? null,
    };
  });

  return {
    data: {
      plan_id: plan.planId,
      course_name: plan.courseName,
      exam_name: plan.examName,
      exam_date: dateColumnKey(plan.examDate),
      timezone: plan.timezone,
      start_date: dateColumnKey(plan.startDate),
      created_at: plan.createdAt.toISOString(),
      items,
      counts: countPlanItems(items.map((i) => i.state)),
    },
  };
}

export type DeletePlanResult =
  | { data: { plan_id: string; calendar_events_removed: number | null } }
  | { error: "not_found" }
  | {
      error: "calendar_failed";
      code: string;
      message: string;
      removed?: number;
      failed?: number;
    };

/**
 * Delete a plan and its items. Sessions, answers and progress stay. With
 * removeCalendarEvents, its Google Calendar events are removed first, and
 * the plan is kept when any of them can't be removed (so the student can
 * retry instead of losing track of them).
 */
export async function deletePlan(
  userId: string,
  planId: string,
  options: { removeCalendarEvents?: boolean } = {},
): Promise<DeletePlanResult> {
  const plan = await prisma.studyPlan.findUnique({
    where: { planId },
    select: { userId: true },
  });
  if (!plan || plan.userId !== userId) return { error: "not_found" };

  let calendarEventsRemoved: number | null = null;
  if (options.removeCalendarEvents) {
    const mappings = await prisma.planItemExternalEvent.count({
      where: { provider: "GOOGLE", planId },
    });
    if (mappings > 0) {
      const result = await unpublishPlanFromGoogle(userId, planId);
      if ("error" in result) {
        return {
          error: "calendar_failed",
          code: result.error,
          message: calendarErrorMessage(result.error),
        };
      }
      if (result.data.failed > 0) {
        const total = result.data.deleted + result.data.failed;
        return {
          error: "calendar_failed",
          code: "partial",
          message: `${result.data.failed} of ${total} Google Calendar events weren't removed, so the plan was kept. Retry.`,
          removed: result.data.deleted,
          failed: result.data.failed,
        };
      }
      calendarEventsRemoved = result.data.deleted;
    } else {
      calendarEventsRemoved = 0;
    }
  }

  // Delete in an order that respects the foreign keys
  await prisma.$transaction([
    prisma.planItemExternalEvent.deleteMany({ where: { planId } }),
    prisma.planCalendarPublication.deleteMany({ where: { planId } }),
    prisma.planReflowAudit.deleteMany({ where: { planId } }),
    prisma.studyPlanItem.deleteMany({ where: { planId } }),
    prisma.studyPlan.delete({ where: { planId } }),
  ]);

  logger.info("plan.deleted", {
    user_id: userId,
    plan_id: planId,
    calendar_events_removed: calendarEventsRemoved,
  });

  return { data: { plan_id: planId, calendar_events_removed: calendarEventsRemoved } };
}

export type ReplacedPlan =
  | { plan_id: string; deleted: true; calendar_events_removed: number | null }
  | { plan_id: string; deleted: false; message: string };

/**
 * Create a plan, then delete the plan it replaces (same course and exam).
 * The old plan is deleted only after the new one exists, so a failed create
 * never loses it; a failed delete leaves both and says so in `replaced`.
 */
export async function createPlanWithReplace(userId: string, input: unknown) {
  const parsed = createPlanSchema.parse(input);

  // Check the plan being replaced before doing any work. A missing plan (or
  // another account's) means there is nothing to replace.
  const target = parsed.replace_plan_id
    ? await prisma.studyPlan.findUnique({
        where: { planId: parsed.replace_plan_id },
        select: { planId: true, userId: true },
      })
    : null;
  const replaceId = target && target.userId === userId ? target.planId : null;

  const created = await createPlan(userId, input);
  let replaced: ReplacedPlan | null = null;

  if (replaceId) {
    try {
      const deletion = await deletePlan(userId, replaceId, {
        removeCalendarEvents: parsed.remove_replaced_calendar_events,
      });
      replaced =
        "data" in deletion
          ? {
              plan_id: replaceId,
              deleted: true,
              calendar_events_removed: deletion.data.calendar_events_removed,
            }
          : {
              plan_id: replaceId,
              deleted: false,
              message:
                deletion.error === "calendar_failed"
                  ? deletion.message
                  : "The old plan wasn't deleted.",
            };
    } catch (err) {
      logger.error("plan.replace_delete_failed", {
        user_id: userId,
        plan_id: replaceId,
        error: String(err),
      });
      replaced = { plan_id: replaceId, deleted: false, message: "The old plan wasn't deleted." };
    }
  }

  return { ...created, replaced };
}
