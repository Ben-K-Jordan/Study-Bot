/**
 * Publish / unpublish plan events to Google Calendar.
 *
 * - Idempotent: re-publishing updates existing events instead of duplicating.
 * - Uses extendedProperties.private for plan/session ID mapping.
 * - Stores googleEventId on StudyPlanItem for future updates.
 * - Concurrency-limited to avoid rate-limit spikes.
 */
import { prisma } from "@/lib/db";
import { getGoogleClient, type CalendarEventInput } from "@/lib/google/calendar-client";
import { buildCalendarTitle, buildCalendarDescription } from "@/lib/calendar";
import { type SessionMode } from "@/lib/validation";
import { logger } from "@/lib/logger";

function getBaseUrl(): string {
  return process.env.BASE_URL || "http://localhost:3000";
}

const MAX_CONCURRENT = 5;

async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = [];
  let i = 0;

  async function next(): Promise<void> {
    const idx = i++;
    if (idx >= tasks.length) return;
    results[idx] = await tasks[idx]();
    await next();
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => next());
  await Promise.all(workers);
  return results;
}

export async function publishPlanToGoogle(userId: string, planId: string) {
  // Verify plan exists and belongs to user
  const plan = await prisma.studyPlan.findUnique({
    where: { planId },
    include: { items: { orderBy: [{ dayIndex: "asc" }, { startTime: "asc" }] } },
  });

  if (!plan) return { error: "not_found" as const };
  if (plan.userId !== userId) return { error: "forbidden" as const };

  // Verify Google integration exists
  const integration = await prisma.googleIntegration.findUnique({
    where: { userId },
  });
  if (!integration) return { error: "google_not_connected" as const };

  const calendarId = integration.calendarIdSelected || "primary";
  const client = getGoogleClient(userId);

  // Fetch sessions for event titles/descriptions
  const sessionIds = plan.items.map((i) => i.sessionId);
  const sessions = await prisma.session.findMany({
    where: { sessionId: { in: sessionIds } },
  });
  const sessionMap = new Map(sessions.map((s) => [s.sessionId, s]));

  const baseUrl = getBaseUrl();
  let created = 0;
  let updated = 0;

  const tasks = plan.items.map((item) => async () => {
    const session = sessionMap.get(item.sessionId);
    if (!session) return;

    const title = buildCalendarTitle({
      courseName: session.courseName,
      examName: session.examName,
      mode: session.mode as SessionMode,
      topicScope: session.topicScope,
    });

    const description = buildCalendarDescription({
      outcome: session.targetOutcome as Record<string, unknown> | null,
      sessionUrl: `${baseUrl}/s/${item.sessionId}`,
      breaks: session.breakProtocol as Record<string, unknown> | null,
    });

    const eventInput: CalendarEventInput = {
      calendarId,
      summary: title,
      description,
      start: item.startTime.toISOString(),
      end: item.endTime.toISOString(),
      extendedProperties: {
        studybot_plan_id: plan.planId,
        studybot_plan_item_id: item.id,
        studybot_session_id: item.sessionId,
      },
    };

    if (item.googleEventId) {
      // Update existing event
      await client.updateEvent(calendarId, item.googleEventId, eventInput);
      updated++;
    } else {
      // Create new event
      const event = await client.createEvent(eventInput);
      await prisma.studyPlanItem.update({
        where: { id: item.id },
        data: { googleEventId: event.id, googleCalendarId: calendarId },
      });
      created++;
    }
  });

  await runWithConcurrency(tasks, MAX_CONCURRENT);

  logger.info("plan.published", {
    user_id: userId,
    plan_id: planId,
    created,
    updated,
    total: plan.items.length,
  });

  return {
    data: {
      plan_id: planId,
      published: true,
      events_created: created,
      events_updated: updated,
      total_items: plan.items.length,
    },
  };
}

export async function unpublishPlanFromGoogle(userId: string, planId: string) {
  const plan = await prisma.studyPlan.findUnique({
    where: { planId },
    include: { items: true },
  });

  if (!plan) return { error: "not_found" as const };
  if (plan.userId !== userId) return { error: "forbidden" as const };

  const integration = await prisma.googleIntegration.findUnique({
    where: { userId },
  });
  if (!integration) return { error: "google_not_connected" as const };

  const client = getGoogleClient(userId);
  let deleted = 0;

  const tasks = plan.items
    .filter((item) => item.googleEventId && item.googleCalendarId)
    .map((item) => async () => {
      try {
        await client.deleteEvent(item.googleCalendarId!, item.googleEventId!);
      } catch {
        // Event may already be deleted — ignore
      }
      await prisma.studyPlanItem.update({
        where: { id: item.id },
        data: { googleEventId: null, googleCalendarId: null },
      });
      deleted++;
    });

  await runWithConcurrency(tasks, MAX_CONCURRENT);

  logger.info("plan.unpublished", {
    user_id: userId,
    plan_id: planId,
    deleted,
  });

  return {
    data: {
      plan_id: planId,
      published: false,
      events_deleted: deleted,
    },
  };
}
