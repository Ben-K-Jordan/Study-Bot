/**
 * E2E tests for Google Calendar integration.
 *
 * Tests API-level flows: status, freebusy, calendars, plan with google availability.
 * Uses FakeGoogleCalendarClient injected at server level.
 */
import { test, expect } from "@playwright/test";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const userId = "e2e_gcal_user";

// E2E tests run against the actual server — these test API responses
test.describe("Google Calendar API", () => {
  test.use({ extraHTTPHeaders: { "X-User-Id": userId } });

  test("GET /api/integrations/google/status returns not connected for unknown user", async ({
    request,
  }) => {
    const res = await request.get(`${BASE}/api/integrations/google/status`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.connected).toBe(false);
    expect(body.scopes).toEqual([]);
  });

  test("POST /api/integrations/google/freebusy returns 400 when not connected", async ({
    request,
  }) => {
    const res = await request.post(`${BASE}/api/integrations/google/freebusy`, {
      data: {
        timeMin: "2026-04-01T00:00:00Z",
        timeMax: "2026-04-01T23:59:59Z",
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("not connected");
  });

  test("GET /api/integrations/google/calendars returns 400 when not connected", async ({
    request,
  }) => {
    const res = await request.get(`${BASE}/api/integrations/google/calendars`);
    expect(res.status()).toBe(400);
  });

  test("POST /api/integrations/google/disconnect succeeds even when not connected", async ({
    request,
  }) => {
    const res = await request.post(
      `${BASE}/api/integrations/google/disconnect`
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.disconnected).toBe(true);
  });
});

test.describe("Google Calendar - Plan with availability", () => {
  // This test uses a separate user with no extra headers to test auth
  test.use({ extraHTTPHeaders: {} });

  test("POST /api/plans returns 401 without user id", async ({ request }) => {
    const res = await request.post(`${BASE}/api/plans`, {
      data: {
        course_name: "Test",
        exam_name: "Test",
        exam_date: "2026-06-15",
        objectives: ["A", "B", "C"],
        availability: Array.from({ length: 7 }, () => ({
          start: "09:00",
          end: "17:00",
        })),
        use_google_availability: true,
      },
    });
    expect(res.status()).toBe(401);
  });
});

test.describe("Google Calendar - Plan with user", () => {
  test.use({ extraHTTPHeaders: { "X-User-Id": userId } });

  test("POST /api/plans with use_google_availability works (no integration = fallback)", async ({
    request,
  }) => {
    const res = await request.post(`${BASE}/api/plans`, {
      data: {
        course_name: "E2E GCAL",
        exam_name: "Final",
        exam_date: "2026-06-15",
        objectives: [
          "OAuth flow",
          "Calendar API",
          "Free busy",
          "Scheduling",
          "UI integration",
        ],
        availability: Array.from({ length: 7 }, () => ({
          start: "09:00",
          end: "17:00",
        })),
        daily_study_cap_minutes: 120,
        break_protocol_default: "50_10",
        use_google_availability: true,
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.plan_id).toBeTruthy();
    expect(body.items.length).toBeGreaterThan(0);
  });
});
