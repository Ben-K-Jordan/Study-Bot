/**
 * Publish / unpublish plan events to Google Calendar.
 *
 * Orchestration flow (see spec for full details):
 *   1) Load plan + items + sessions (no N+1)
 *   2) Load publication + external event mappings
 *   3) For each item: build payload → hash → skip/update/create
 *   4) Write publication status
 *   5) Return detailed per-item results
 *
 * Idempotent: re-publishing updates existing events, skips unchanged.
 * Robust: handles 404 (manual deletion), rate limits, partial failure.
 */
import { prisma } from "@/lib/db";
import { getGoogleClient, GoogleApiError, GoogleReconnectError, type CalendarEventInput } from "@/lib/google/calendar-client";
import { buildEventPayload } from "@/lib/google/event-builder";
import { logger } from "@/lib/logger";

const CONCURRENCY_LIMIT = parseInt(process.env.GOOGLE_CALENDAR_SYNC_CONCURRENCY || "5", 10);

function getBaseUrl(): string {
  return process.env.BASE_URL || "http://localhost:3000";
}

// ---- Types ----

export type ItemAction = "CREATED" | "UPDATED" | "UNCHANGED" | "FAILED";

export interface PublishItemResult {
  plan_item_id: string;
  session_id: string;
  action: ItemAction;
  event_id?: string;
  html_link?: string;
  error?: { code: string; message: string };
}

export interface PublishResult {
  plan_id: string;
  provider: "GOOGLE";
  calendar_id: string;
  status: "OK" | "PARTIAL" | "FAILED";
  published_at: string;
  duration_ms: number;
  summary: {
    created: number;
    updated: number;
    unchanged: number;
    failed: number;
    total: number;
  };
  item_results: PublishItemResult[];
  warnings?: string[];
}

export interface UnpublishResult {
  plan_id: string;
  provider: "GOOGLE";
  calendar_id: string;
  status: "UNPUBLISHED" | "PARTIAL";
  duration_ms: number;
  deleted: number;
  failed: number;
  items_failed?: { plan_item_id: string; event_id?: string; error: { code: string; message: string } }[];
}

export interface PublishStatusResult {
  publication: {
    status: string;
    calendar_id: string;
    published_at: string | null;
    last_synced_at: string | null;
    last_error: string | null;
  } | null;
  items: {
    plan_item_id: string;
    event_id: string;
    html_link: string | null;
    last_synced_at: string;
    last_synced_hash: string;
  }[];
}

// ---- Concurrency limiter ----

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

// ---- Zod schemas for request validation ----

import { z } from "zod/v4";

export const publishRequestSchema = z.object({
  calendar_id: z.string().optional(),
  force: z.boolean().optional().default(false),
  dry_run: z.boolean().optional().default(false),
});

export const unpublishRequestSchema = z.object({
  calendar_id: z.string().optional(),
  only_future: z.boolean().optional().default(false),
});

// ---- Publish ----

