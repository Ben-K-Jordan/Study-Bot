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

    // Inject fake client
    fakeClient = new FakeGoogleCalendarClient();
    setGoogleClientFactory(() => fakeClient);

    // Clean up any existing data for test user
    await prisma.googleIntegration.deleteMany({ where: { userId } });

    // Create a fake Google integration
    await prisma.googleIntegration.create({
      data: {
        userId,
        refreshTokenEncrypted: "fake-encrypted-token",
        tokenExpiryMs: BigInt(Date.now() + 3600000),
        scopeString: "https://www.googleapis.com/auth/calendar.readonly",
        calendarIdSelected: "primary",
      },
    });
  });

  afterAll(async () => {
    resetGoogleClientFactory();
    await prisma.googleIntegration.deleteMany({ where: { userId } });
    // Clean up sessions and plans
    await prisma.studyPlanItem.deleteMany({ where: { plan: { userId } } });
    await prisma.studyPlan.deleteMany({ where: { userId } });
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.$disconnect();
  });

  beforeEach(() => {
    fakeClient.setBusy([]);
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

  it("creates a plan without google availability (baseline)", async () => {
    const result = await createPlan(userId, basePlanInput);
    expect(result.plan_id).toBeTruthy();
    expect(result.items.length).toBeGreaterThan(0);
    // All items should have start/end times
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
    // Block 09:00-13:00 on day 1 (tomorrow) — forces all day-1 items into afternoon.
    // We use tomorrow because the plan service sends timeMin=now(), and if the
    // current time is past 13:00 today, the FakeClient would filter out a same-day busy.
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

    // All day-1 items must start at or after 13:00 (the busy period end)
    const day1Items = result.items.filter((i: any) => i.day_index === 1);
    const busyEndMs = busyEnd.getTime();

    for (const item of day1Items) {
      const itemStart = new Date(item.start_time).getTime();
      expect(itemStart).toBeGreaterThanOrEqual(busyEndMs);
    }
  });

  it("falls back to regular scheduling when integration missing", async () => {
    const otherUserId = "test_user_gcal_no_integration";
    // No integration exists for this user — should still create plan
    const result = await createPlan(otherUserId, {
      ...basePlanInput,
      use_google_availability: true,
    });
    expect(result.plan_id).toBeTruthy();
    expect(result.items.length).toBeGreaterThan(0);

    // Clean up
    await prisma.studyPlanItem.deleteMany({ where: { plan: { userId: otherUserId } } });
    await prisma.studyPlan.deleteMany({ where: { userId: otherUserId } });
    await prisma.session.deleteMany({ where: { userId: otherUserId } });
  });

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

    // Should only return primary calendar events within the time range
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

  it("publishes plan events to Google Calendar", async () => {
    const plan = await createPlan(userId, basePlanInput);
    const result = await publishPlanToGoogle(userId, plan.plan_id);

    expect(result.data).toBeDefined();
    expect(result.data.published).toBe(true);
    expect(result.data.events_created).toBeGreaterThan(0);
    expect(result.data.events_updated).toBe(0);

    // Verify googleEventId was stored
    const items = await prisma.studyPlanItem.findMany({
      where: { planId: plan.plan_id },
    });
    for (const item of items) {
      expect(item.googleEventId).toBeTruthy();
      expect(item.googleCalendarId).toBe("primary");
    }

    // Verify fake client has events
    expect(fakeClient.getEvents().length).toBeGreaterThan(0);
  });

  it("re-publishing is idempotent (updates, no duplicates)", async () => {
    const plan = await createPlan(userId, basePlanInput);

    // Publish once
    const first = await publishPlanToGoogle(userId, plan.plan_id);
    const createdCount = first.data.events_created;

    // Publish again — should update, not create
    const second = await publishPlanToGoogle(userId, plan.plan_id);
    expect(second.data.events_created).toBe(0);
    expect(second.data.events_updated).toBe(createdCount);
  });

  it("unpublishes plan events from Google Calendar", async () => {
    const plan = await createPlan(userId, basePlanInput);
    await publishPlanToGoogle(userId, plan.plan_id);

    const result = await unpublishPlanFromGoogle(userId, plan.plan_id);
    expect(result.data).toBeDefined();
    expect(result.data.published).toBe(false);
    expect(result.data.events_deleted).toBeGreaterThan(0);

    // Verify googleEventId was cleared
    const items = await prisma.studyPlanItem.findMany({
      where: { planId: plan.plan_id },
    });
    for (const item of items) {
      expect(item.googleEventId).toBeNull();
      expect(item.googleCalendarId).toBeNull();
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

  it("publish returns google_not_connected when no integration", async () => {
    const otherUserId = "test_user_gcal_no_google";
    const plan = await createPlan(otherUserId, basePlanInput);
    const result = await publishPlanToGoogle(otherUserId, plan.plan_id);
    expect(result.error).toBe("google_not_connected");

    // Clean up
    await prisma.studyPlanItem.deleteMany({ where: { plan: { userId: otherUserId } } });
    await prisma.studyPlan.deleteMany({ where: { userId: otherUserId } });
    await prisma.session.deleteMany({ where: { userId: otherUserId } });
  });
});
