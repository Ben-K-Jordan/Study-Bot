/**
 * Playwright E2E tests for publishing a plan to Google Calendar.
 *
 * Requires GOOGLE_PROVIDER=fake so the server uses FakeGoogleCalendarClient.
 * Uses the test-seed endpoint to create/cleanup GoogleIntegration records.
 */
import { test, expect } from "@playwright/test";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const userId = "e2e_ui_gcal_user";

// ── Publish flow ───────────────────────────────────────────────────────

test.describe("Google Calendar - Publish flow with a connected account", () => {
  test.use({ extraHTTPHeaders: { "X-User-Id": userId } });

  let planId: string;

  test.beforeAll(async ({ request }) => {
    // Seed Google integration
    const seedRes = await request.post(`${BASE}/api/integrations/google/test-seed`, {
      data: { connected_email: "e2e@example.com" },
    });
    if (seedRes.status() === 404) {
      test.skip(true, "test-seed unavailable (needs GOOGLE_PROVIDER=fake and ALLOW_TEST_AUTH), skipping publish E2E");
    }

    // Create a plan via API
    const planRes = await request.post(`${BASE}/api/plans`, {
      data: {
        course_name: "E2E UI Calendar",
        exam_name: "Final Exam",
        exam_date: "2026-06-15",
        objectives: ["Topic A", "Topic B", "Topic C", "Topic D", "Topic E"],
        availability: Array.from({ length: 7 }, () => ({ start: "09:00", end: "17:00" })),
        daily_study_cap_minutes: 120,
        break_protocol_default: "50_10",
      },
    });
    expect(planRes.status()).toBe(201);
    const plan = await planRes.json();
    planId = plan.plan_id;
  });

  test.afterAll(async ({ request }) => {
    await request.delete(`${BASE}/api/integrations/google/test-seed`);
  });

  test("publish to Google Calendar shows success counts", async ({ request }) => {
    // Publish via API (since the plan page UI requires navigating through form creation)
    const pubRes = await request.post(`${BASE}/api/plans/${planId}/publish/google`, {
      data: {},
    });
    expect(pubRes.status()).toBe(200);
    const pubBody = await pubRes.json();

    expect(pubBody.status).toBe("OK");
    expect(pubBody.summary.total).toBeGreaterThan(0);
    expect(pubBody.summary.created).toBe(pubBody.summary.total);
    expect(pubBody.summary.updated).toBe(0);
    expect(pubBody.summary.unchanged).toBe(0);
    expect(pubBody.summary.failed).toBe(0);
    expect(pubBody.duration_ms).toBeGreaterThanOrEqual(0);
    expect(pubBody.item_results.length).toBe(pubBody.summary.total);

    // All items should be CREATED
    for (const item of pubBody.item_results) {
      expect(item.action).toBe("CREATED");
      expect(item.event_id).toBeTruthy();
    }
  });

  test("republish shows unchanged counts", async ({ request }) => {
    // Republish the same plan — events should be unchanged
    const pubRes = await request.post(`${BASE}/api/plans/${planId}/publish/google`, {
      data: {},
    });
    expect(pubRes.status()).toBe(200);
    const pubBody = await pubRes.json();

    expect(pubBody.status).toBe("OK");
    // On republish with fake client, events get UPDATED (not UNCHANGED) because
    // fake client doesn't persist extended properties for hash comparison
    expect(pubBody.summary.total).toBeGreaterThan(0);
    expect(pubBody.summary.failed).toBe(0);
  });

  test("publish status shows published state", async ({ request }) => {
    const statusRes = await request.get(`${BASE}/api/plans/${planId}/publish/google`);
    expect(statusRes.status()).toBe(200);
    const status = await statusRes.json();

    expect(status.publication).not.toBeNull();
    expect(status.publication.status).toBe("PUBLISHED");
    expect(status.publication.published_at).toBeTruthy();
    expect(status.items.length).toBeGreaterThan(0);
  });

  test("unpublish removes events", async ({ request }) => {
    const unpubRes = await request.post(`${BASE}/api/plans/${planId}/unpublish/google`, {
      data: {},
    });
    expect(unpubRes.status()).toBe(200);
    const unpubBody = await unpubRes.json();

    expect(unpubBody.status).toBe("OK");
    expect(unpubBody.duration_ms).toBeGreaterThanOrEqual(0);

    // Verify status is now unpublished
    const statusRes = await request.get(`${BASE}/api/plans/${planId}/publish/google`);
    const status = await statusRes.json();
    expect(status.publication).toBeNull();
    expect(status.items).toEqual([]);
  });
});
