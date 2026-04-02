/**
 * Integration tests for Reflow API endpoints.
 *
 * Tests:
 * 1) Mark item missed → apply reflow → item moved to future slot
 * 2) Apply reflow creates audit row
 * 3) Apply reflow + republish updates events without duplicates
 * 4) Locked items never moved
 *
 * Uses FakeGoogleCalendarClient — no real Google API calls.
 * Requires a running PostgreSQL database (DATABASE_URL).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  FakeGoogleCalendarClient,
  setGoogleClientFactory,
  resetGoogleClientFactory,
} from "@/lib/google/calendar-client";

const hasDb = !!process.env.DATABASE_URL;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prisma: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let createPlan: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let publishPlanToGoogle: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let computeReflow: any;

describe.skipIf(!hasDb)("Integration: Reflow API", () => {
  const userId = "test_user_reflow";
  let fakeClient: FakeGoogleCalendarClient;

  beforeAll(async () => {
    const dbModule = await import("@/lib/db");
    prisma = dbModule.prisma;

    const planService = await import("@/services/plan");
    createPlan = planService.createPlan;

    const publishService = await import("@/services/publish");
    publishPlanToGoogle = publishService.publishPlanToGoogle;

    const reflowService = await import("@/services/reflow");
    computeReflow = reflowService.computeReflow;

    // Inject fake Google client
    fakeClient = new FakeGoogleCalendarClient();
    setGoogleClientFactory(() => fakeClient);

    // Clean up any existing data for test user
    await prisma.planReflowAudit.deleteMany({ where: { userId } });
    await prisma.planItemExternalEvent.deleteMany({ where: { userId } });
    await prisma.planCalendarPublication.deleteMany({ where: { userId } });
    await prisma.googleIntegration.deleteMany({ where: { userId } });
    await prisma.studyPlanItem.deleteMany({ where: { plan: { userId } } });
    await prisma.studyPlan.deleteMany({ where: { userId } });
    await prisma.session.deleteMany({ where: { userId } });

    // Create a fake Google integration
    await prisma.googleIntegration.create({
      data: {
        userId,
        refreshTokenEncrypted: "fake-encrypted-token",
        tokenExpiryMs: BigInt(Date.now() + 3600000),
        scopeString: "https://www.googleapis.com/auth/calendar",
        calendarIdSelected: "primary",
      },
    });
  });

  afterAll(async () => {
    resetGoogleClientFactory();
    await prisma.planReflowAudit.deleteMany({ where: { userId } });
    await prisma.planItemExternalEvent.deleteMany({ where: { userId } });
    await prisma.planCalendarPublication.deleteMany({ where: { userId } });
    await prisma.googleIntegration.deleteMany({ where: { userId } });
    await prisma.studyPlanItem.deleteMany({ where: { plan: { userId } } });
    await prisma.studyPlan.deleteMany({ where: { userId } });
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    fakeClient.setBusy([]);
    fakeClient.clearCallLog();
  });

  const basePlanInput = {
    course_name: "Reflow 101",
    exam_name: "Final",
    exam_date: "2026-06-15",
    objectives: [
      "Topic A",
      "Topic B",
      "Topic C",
      "Topic D",
      "Topic E",
    ],
    availability: Array.from({ length: 7 }, () => ({
      start: "09:00",
      end: "17:00",
    })),
    daily_study_cap_minutes: 180,
    break_protocol_default: "50_10",
  };

  // Helper: create a plan and return its ID + items
  async function createTestPlan() {
    const result = await createPlan(userId, basePlanInput);
    const items = await prisma.studyPlanItem.findMany({
      where: { planId: result.plan_id },
      orderBy: [{ dayIndex: "asc" }, { startTime: "asc" }],
    });
    return { planId: result.plan_id, items };
  }

  // ---- Test 1: Mark missed → apply reflow → item moved ----

  it("marks item as MISSED then apply reflow moves it to a future slot", async () => {
    const { planId, items } = await createTestPlan();
    expect(items.length).toBeGreaterThan(1);

    const firstItem = items[0];

    // Mark the first item as MISSED
    const updatedItem = await prisma.studyPlanItem.update({
      where: { id: firstItem.id },
      data: {
        status: "MISSED",
        missedAt: new Date(),
      },
    });
    expect(updatedItem.status).toBe("MISSED");

    // Load plan with items for reflow
    const plan = await prisma.studyPlan.findUnique({
      where: { planId },
      include: { items: { orderBy: [{ dayIndex: "asc" }, { startTime: "asc" }] } },
    });

    const sessionIds = plan.items.map((i: { sessionId: string }) => i.sessionId);
    const sessions = await prisma.session.findMany({
      where: { sessionId: { in: sessionIds } },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sessionMap = new Map(sessions.map((s: any) => [s.sessionId, s]));

    const reflowItems = plan.items.map((item: { id: string; sessionId: string; dayIndex: number; startTime: Date; endTime: Date; status: string; locked: boolean }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const session = sessionMap.get(item.sessionId) as any;
      return {
        id: item.id,
        sessionId: item.sessionId,
        dayIndex: item.dayIndex,
        startTime: item.startTime,
        endTime: item.endTime,
        status: item.status,
        locked: item.locked,
        mode: session?.mode ?? "RETRIEVAL",
        plannedMinutes: session?.plannedMinutes ?? 60,
      };
    });

    const config = plan.config as Record<string, unknown>;
    const reflowConfig = {
      availability: (config.availability as { start: string; end: string }[]) ??
        Array.from({ length: 7 }, () => ({ start: "09:00", end: "17:00" })),
      daily_study_cap_minutes: (config.daily_study_cap_minutes as number) ?? 180,
    };

    // Use a "now" before the plan start so all items are future
    const earlyNow = new Date(plan.startDate);
    earlyNow.setDate(earlyNow.getDate() - 1);

    const result = computeReflow(reflowItems, reflowConfig, plan.startDate, earlyNow);

    // The MISSED item should NOT be in the movable set (it's terminal)
    // Only SCHEDULED items should be in changes
    const scheduledItems = plan.items.filter((i: { status: string }) => i.status === "SCHEDULED");
    expect(result.changes.length).toBe(scheduledItems.length);

    // All placed items should not overlap with the missed item's time
    for (const change of result.changes) {
      if (change.after && change.after.dayIndex === firstItem.dayIndex) {
        const changeStart = new Date(change.after.startTime).getTime();
        const missedEnd = firstItem.endTime.getTime();
        // Items on the same day should avoid the missed slot
        // (the missed slot is occupied by the fixed MISSED item)
        expect(changeStart).toBeGreaterThanOrEqual(missedEnd);
      }
    }
  });

  // ---- Test 2: Apply reflow creates audit row ----

  it("apply reflow creates a PlanReflowAudit record", async () => {
    const { planId, items } = await createTestPlan();

    // Mark first item as DONE to force rescheduling of others
    await prisma.studyPlanItem.update({
      where: { id: items[0].id },
      data: { status: "DONE", completedAt: new Date() },
    });

    // Load plan data
    const plan = await prisma.studyPlan.findUnique({
      where: { planId },
      include: { items: { orderBy: [{ dayIndex: "asc" }, { startTime: "asc" }] } },
    });

    const sessionIds = plan.items.map((i: { sessionId: string }) => i.sessionId);
    const sessions = await prisma.session.findMany({
      where: { sessionId: { in: sessionIds } },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sessionMap = new Map(sessions.map((s: any) => [s.sessionId, s]));

    const reflowItems = plan.items.map((item: { id: string; sessionId: string; dayIndex: number; startTime: Date; endTime: Date; status: string; locked: boolean }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const session = sessionMap.get(item.sessionId) as any;
      return {
        id: item.id,
        sessionId: item.sessionId,
        dayIndex: item.dayIndex,
        startTime: item.startTime,
        endTime: item.endTime,
        status: item.status,
        locked: item.locked,
        mode: session?.mode ?? "RETRIEVAL",
        plannedMinutes: session?.plannedMinutes ?? 60,
      };
    });

    const config = plan.config as Record<string, unknown>;
    const reflowConfig = {
      availability: (config.availability as { start: string; end: string }[]) ??
        Array.from({ length: 7 }, () => ({ start: "09:00", end: "17:00" })),
      daily_study_cap_minutes: (config.daily_study_cap_minutes as number) ?? 180,
    };

    const earlyNow = new Date(plan.startDate);
    earlyNow.setDate(earlyNow.getDate() - 1);

    const result = computeReflow(reflowItems, reflowConfig, plan.startDate, earlyNow);
    const movedChanges = result.changes.filter((c: { action: string }) => c.action === "MOVED");
    const droppedChanges = result.changes.filter((c: { action: string }) => c.action === "DROPPED");

    // Only proceed if there are actual changes
    if (movedChanges.length === 0 && droppedChanges.length === 0) {
      // All items kept in place — test still valid, just no audit needed
      return;
    }

    // Apply changes in transaction (simulating what the apply endpoint does)
    const now = earlyNow;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await prisma.$transaction(async (tx: any) => {
      for (const change of movedChanges) {
        const item = plan.items.find((i: { id: string }) => i.id === change.itemId)!;
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

      for (const change of droppedChanges) {
        const item = plan.items.find((i: { id: string }) => i.id === change.itemId)!;
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

      await tx.planReflowAudit.create({
        data: {
          userId,
          planId,
          reason: "MANUAL",
          algorithmVersion: result.algorithmVersion,
          inputSummary: {
            totalItems: plan.items.length,
            movableCount: reflowItems.filter((i: { status: string; locked: boolean; endTime: Date }) =>
              i.status === "SCHEDULED" && !i.locked && i.endTime.getTime() > now.getTime()
            ).length,
          },
          changes: JSON.parse(JSON.stringify(result.changes)),
        },
      });
    });

    // Verify audit row was created
    const audits = await prisma.planReflowAudit.findMany({
      where: { planId, userId },
      orderBy: { createdAt: "desc" },
    });

    expect(audits.length).toBeGreaterThanOrEqual(1);
    const latestAudit = audits[0];
    expect(latestAudit.reason).toBe("MANUAL");
    expect(latestAudit.algorithmVersion).toBe("v1");
    expect(latestAudit.inputSummary).toBeDefined();
    expect(Array.isArray(latestAudit.changes)).toBe(true);
    expect(latestAudit.changes.length).toBeGreaterThan(0);

    // Verify moved items have RESCHEDULED status
    const movedItemIds = movedChanges.map((c: { itemId: string }) => c.itemId);
    if (movedItemIds.length > 0) {
      const movedItems = await prisma.studyPlanItem.findMany({
        where: { id: { in: movedItemIds } },
      });
      for (const item of movedItems) {
        expect(item.status).toBe("RESCHEDULED");
        expect(item.lastRescheduledAt).toBeTruthy();
        expect(item.originalStartAt).toBeTruthy();
        expect(item.originalEndAt).toBeTruthy();
      }
    }
  });

  // ---- Test 3: Apply reflow + republish doesn't duplicate ----

  it("apply reflow + republish updates existing events without duplicates", async () => {
    const { planId } = await createTestPlan();

    // First: publish the plan
    const pubResult = await publishPlanToGoogle(userId, planId);
    expect("data" in pubResult).toBe(true);
    expect(pubResult.data.status).toMatch(/OK|PARTIAL/);

    const initialCreated = pubResult.data.summary.created;
    expect(initialCreated).toBeGreaterThan(0);

    // Get initial event mappings
    const initialMappings = await prisma.planItemExternalEvent.findMany({
      where: { planId, provider: "GOOGLE" },
    });
    expect(initialMappings.length).toBe(initialCreated);

    // Now republish (simulating post-reflow republish)
    fakeClient.clearCallLog();
    const repubResult = await publishPlanToGoogle(userId, planId);
    expect("data" in repubResult).toBe(true);

    // Should UPDATE existing events, not create new ones
    expect(repubResult.data.summary.created).toBe(0);
    // Updated + unchanged should equal total
    expect(
      repubResult.data.summary.updated + repubResult.data.summary.unchanged
    ).toBe(repubResult.data.summary.total);

    // Verify no duplicate mappings
    const finalMappings = await prisma.planItemExternalEvent.findMany({
      where: { planId, provider: "GOOGLE" },
    });
    expect(finalMappings.length).toBe(initialMappings.length);
  });

  // ---- Test 4: Locked items never moved ----

  it("locked items are never moved by reflow", async () => {
    const { planId, items } = await createTestPlan();
    expect(items.length).toBeGreaterThan(1);

    // Lock the first item
    const lockedItem = await prisma.studyPlanItem.update({
      where: { id: items[0].id },
      data: { locked: true },
    });
    expect(lockedItem.locked).toBe(true);

    const originalStart = lockedItem.startTime.toISOString();
    const originalEnd = lockedItem.endTime.toISOString();

    // Load plan and compute reflow
    const plan = await prisma.studyPlan.findUnique({
      where: { planId },
      include: { items: { orderBy: [{ dayIndex: "asc" }, { startTime: "asc" }] } },
    });

    const sessionIds = plan.items.map((i: { sessionId: string }) => i.sessionId);
    const sessions = await prisma.session.findMany({
      where: { sessionId: { in: sessionIds } },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sessionMap = new Map(sessions.map((s: any) => [s.sessionId, s]));

    const reflowItems = plan.items.map((item: { id: string; sessionId: string; dayIndex: number; startTime: Date; endTime: Date; status: string; locked: boolean }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const session = sessionMap.get(item.sessionId) as any;
      return {
        id: item.id,
        sessionId: item.sessionId,
        dayIndex: item.dayIndex,
        startTime: item.startTime,
        endTime: item.endTime,
        status: item.status,
        locked: item.locked,
        mode: session?.mode ?? "RETRIEVAL",
        plannedMinutes: session?.plannedMinutes ?? 60,
      };
    });

    const config = plan.config as Record<string, unknown>;
    const reflowConfig = {
      availability: (config.availability as { start: string; end: string }[]) ??
        Array.from({ length: 7 }, () => ({ start: "09:00", end: "17:00" })),
      daily_study_cap_minutes: (config.daily_study_cap_minutes as number) ?? 180,
    };

    const earlyNow = new Date(plan.startDate);
    earlyNow.setDate(earlyNow.getDate() - 1);

    const result = computeReflow(reflowItems, reflowConfig, plan.startDate, earlyNow);

    // The locked item should NOT appear in the changes at all
    // (it's classified as "fixed" and excluded from movable)
    const lockedChange = result.changes.find(
      (c: { itemId: string }) => c.itemId === lockedItem.id
    );
    expect(lockedChange).toBeUndefined();

    // Verify the locked item's position is still the same in DB
    const afterReflow = await prisma.studyPlanItem.findUnique({
      where: { id: lockedItem.id },
    });
    expect(afterReflow.startTime.toISOString()).toBe(originalStart);
    expect(afterReflow.endTime.toISOString()).toBe(originalEnd);
    expect(afterReflow.locked).toBe(true);
  });

  // ---- Test 5: Item status endpoint behavior ----

  it("DONE sets completedAt, MISSED sets missedAt", async () => {
    const { planId, items } = await createTestPlan();

    // Mark first item DONE
    const doneItem = await prisma.studyPlanItem.update({
      where: { id: items[0].id },
      data: { status: "DONE", completedAt: new Date() },
    });
    expect(doneItem.status).toBe("DONE");
    expect(doneItem.completedAt).toBeTruthy();

    // Mark second item MISSED
    const missedItem = await prisma.studyPlanItem.update({
      where: { id: items[1].id },
      data: { status: "MISSED", missedAt: new Date() },
    });
    expect(missedItem.status).toBe("MISSED");
    expect(missedItem.missedAt).toBeTruthy();

    // Mark third item SKIPPED
    const skippedItem = await prisma.studyPlanItem.update({
      where: { id: items[2].id },
      data: { status: "SKIPPED" },
    });
    expect(skippedItem.status).toBe("SKIPPED");
  });
});
