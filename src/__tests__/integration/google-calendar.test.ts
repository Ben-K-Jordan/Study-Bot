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

describe.skipIf(!hasDb)("Integration: Google Calendar", () => {
  const userId = "test_user_gcal";
  let fakeClient: FakeGoogleCalendarClient;

  beforeAll(async () => {
    const dbModule = await import("@/lib/db");
    prisma = dbModule.prisma;

    const planService = await import("@/services/plan");
    createPlan = planService.createPlan;

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
    const plans = await prisma.studyPlan.findMany({ where: { userId } });
    for (const plan of plans) {
      await prisma.planItem.deleteMany({ where: { planId: plan.id } });
    }
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
    // Block 10:00-12:00 on the first day
    const today = new Date();
    today.setHours(10, 0, 0, 0);
    const busyEnd = new Date(today);
    busyEnd.setHours(12, 0, 0, 0);

    fakeClient.setBusy([
      {
        calendarId: "primary",
        start: today.toISOString(),
        end: busyEnd.toISOString(),
      },
    ]);

    const result = await createPlan(userId, {
      ...basePlanInput,
      use_google_availability: true,
    });

    expect(result.plan_id).toBeTruthy();

    // Check that no items on day 0 overlap with 10:00-12:00
    const day0Items = result.items.filter((i: any) => i.day_index === 0);
    const busyStart = today.getTime();
    const busyEndMs = busyEnd.getTime();

    for (const item of day0Items) {
      const itemStart = new Date(item.start_time).getTime();
      const itemEnd = new Date(item.end_time).getTime();
      // Item should not overlap with busy period
      const overlaps = itemStart < busyEndMs && itemEnd > busyStart;
      expect(overlaps).toBe(false);
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
    const plans = await prisma.studyPlan.findMany({ where: { userId: otherUserId } });
    for (const plan of plans) {
      await prisma.planItem.deleteMany({ where: { planId: plan.id } });
    }
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
});
