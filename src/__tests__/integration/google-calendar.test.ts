/**
 * Integration tests for Google Calendar features.
 *
 * Uses FakeGoogleCalendarClient — no real Google API calls.
 * Requires a running PostgreSQL database (DATABASE_URL).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  FakeGoogleCalendarClient,
  setGoogleClientFactory,
  resetGoogleClientFactory,
  type BusyInterval,
} from "@/lib/google/calendar-client";

const hasDb = !!process.env.DATABASE_URL;

let prisma: any;
let createPlan: any;
let publishPlanToGoogle: any;
let unpublishPlanFromGoogle: any;
let getPublishStatus: any;

describe.skipIf(!hasDb)("Integration: Google Calendar", () => {
  const userId = "test_user_gcal";
  let fakeClient: FakeGoogleCalendarClient;

  beforeAll(async () => {
    const dbModule = await import("@/lib/db");
    prisma = dbModule.prisma;

    const planService = await import("@/services/plan");
    createPlan = planService.createPlan;

    const publishService = await import("@/services/publish");
    publishPlanToGoogle = publishService.publishPlanToGoogle;
    unpublishPlanFromGoogle = publishService.unpublishPlanFromGoogle;
    getPublishStatus = publishService.getPublishStatus;

    // Inject fake client
    fakeClient = new FakeGoogleCalendarClient();
    setGoogleClientFactory(() => fakeClient);

    // Clean up any existing data for test user
    await prisma.planItemExternalEvent.deleteMany({ where: { userId } });
    await prisma.planCalendarPublication.deleteMany({ where: { userId } });
    await prisma.googleIntegration.deleteMany({ where: { userId } });

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
    course_name: "GCAL 101",
    exam_name: "Final",
    exam_date: "2026-06-15",
    objectives: [
      "Google Calendar integration",
      "OAuth flow",
      "Free/busy queries",
      "Availability-aware scheduling",
      "UI components",
    ],
    availability: Array.from({ length: 7 }, () => ({
      start: "09:00",
      end: "17:00",
    })),
    daily_study_cap_minutes: 180,
    break_protocol_default: "50_10",
  };

  // ---- Plan creation tests ----

  it("creates a plan without google availability (baseline)", async () => {
    const result = await createPlan(userId, basePlanInput);
    expect(result.plan_id).toBeTruthy();
    expect(result.items.length).toBeGreaterThan(0);
    for (const item of result.items) {
      expect(item.start_time).toBeTruthy();
      expect(item.end_time).toBeTruthy();
    }
  });

  it("creates a plan with google availability and no busy times", async () => {
    const result = await createPlan(userId, {
      ...basePlanInput,
      use_google_availability: true,
    });
    expect(result.plan_id).toBeTruthy();
    expect(result.items.length).toBeGreaterThan(0);
  });

  it("avoids busy slots when use_google_availability is true", async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    const busyEnd = new Date(tomorrow);
    busyEnd.setHours(13, 0, 0, 0);

    fakeClient.setBusy([
      {
        calendarId: "primary",
        start: tomorrow.toISOString(),
        end: busyEnd.toISOString(),
      },
    ]);

    const result = await createPlan(userId, {
      ...basePlanInput,
      use_google_availability: true,
    });

    expect(result.plan_id).toBeTruthy();

    const day1Items = result.items.filter((i: any) => i.day_index === 1);
    const busyEndMs = busyEnd.getTime();

    for (const item of day1Items) {
      const itemStart = new Date(item.start_time).getTime();
      expect(itemStart).toBeGreaterThanOrEqual(busyEndMs);
    }
  });

  it("falls back to regular scheduling when integration missing", async () => {
    const otherUserId = "test_user_gcal_no_integration";
    const result = await createPlan(otherUserId, {
      ...basePlanInput,
      use_google_availability: true,
    });
    expect(result.plan_id).toBeTruthy();
    expect(result.items.length).toBeGreaterThan(0);

    await prisma.studyPlanItem.deleteMany({ where: { plan: { userId: otherUserId } } });
    await prisma.studyPlan.deleteMany({ where: { userId: otherUserId } });
    await prisma.session.deleteMany({ where: { userId: otherUserId } });
  });

  // ---- FakeClient unit tests ----

  it("FakeGoogleCalendarClient returns filtered busy intervals", async () => {
    const busy: BusyInterval[] = [
      { calendarId: "primary", start: "2026-04-01T10:00:00Z", end: "2026-04-01T11:00:00Z" },
      { calendarId: "primary", start: "2026-04-02T14:00:00Z", end: "2026-04-02T15:00:00Z" },
      { calendarId: "work", start: "2026-04-01T12:00:00Z", end: "2026-04-01T13:00:00Z" },
    ];
    fakeClient.setBusy(busy);

    const result = await fakeClient.freebusyQuery({
      timeMin: "2026-04-01T00:00:00Z",
      timeMax: "2026-04-01T23:59:59Z",
      calendarIds: ["primary"],
    });

    expect(result).toHaveLength(1);
    expect(result[0].calendarId).toBe("primary");
    expect(result[0].start).toBe("2026-04-01T10:00:00Z");
  });

  it("FakeGoogleCalendarClient.listCalendars returns configured calendars", async () => {
    const calendars = await fakeClient.listCalendars();
    expect(calendars).toHaveLength(1);
    expect(calendars[0].id).toBe("primary");
  });

  // ---- Publish / Unpublish tests ----

  it("publishes plan events to Google Calendar with per-item results", async () => {
    const plan = await createPlan(userId, basePlanInput);
    const result = await publishPlanToGoogle(userId, plan.plan_id);

    expect(result.data).toBeDefined();
    expect(result.data.status).toBe("PUBLISHED");
    expect(result.data.provider).toBe("GOOGLE");
    expect(result.data.calendar_id).toBe("primary");
    expect(result.data.results.created).toBeGreaterThan(0);
    expect(result.data.results.failed).toBe(0);
    expect(result.data.items.length).toBe(plan.items.length);

    // Each item should have an event_id and html_link
    for (const item of result.data.items) {
      expect(item.action).toBe("CREATED");
      expect(item.event_id).toBeTruthy();
      expect(item.html_link).toBeTruthy();
    }

    // Verify PlanItemExternalEvent rows created
    const mappings = await prisma.planItemExternalEvent.findMany({
      where: { planId: plan.plan_id },
    });
    expect(mappings.length).toBe(plan.items.length);
    for (const m of mappings) {
      expect(m.eventId).toBeTruthy();
      expect(m.lastSyncedHash).toHaveLength(64);
    }

    // Verify PlanCalendarPublication row
    const pub = await prisma.planCalendarPublication.findUnique({
      where: { provider_planId: { provider: "GOOGLE", planId: plan.plan_id } },
    });
    expect(pub).toBeTruthy();
    expect(pub.status).toBe("PUBLISHED");
  });

  it("idempotent republish: unchanged items skip API calls", async () => {
    const plan = await createPlan(userId, basePlanInput);

    // First publish
    const first = await publishPlanToGoogle(userId, plan.plan_id);
    expect(first.data.results.created).toBeGreaterThan(0);

    // Clear call log
    fakeClient.clearCallLog();

    // Second publish — all items should be UNCHANGED (same hash)
    const second = await publishPlanToGoogle(userId, plan.plan_id);
    expect(second.data.results.unchanged).toBe(first.data.results.created);
    expect(second.data.results.created).toBe(0);
    expect(second.data.results.updated).toBe(0);

    // Verify no createEvent or updateEvent calls were made
    const createCalls = fakeClient.callLog.filter((c) => c.method === "createEvent");
    const updateCalls = fakeClient.callLog.filter((c) => c.method === "updateEvent");
    expect(createCalls.length).toBe(0);
    expect(updateCalls.length).toBe(0);
  });

  it("republish with changed plan times updates existing events", async () => {
    const plan = await createPlan(userId, basePlanInput);
    await publishPlanToGoogle(userId, plan.plan_id);

    // Modify start times in the database to simulate plan change
    const items = await prisma.studyPlanItem.findMany({
      where: { planId: plan.plan_id },
    });
    for (const item of items) {
      const newStart = new Date(item.startTime);
      newStart.setHours(newStart.getHours() + 1);
      const newEnd = new Date(item.endTime);
      newEnd.setHours(newEnd.getHours() + 1);
      await prisma.studyPlanItem.update({
        where: { id: item.id },
        data: { startTime: newStart, endTime: newEnd },
      });
    }

    fakeClient.clearCallLog();

    // Republish — items should be UPDATED (hash changed)
    const result = await publishPlanToGoogle(userId, plan.plan_id);
    expect(result.data.results.updated).toBe(items.length);
    expect(result.data.results.created).toBe(0);

    const updateCalls = fakeClient.callLog.filter((c) => c.method === "updateEvent");
    expect(updateCalls.length).toBe(items.length);
  });

  it("handles manually deleted events: recreates and updates mapping", async () => {
    const plan = await createPlan(userId, basePlanInput);
    const pubResult = await publishPlanToGoogle(userId, plan.plan_id);

    // Simulate manual deletion of first event in Google
    const firstEventId = pubResult.data.items[0].event_id!;
    fakeClient.simulateManualDelete(firstEventId);

    // Modify times to trigger update attempt
    const items = await prisma.studyPlanItem.findMany({
      where: { planId: plan.plan_id },
      orderBy: [{ dayIndex: "asc" }, { startTime: "asc" }],
    });
    const newStart = new Date(items[0].startTime);
    newStart.setMinutes(newStart.getMinutes() + 5);
    await prisma.studyPlanItem.update({
      where: { id: items[0].id },
      data: { startTime: newStart },
    });

    // Republish — should recreate the deleted event
    const result = await publishPlanToGoogle(userId, plan.plan_id);
    const firstItem = result.data.items.find((i: any) => i.plan_item_id === items[0].id);
    expect(firstItem).toBeTruthy();
    expect(firstItem!.action).toBe("CREATED");
    expect(firstItem!.event_id).toBeTruthy();
    expect(firstItem!.event_id).not.toBe(firstEventId); // New event ID
  });

  it("unpublishes plan events and clears mappings", async () => {
    const plan = await createPlan(userId, basePlanInput);
    await publishPlanToGoogle(userId, plan.plan_id);

    const result = await unpublishPlanFromGoogle(userId, plan.plan_id);
    expect(result.data).toBeDefined();
    expect(result.data.status).toBe("UNPUBLISHED");
    expect(result.data.deleted).toBeGreaterThan(0);
    expect(result.data.failed).toBe(0);

    // Verify mappings are cleared
    const mappings = await prisma.planItemExternalEvent.findMany({
      where: { planId: plan.plan_id },
    });
    expect(mappings.length).toBe(0);

    // Verify publication status
    const pub = await prisma.planCalendarPublication.findUnique({
      where: { provider_planId: { provider: "GOOGLE", planId: plan.plan_id } },
    });
    expect(pub.status).toBe("UNPUBLISHED");
  });

  it("get publish status returns correct data", async () => {
    const plan = await createPlan(userId, basePlanInput);
    await publishPlanToGoogle(userId, plan.plan_id);

    const result = await getPublishStatus(userId, plan.plan_id);
    expect(result.data).toBeDefined();
    expect(result.data.publication).toBeTruthy();
    expect(result.data.publication!.status).toBe("PUBLISHED");
    expect(result.data.publication!.calendar_id).toBe("primary");
    expect(result.data.items.length).toBe(plan.items.length);
    for (const item of result.data.items) {
      expect(item.event_id).toBeTruthy();
      expect(item.last_synced_hash).toHaveLength(64);
    }
  });

  it("publish returns not_found for missing plan", async () => {
    const result = await publishPlanToGoogle(userId, "nonexistent_plan");
    expect(result.error).toBe("not_found");
  });

  it("publish returns forbidden for other user's plan", async () => {
    const plan = await createPlan(userId, basePlanInput);
    const result = await publishPlanToGoogle("other_user", plan.plan_id);
    expect(result.error).toBe("forbidden");
  });

  it("publish returns GOOGLE_NOT_CONNECTED when no integration", async () => {
    const otherUserId = "test_user_gcal_no_google";
    const plan = await createPlan(otherUserId, basePlanInput);
    const result = await publishPlanToGoogle(otherUserId, plan.plan_id);
    expect(result.error).toBe("GOOGLE_NOT_CONNECTED");

    // Clean up
    await prisma.studyPlanItem.deleteMany({ where: { plan: { userId: otherUserId } } });
    await prisma.studyPlan.deleteMany({ where: { userId: otherUserId } });
    await prisma.session.deleteMany({ where: { userId: otherUserId } });
  });

  it("dry_run computes actions without calling Google", async () => {
    const plan = await createPlan(userId, basePlanInput);
    fakeClient.clearCallLog();

    const result = await publishPlanToGoogle(userId, plan.plan_id, { dryRun: true });
    expect(result.data).toBeDefined();
    expect(result.data.results.created).toBeGreaterThan(0);

    // No Google API calls should have been made
    const apiCalls = fakeClient.callLog.filter((c) =>
      ["createEvent", "updateEvent", "deleteEvent"].includes(c.method),
    );
    expect(apiCalls.length).toBe(0);

    // No mappings should be created
    const mappings = await prisma.planItemExternalEvent.findMany({
      where: { planId: plan.plan_id },
    });
    expect(mappings.length).toBe(0);
  });
});
