import { prisma } from "@/lib/db";
import { generateSessionId } from "@/lib/session-id";
import { buildCalendarTitle, buildCalendarDescription } from "@/lib/calendar";
import { createPlanSchema, SessionMode } from "@/lib/validation";
import { generatePlan, PlanBlock } from "@/lib/plan-generator";
import { generatePlanWithResearch, StudyPreferences } from "@/lib/research-plan-generator";
import { generateIcs, IcsEvent } from "@/lib/ics";
import { logger } from "@/lib/logger";
import { getGoogleClient } from "@/lib/google/calendar-client";
import { computeFreeSlots, fitBlocksIntoSlots, type TimeInterval } from "@/lib/google/free-slots";
import { buildGoogleCalendarLink } from "@/lib/gcal-link";
import { createProvider } from "@/lib/ai/provider-factory";
import type { GatewayContext } from "@/lib/ai/gateway";
import { buildContentAwarePlanInput, extractObjectivesFromContent } from "@/services/content-plan";
import {
  applyPreExamTaper,
  adjustDurationByMode,
  fitBlocksScored,
  estimateBedtime,
  type CalendarEvent as IntelEvent,
  type Chronotype,
  type SessionMode as IntelMode,
} from "@/lib/schedule-intelligence";

function getBaseUrl(): string {
  return process.env.BASE_URL || "http://localhost:3000";
}

function computeStartTime(
  startDate: Date,
  dayIndex: number,
  timeStr: string,
): Date {
  const d = new Date(startDate);
  d.setDate(d.getDate() + dayIndex);
  const [h, m] = timeStr.split(":").map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

export async function createPlan(userId: string, input: unknown) {
  const parsed = createPlanSchema.parse(input);

  const planId = generateSessionId();
  const startDate = new Date();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 6);

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

  // If no manual objectives, extract them from uploaded content via AI
  let objectives = parsed.objectives;
  if (objectives.length === 0 && parsed.document_ids.length > 0) {
    try {
      const suggested = await extractObjectivesFromContent(userId, parsed.course_name, parsed.exam_name);
      objectives = suggested.map((s) => s.title);
      if (objectives.length < 3) {
        // Pad with generic fallbacks so the plan generator has enough to work with
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
    }
  }

  // Check if the user has uploaded content for this course and enrich the plan input
  let contentContext: string | undefined;
  try {
    const contentMeta = await buildContentAwarePlanInput(userId, parsed.course_name, parsed.exam_name);
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
  const examDateObj = new Date(parsed.exam_date);
  let blocks = applyPreExamTaper(planResult.blocks, examDateObj, startDate);

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
      // Also check busy calendars for fatigue/exercise detection
      const busyCalendarIds: string[] = integration.busyCalendarIds
        ? integration.busyCalendarIds.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
      const allCalendarIds = [...new Set([calendarId, ...busyCalendarIds])];

      // Query 7-day window
      const timeMin = startDate.toISOString();
      const windowEnd = new Date(startDate);
      windowEnd.setDate(windowEnd.getDate() + 7);
      const timeMax = windowEnd.toISOString();

      try {
        // Fetch busy intervals AND actual events in parallel
        const [busy, ...eventLists] = await Promise.all([
          client.freebusyQuery({ timeMin, timeMax, calendarIds: allCalendarIds }),
          ...allCalendarIds.map((cid) =>
            client.listEvents({
              calendarId: cid,
              timeMin,
              timeMax,
              singleEvents: true,
              maxResults: 250,
            }).catch(() => []),
          ),
        ]);

        const busyIntervals: TimeInterval[] = busy.map((b) => ({
          start: new Date(b.start).getTime(),
          end: new Date(b.end).getTime(),
        }));

        // Flatten all events into IntelEvent format, grouped by day
        const allEvents: IntelEvent[] = eventLists.flat().map((e) => ({
          summary: e.summary || "",
          start: new Date(e.start).getTime(),
          end: new Date(e.end).getTime(),
        }));

        // Estimate bedtime from event patterns
        inferredBedtime = estimateBedtime(allEvents);

        // Group events by day index
        googleEventsByDay = new Map();
        for (const event of allEvents) {
          const eventDate = new Date(event.start);
          const dayIdx = Math.floor((eventDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
          if (dayIdx < 0 || dayIdx >= 7) continue;
          if (!googleEventsByDay.has(dayIdx)) googleEventsByDay.set(dayIdx, []);
          googleEventsByDay.get(dayIdx)!.push(event);
        }

        // Compute free slots per day
        googleFreeSlotsByDay = new Map();
        for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
          const dayAvail = parsed.availability[dayIdx];
          const dayStart = computeStartTime(startDate, dayIdx, dayAvail.start);
          const dayEnd = computeStartTime(startDate, dayIdx, dayAvail.end);
          const freeSlots = computeFreeSlots(dayStart.getTime(), dayEnd.getTime(), busyIntervals);
          googleFreeSlotsByDay.set(dayIdx, freeSlots);
        }

        logger.info("plan.google_availability", {
          user_id: userId,
          busy_count: busy.length,
          events_fetched: allEvents.length,
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
          })
        : fitBlocksIntoSlots(durations, freeSlots);

      for (let i = 0; i < dayBlocks.length; i++) {
        const block = dayBlocks[i];
        const slot = scheduled[i];
        if (!slot) continue; // Block doesn't fit — skip it

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
      const baseStart = computeStartTime(startDate, block.dayIndex, dayAvail.start);
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
        examDate: new Date(parsed.exam_date),
        timezone: parsed.timezone,
        startDate,
        endDate,
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

  const baseUrl = getBaseUrl();
  const feedUrl = `${baseUrl}/api/plans/${planId}/feed`;
  const webcalUrl = feedUrl.replace(/^https?:\/\//, "webcal://");

  return {
    plan_id: planId,
    ai_generated: planResult.aiGenerated,
    reasoning: planResult.reasoning ?? null,
    ics_download_url: `${baseUrl}/api/plans/${planId}/ics`,
    feed_url: feedUrl,
    webcal_url: webcalUrl,
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
  const feedUrl = `${base}/api/plans/${plan.planId}/feed`;

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
      feed_url: feedUrl,
      webcal_url: feedUrl.replace(/^https?:\/\//, "webcal://"),
      course_name: plan.courseName,
      exam_name: plan.examName,
      exam_date: plan.examDate.toISOString().split("T")[0],
      timezone: plan.timezone,
      start_date: plan.startDate.toISOString().split("T")[0],
      end_date: plan.endDate.toISOString().split("T")[0],
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

export async function generatePlanIcs(userId: string, planId: string) {
  const result = await getPlan(userId, planId);
  if ("error" in result) return result;

  const events: IcsEvent[] = result.data.items.map((item) => ({
    uid: `${planId}-${item.session_id}-${item.start_time}`,
    summary: item.calendar?.title ?? `Study: ${item.topic_scope}`,
    description: item.calendar?.description ?? item.session_url,
    dtstart: new Date(item.start_time),
    dtend: new Date(item.end_time),
  }));

  return { data: generateIcs(events) };
}