export async function publishPlanToGoogle(
  userId: string,
  planId: string,
  options: { calendarId?: string; force?: boolean; dryRun?: boolean } = {},
): Promise<{ data: PublishResult } | { error: string; status?: number; current_calendar_id?: string }> {
  const startMs = Date.now();

  // 1) Load plan + items + sessions (no N+1)
  const plan = await prisma.studyPlan.findUnique({
    where: { planId },
    include: {
      items: { orderBy: [{ dayIndex: "asc" }, { startTime: "asc" }] },
    },
  });

  if (!plan) return { error: "not_found", status: 404 };
  if (plan.userId !== userId) return { error: "forbidden", status: 403 };

  // Verify Google integration
  const integration = await prisma.googleIntegration.findUnique({
    where: { userId },
  });
  if (!integration) return { error: "GOOGLE_NOT_CONNECTED", status: 409 };

  if (integration.status === "DISCONNECTED") {
    return { error: "GOOGLE_RECONNECT_REQUIRED", status: 409 };
  }

  const calendarId = options.calendarId || integration.calendarIdSelected || "primary";

  // 2) Load existing publication + mappings
  const existingPub = await prisma.planCalendarPublication.findUnique({
    where: { provider_planId: { provider: "GOOGLE", planId } },
  });

  // Check calendar conflict
  if (existingPub && existingPub.calendarId !== calendarId && existingPub.status !== "UNPUBLISHED") {
    if (!options.force) {
      return {
        error: "ALREADY_PUBLISHED_DIFFERENT_CALENDAR",
        status: 409,
        current_calendar_id: existingPub.calendarId,
      };
    }
    // Force: unpublish from old calendar first
    await unpublishPlanFromGoogle(userId, planId, { calendarId: existingPub.calendarId });
  }

  const existingMappings = await prisma.planItemExternalEvent.findMany({
    where: { provider: "GOOGLE", planId },
  });
  const mappingByItemId = new Map(existingMappings.map((m) => [m.planItemId, m]));

  // Load sessions for all items
  const sessionIds = plan.items.map((i) => i.sessionId);
  const sessions = await prisma.session.findMany({
    where: { sessionId: { in: sessionIds } },
  });
  const sessionMap = new Map(sessions.map((s) => [s.sessionId, s]));

  const client = getGoogleClient(userId);
  const baseUrl = getBaseUrl();
  const warnings: string[] = [];

  logger.info("google.publish.started", {
    user_id: userId,
    plan_id: planId,
    calendar_id: calendarId,
    item_count: plan.items.length,
    dry_run: options.dryRun || false,
  });

  // 3) Process each item
  const itemResults: PublishItemResult[] = [];

  const tasks = plan.items.map((item) => async () => {
    const session = sessionMap.get(item.sessionId);
    if (!session) {
      itemResults.push({
        plan_item_id: item.id,
        session_id: item.sessionId,
        action: "FAILED",
        error: { code: "SESSION_NOT_FOUND", message: "Session record missing" },
      });
      return;
    }

    const { input: eventInput, hash } = buildEventPayload({
      planId,
      planItemId: item.id,
      sessionId: item.sessionId,
      userId,
      calendarId,
      courseName: session.courseName,
      examName: session.examName,
      mode: session.mode,
      topicScope: session.topicScope,
      plannedMinutes: session.plannedMinutes,
      startTime: item.startTime.toISOString(),
      endTime: item.endTime.toISOString(),
      timezone: plan.timezone,
      objectives: session.objectives as string[] | null,
      targetOutcome: session.targetOutcome as Record<string, unknown> | null,
      breakProtocol: session.breakProtocol as Record<string, unknown> | null,
      baseUrl,
    });

    const mapping = mappingByItemId.get(item.id);

    try {
      if (mapping && mapping.lastSyncedHash === hash) {
        // UNCHANGED — skip API call
        itemResults.push({
          plan_item_id: item.id,
          session_id: item.sessionId,
          action: "UNCHANGED",
          event_id: mapping.eventId,
          html_link: mapping.htmlLink || undefined,
        });
        logger.info("google.publish.item", { plan_item_id: item.id, action: "UNCHANGED" });
        return;
      }

      if (options.dryRun) {
        itemResults.push({
          plan_item_id: item.id,
          session_id: item.sessionId,
          action: mapping ? "UPDATED" : "CREATED",
        });
        return;
      }

      if (mapping) {
        // Try UPDATE existing event
        try {
          const event = await client.updateEvent(calendarId, mapping.eventId, eventInput);
          await prisma.planItemExternalEvent.update({
            where: { id: mapping.id },
            data: {
              calendarId,
              eventId: event.id,
              htmlLink: event.htmlLink || null,
              etag: event.etag || null,
              remoteUpdatedAt: event.updated ? new Date(event.updated) : null,
              lastSyncedHash: hash,
              lastSyncedAt: new Date(),
            },
          });
          itemResults.push({
            plan_item_id: item.id,
            session_id: item.sessionId,
            action: "UPDATED",
            event_id: event.id,
            html_link: event.htmlLink,
          });
          logger.info("google.publish.item", { plan_item_id: item.id, action: "UPDATED" });
          return;
        } catch (err) {
          if (err instanceof GoogleApiError && err.status === 404) {
            // Event was manually deleted — fall through to create
            warnings.push(`Event ${mapping.eventId} was deleted externally; recreating.`);
          } else {
            throw err;
          }
        }
      }

      // No mapping, or mapping pointed to deleted event — try reconciliation via list
      if (!mapping) {
        try {
          const found = await client.listEvents({
            calendarId,
            privateExtendedProperty: `sb_item=${item.id}`,
            maxResults: 1,
          });
          if (found.length > 0) {
            // Reconcile: update existing event + create mapping
            const event = await client.updateEvent(calendarId, found[0].id, eventInput);
            await prisma.planItemExternalEvent.create({
              data: {
                userId,
                planId,
                planItemId: item.id,
                provider: "GOOGLE",
                calendarId,
                eventId: event.id,
                htmlLink: event.htmlLink || null,
                etag: event.etag || null,
                remoteUpdatedAt: event.updated ? new Date(event.updated) : null,
                lastSyncedHash: hash,
                lastSyncedAt: new Date(),
              },
            });
            itemResults.push({
              plan_item_id: item.id,
              session_id: item.sessionId,
              action: "UPDATED",
              event_id: event.id,
              html_link: event.htmlLink,
            });
            logger.info("google.publish.item", { plan_item_id: item.id, action: "UPDATED", reconciled: true });
            return;
          }
        } catch {
          // Reconciliation failed — fall through to create
        }
      }

      // CREATE new event
      const event = await client.createEvent(eventInput);

      // Upsert mapping (delete stale if mapping existed for deleted event)
      if (mapping) {
        await prisma.planItemExternalEvent.update({
          where: { id: mapping.id },
          data: {
            calendarId,
            eventId: event.id,
            htmlLink: event.htmlLink || null,
            etag: event.etag || null,
            remoteUpdatedAt: event.updated ? new Date(event.updated) : null,
            lastSyncedHash: hash,
            lastSyncedAt: new Date(),
          },
        });
      } else {
        await prisma.planItemExternalEvent.create({
          data: {
            userId,
            planId,
            planItemId: item.id,
            provider: "GOOGLE",
            calendarId,
            eventId: event.id,
            htmlLink: event.htmlLink || null,
            etag: event.etag || null,
            remoteUpdatedAt: event.updated ? new Date(event.updated) : null,
            lastSyncedHash: hash,
            lastSyncedAt: new Date(),
          },
        });
      }

      itemResults.push({
        plan_item_id: item.id,
        session_id: item.sessionId,
        action: "CREATED",
        event_id: event.id,
        html_link: event.htmlLink,
      });
      logger.info("plan.publish.item", { plan_item_id: item.id, action: "CREATED" });
    } catch (err) {
      // Reconnect errors should abort the entire publish
      if (err instanceof GoogleReconnectError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      const code = err instanceof GoogleApiError ? `GOOGLE_${err.status}` : "UNKNOWN";
      itemResults.push({
        plan_item_id: item.id,
        session_id: item.sessionId,
        action: "FAILED",
        error: { code, message },
      });
      logger.error("google.publish.item", {
        plan_item_id: item.id,
        action: "FAILED",
        error: message,
      });
    }
  });

  try {
    await runWithConcurrency(tasks, CONCURRENCY_LIMIT);
  } catch (err) {
    if (err instanceof GoogleReconnectError) {
      return { error: "GOOGLE_RECONNECT_REQUIRED", status: 409 };
    }
    throw err;
  }

  // 4) Compute status + write publication row
  const counts = {
    created: itemResults.filter((r) => r.action === "CREATED").length,
    updated: itemResults.filter((r) => r.action === "UPDATED").length,
    unchanged: itemResults.filter((r) => r.action === "UNCHANGED").length,
    failed: itemResults.filter((r) => r.action === "FAILED").length,
  };

  const status: PublishResult["status"] =
    counts.failed === 0 ? "OK"
    : counts.created + counts.updated + counts.unchanged > 0 ? "PARTIAL"
    : "FAILED";

  const now = new Date();

  // Map status for DB (DB uses PUBLISHED, API returns OK)
  const dbStatus = status === "OK" ? "PUBLISHED" : status;

  if (!options.dryRun) {
    const lastError = counts.failed > 0
      ? itemResults.find((r) => r.action === "FAILED")?.error?.message || null
      : null;

    await prisma.planCalendarPublication.upsert({
      where: { provider_planId: { provider: "GOOGLE", planId } },
      create: {
        userId,
        planId,
        provider: "GOOGLE",
        calendarId,
        status: dbStatus,
        publishedAt: now,
        lastSyncedAt: now,
        lastError,
      },
      update: {
        calendarId,
        status: dbStatus,
        publishedAt: dbStatus === "PUBLISHED" || dbStatus === "PARTIAL" ? now : undefined,
        lastSyncedAt: now,
        lastError,
      },
    });
  }

  const durationMs = Date.now() - startMs;
  logger.info("google.publish.completed", {
    user_id: userId,
    plan_id: planId,
    calendar_id: calendarId,
    status,
    ...counts,
    duration_ms: durationMs,
    dry_run: options.dryRun || false,
  });

  return {
    data: {
      plan_id: planId,
      provider: "GOOGLE",
      calendar_id: calendarId,
      status,
      published_at: now.toISOString(),
      duration_ms: durationMs,
      summary: { ...counts, total: itemResults.length },
      item_results: itemResults,
      warnings: warnings.length > 0 ? warnings : undefined,
    },
  };
}

// ---- Unpublish ----

export async function unpublishPlanFromGoogle(
  userId: string,
  planId: string,
  options: { calendarId?: string; onlyFuture?: boolean } = {},
): Promise<{ data: UnpublishResult } | { error: string; status?: number }> {
  const plan = await prisma.studyPlan.findUnique({
    where: { planId },
  });

  if (!plan) return { error: "not_found", status: 404 };
  if (plan.userId !== userId) return { error: "forbidden", status: 403 };

  const integration = await prisma.googleIntegration.findUnique({
    where: { userId },
  });
  if (!integration) return { error: "GOOGLE_NOT_CONNECTED", status: 409 };
  if (integration.status === "DISCONNECTED") {
    return { error: "GOOGLE_RECONNECT_REQUIRED", status: 409 };
  }

  const publication = await prisma.planCalendarPublication.findUnique({
    where: { provider_planId: { provider: "GOOGLE", planId } },
  });

  const calendarId = options.calendarId || publication?.calendarId || integration.calendarIdSelected || "primary";

  const startMs = Date.now();

  let mappings = await prisma.planItemExternalEvent.findMany({
    where: { provider: "GOOGLE", planId },
    include: { planItem: true },
  });

  // Filter to future events only if requested
  if (options.onlyFuture) {
    const now = new Date();
    mappings = mappings.filter((m) => m.planItem.startTime >= now);
  }

  const client = getGoogleClient(userId);
  let deleted = 0;
  const failedItems: UnpublishResult["items_failed"] = [];

  logger.info("google.unpublish.started", {
    user_id: userId,
    plan_id: planId,
    calendar_id: calendarId,
    mapping_count: mappings.length,
  });

  const tasks = mappings.map((mapping) => async () => {
    try {
      await client.deleteEvent(mapping.calendarId, mapping.eventId);
    } catch (err) {
      if (err instanceof GoogleApiError && (err.status === 404 || err.status === 410)) {
        // Already deleted — treat as success
      } else {
        const message = err instanceof Error ? err.message : String(err);
        failedItems!.push({
          plan_item_id: mapping.planItemId,
          event_id: mapping.eventId,
          error: { code: "DELETE_FAILED", message },
        });
        return; // Don't delete mapping on failure
      }
    }

    await prisma.planItemExternalEvent.delete({ where: { id: mapping.id } });
    deleted++;
  });

  await runWithConcurrency(tasks, CONCURRENCY_LIMIT);

  // Update publication status
  const status: UnpublishResult["status"] = failedItems!.length === 0 ? "UNPUBLISHED" : "PARTIAL";

  if (publication) {
    await prisma.planCalendarPublication.update({
      where: { id: publication.id },
      data: {
        status,
        lastSyncedAt: new Date(),
        lastError: failedItems!.length > 0 ? failedItems![0].error.message : null,
      },
    });
  }

  const durationMs = Date.now() - startMs;
  logger.info("google.unpublish.completed", {
    user_id: userId,
    plan_id: planId,
    deleted,
    failed: failedItems!.length,
    duration_ms: durationMs,
  });

  return {
    data: {
      plan_id: planId,
      provider: "GOOGLE",
      calendar_id: calendarId,
      status,
      duration_ms: durationMs,
      deleted,
      failed: failedItems!.length,
      items_failed: failedItems!.length > 0 ? failedItems : undefined,
    },
  };
}

// ---- Get Publish Status ----

export async function getPublishStatus(
  userId: string,
  planId: string,
): Promise<{ data: PublishStatusResult } | { error: string; status?: number }> {
  const plan = await prisma.studyPlan.findUnique({
    where: { planId },
  });

  if (!plan) return { error: "not_found", status: 404 };
  if (plan.userId !== userId) return { error: "forbidden", status: 403 };

  const publication = await prisma.planCalendarPublication.findUnique({
    where: { provider_planId: { provider: "GOOGLE", planId } },
  });

  const mappings = await prisma.planItemExternalEvent.findMany({
    where: { provider: "GOOGLE", planId },
    orderBy: { createdAt: "asc" },
  });

  return {
    data: {
      publication: publication
        ? {
            status: publication.status,
            calendar_id: publication.calendarId,
            published_at: publication.publishedAt?.toISOString() || null,
            last_synced_at: publication.lastSyncedAt?.toISOString() || null,
            last_error: publication.lastError,
          }
        : null,
      items: mappings.map((m) => ({
        plan_item_id: m.planItemId,
        event_id: m.eventId,
        html_link: m.htmlLink,
        last_synced_at: m.lastSyncedAt.toISOString(),
        last_synced_hash: m.lastSyncedHash,
      })),
    },
  };
}
