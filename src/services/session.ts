import { prisma } from "@/lib/db";
import { generateSessionId } from "@/lib/session-id";
import { buildCalendarTitle, buildCalendarDescription } from "@/lib/calendar";
import {
  createSessionSchema,
  CreateSessionInput,
  SessionMode,
} from "@/lib/validation";

function getBaseUrl(): string {
  return process.env.BASE_URL || "http://localhost:3000";
}

function defaultPlanSteps(minutes: number): string[] {
  if (minutes <= 30) {
    return [
      `0–5 min: Setup & review objectives`,
      `5–${minutes - 5} min: Active practice`,
      `${minutes - 5}–${minutes} min: Self-assessment & log errors`,
    ];
  }
  const workEnd = Math.min(minutes - 15, 55);
  return [
    `0–5 min: Setup & review objectives`,
    `5–${workEnd} min: Active practice (closed-book)`,
    `${workEnd}–${workEnd + 10} min: Review errors & create variants`,
    `${workEnd + 10}–${minutes} min: Self-assessment & wrap-up`,
  ];
}

function defaultRules(closedBook?: boolean): string[] {
  const rules = ["Phone on airplane mode or in another room"];
  if (closedBook) {
    rules.unshift("Closed-book first pass — no notes until self-check");
  }
  rules.push("If stuck > 3 min, write down the blocker and move on");
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
