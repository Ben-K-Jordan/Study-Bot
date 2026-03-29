import { prisma } from "@/lib/db";
import { generateSessionId } from "@/lib/session-id";
import { buildCalendarTitle, buildCalendarDescription } from "@/lib/calendar";
import { createPlanSchema, SessionMode } from "@/lib/validation";
import { generatePlan, PlanBlock } from "@/lib/plan-generator";
import { generateIcs, IcsEvent } from "@/lib/ics";
import { logger } from "@/lib/logger";

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

  const blocks = generatePlan({
    objectives: parsed.objectives,
    dailyCap: parsed.daily_study_cap_minutes,
    breakProtocol: parsed.break_protocol_default,
    availability: parsed.availability,
  });

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

  // Transactional: create all sessions + plan + items atomically
  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      await tx.session.create({
        data: {
          sessionId: item.sessionId,
          userId,
          courseId: parsed.course_id ?? "",
          courseName: parsed.course_name,
          examId: parsed.exam_id ?? "",
          examName: parsed.exam_name,
          mode: item.block.mode,
          topicScope: item.block.topicScope,
          objectives: item.block.objectives as unknown as undefined,
          targetOutcome: item.block.targetOutcome as unknown as undefined,
          breakProtocol: { type: parsed.break_protocol_default, cycles: 1 } as unknown as undefined,
          plannedMinutes: item.block.plannedMinutes,
        },
      });
    }

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

  return {
    plan_id: planId,
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

  return {
    data: {
      plan_id: plan.planId,
      user_id: plan.userId,
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
        return {
          day_index: item.dayIndex,
          start_time: item.startTime.toISOString(),
          end_time: item.endTime.toISOString(),
          session_id: item.sessionId,
          session_url: `${getBaseUrl()}/s/${item.sessionId}`,
          mode: session?.mode ?? "",
          topic_scope: session?.topicScope ?? "",
          planned_minutes: session?.plannedMinutes ?? 0,
          calendar: session
            ? {
                title: buildCalendarTitle({
                  courseName: session.courseName,
                  examName: session.examName,
                  mode: session.mode as SessionMode,
                  topicScope: session.topicScope,
                }),
                description: buildCalendarDescription({
                  outcome: session.targetOutcome as Record<string, unknown> | null,
                  sessionUrl: `${getBaseUrl()}/s/${item.sessionId}`,
                  breaks: session.breakProtocol as Record<string, unknown> | null,
                }),
              }
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
