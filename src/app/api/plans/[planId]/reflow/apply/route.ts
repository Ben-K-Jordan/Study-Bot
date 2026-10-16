import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId } from "@/lib/auth";
import { unauthorized } from "@/lib/http";
import { generalLimiter, tooManyRequests } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { calendarErrorMessage, publishPlanToGoogle } from "@/services/publish";
import { parseReflowBody, prepareReflow, reflowRequestSchema, summarize } from "../shared";

const applySchema = reflowRequestSchema.extend({
  /**
   * Whether to update the plan's events in Google Calendar after moving
   * sessions. Nothing in Google Calendar changes unless this is REPUBLISH,
   * and only for a plan that is already in Google Calendar.
   */
  calendar_update: z.enum(["NONE", "REPUBLISH"]).optional(),
  // Legacy compat: republish: true means calendar_update: "REPUBLISH"
  republish: z.boolean().optional(),
});

/**
 * POST /api/plans/{planId}/reflow/apply
 *
 * Moves sessions as the preview showed: moved items become RESCHEDULED
 * (keeping their original times), sessions that don't fit become SKIPPED.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ planId: string }> },
) {
  const userId = await getUserId(req);
  if (!userId) {
    return unauthorized();
  }

  // Each preview and apply reads Google Calendar free/busy
  const rl = generalLimiter.check(userId);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterMs);

  const { planId } = await params;

  const parsed = await parseReflowBody(req, applySchema);
  if ("response" in parsed) return parsed.response;
  const body = parsed.body;

  const shouldRepublish = body.calendar_update === "REPUBLISH" || body.republish === true;

  const prepared = await prepareReflow(userId, planId, body, "reflow.apply");
  if ("response" in prepared) return prepared.response;
  const { plan, reflowItems, result, now, busyIntervals } = prepared;

  const movedChanges = result.changes.filter((c) => c.action === "MOVED");
  const droppedChanges = result.changes.filter((c) => c.action === "DROPPED");

  if (movedChanges.length === 0 && droppedChanges.length === 0) {
    return NextResponse.json({
      plan_id: planId,
      applied: false,
      message: "Nothing to reschedule.",
      changes: result.changes,
      warnings: result.warnings,
      summary: summarize(result, plan.items.length),
      calendar: null,
    });
  }

  let auditId: string | null = null;
  const itemById = new Map(plan.items.map((item) => [item.id, item]));

  await prisma.$transaction(async (tx) => {
    // Apply MOVED items
    for (const change of movedChanges) {
      const item = itemById.get(change.itemId)!;
      await tx.studyPlanItem.update({
        where: { id: change.itemId },
        data: {
          dayIndex: change.after!.dayIndex,
          startTime: new Date(change.after!.startTime),
          endTime: new Date(change.after!.endTime),
          status: "RESCHEDULED",
          lastRescheduledAt: now,
          originalStartAt: item.originalStartAt ?? item.startTime,
          originalEndAt: item.originalEndAt ?? item.endTime,
        },
      });
    }

    // Sessions that don't fit are SKIPPED
    for (const change of droppedChanges) {
      const item = itemById.get(change.itemId)!;
      await tx.studyPlanItem.update({
        where: { id: change.itemId },
        data: {
          status: "SKIPPED",
          lastRescheduledAt: now,
          originalStartAt: item.originalStartAt ?? item.startTime,
          originalEndAt: item.originalEndAt ?? item.endTime,
        },
      });
    }

    const audit = await tx.planReflowAudit.create({
      data: {
        userId,
        planId,
        reason: body.reason,
        algorithmVersion: result.algorithmVersion,
        inputSummary: {
          totalItems: plan.items.length,
          movableCount: result.changes.length,
          fixedCount: reflowItems.length - result.changes.length,
          include_missed: body.include_missed,
          respect_google_busy: body.respect_google_busy,
          busy_intervals_count: busyIntervals.length,
        },
        changes: JSON.parse(JSON.stringify(result.changes)),
      },
    });
    auditId = audit.id;
  });

  logger.info("reflow.applied", {
    user_id: userId,
    plan_id: planId,
    audit_id: auditId,
    moved: movedChanges.length,
    dropped: droppedChanges.length,
    reason: body.reason,
    calendar_update: shouldRepublish ? "REPUBLISH" : "NONE",
  });

  // Post-commit: update Google Calendar only when asked, and only for a plan
  // that is already there. Never publish a plan as a side effect.
  let calendarResult: Record<string, unknown> | null = null;
  if (shouldRepublish) {
    const publication = await prisma.planCalendarPublication.findUnique({
      where: { provider_planId: { provider: "GOOGLE", planId } },
      select: { status: true },
    });
    const published = publication?.status === "PUBLISHED" || publication?.status === "PARTIAL";

    if (!published) {
      calendarResult = { status: "NOT_PUBLISHED" };
    } else {
      try {
        const pubResult = await publishPlanToGoogle(userId, planId);
        if ("data" in pubResult) {
          calendarResult = {
            status: pubResult.data.status,
            summary: pubResult.data.summary,
            duration_ms: pubResult.data.duration_ms,
          };
        } else {
          calendarResult = {
            status: "FAILED",
            code: pubResult.error,
            error: calendarErrorMessage(pubResult.error),
          };
        }
      } catch (err) {
        logger.error("reflow.republish_failed", { plan_id: planId, error: String(err) });
        calendarResult = {
          status: "FAILED",
          code: "unknown",
          error: "Google Calendar wasn't updated. Retry from the plan's calendar options.",
        };
      }
    }
  }

  return NextResponse.json({
    plan_id: planId,
    applied: true,
    audit_id: auditId,
    changes: result.changes,
    warnings: result.warnings,
    summary: {
      moved: movedChanges.length,
      kept: result.changes.filter((c) => c.action === "KEPT").length,
      dropped: droppedChanges.length,
    },
    calendar: calendarResult,
  });
}
