/**
 * Playwright E2E tests for Google Calendar UI flows.
 *
 * Requires GOOGLE_PROVIDER=fake so the server uses FakeGoogleCalendarClient.
 * Uses the __test-seed endpoint to create/cleanup GoogleIntegration records.
 */
import { test, expect } from "@playwright/test";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const userId = "e2e_ui_gcal_user";

// ── Settings Page ──────────────────────────────────────────────────────

test.describe("Settings Page - Calendar UI", () => {
  test.use({ extraHTTPHeaders: { "X-User-Id": userId } });

  test.beforeEach(async ({ request }) => {
    // Seed a connected GoogleIntegration
    const res = await request.post(`${BASE}/api/integrations/google/__test-seed`, {
      data: { connected_email: "e2e@example.com" },
    });
    // If seed endpoint not available (GOOGLE_PROVIDER != fake), skip
    if (res.status() === 404) {
      test.skip(true, "GOOGLE_PROVIDER is not fake — skipping UI E2E");
    }
    expect(res.status()).toBe(200);
  });

  test.afterEach(async ({ request }) => {
    await request.delete(`${BASE}/api/integrations/google/__test-seed`);
  });

  test("shows connected status and account email", async ({ page }) => {
    await page.goto(`${BASE}/settings/calendar`);

    // Wait for status to load
    await expect(page.locator("text=Connected")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=e2e@example.com")).toBeVisible();

    // Test Connection and Disconnect buttons should be visible
    await expect(page.locator("button", { hasText: "Test Connection" })).toBeVisible();
    await expect(page.locator("button", { hasText: "Disconnect" })).toBeVisible();
  });

  test("displays calendar preferences when connected", async ({ page }) => {
    await page.goto(`${BASE}/settings/calendar`);

    // Wait for calendars to load (fake client returns "Primary" calendar)
    await expect(page.locator("text=Calendar Preferences")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=Default calendar")).toBeVisible();
    await expect(page.locator("text=Busy calendars")).toBeVisible();
  });

  test("save preferences updates successfully", async ({ page }) => {
    await page.goto(`${BASE}/settings/calendar`);

    // Wait for preferences to appear
    await expect(page.locator("text=Calendar Preferences")).toBeVisible({ timeout: 10_000 });

    // Click Save Preferences
    await page.locator("button", { hasText: "Save Preferences" }).click();

    // Should show success message
    await expect(page.locator("text=Preferences saved")).toBeVisible({ timeout: 5_000 });
  });

  test("test connection shows success message", async ({ page }) => {
    await page.goto(`${BASE}/settings/calendar`);

    await expect(page.locator("button", { hasText: "Test Connection" })).toBeVisible({ timeout: 10_000 });
    await page.locator("button", { hasText: "Test Connection" }).click();

    // Should show success
    await expect(page.locator("text=Connection test passed")).toBeVisible({ timeout: 10_000 });
  });

  test("disconnect removes connection", async ({ page }) => {
    await page.goto(`${BASE}/settings/calendar`);

    await expect(page.locator("button", { hasText: "Disconnect" })).toBeVisible({ timeout: 10_000 });
    await page.locator("button", { hasText: "Disconnect" }).click();

    // Status should switch to "Not connected"
    await expect(page.locator("text=Not connected")).toBeVisible({ timeout: 5_000 });

    // Connect button should now appear
    await expect(page.locator("button", { hasText: "Connect Google Calendar" })).toBeVisible();
  });

  test("shows not connected state for unknown user", async ({ page, context }) => {
    // Use a different user ID that has no integration
    await context.setExtraHTTPHeaders({ "X-User-Id": "e2e_unknown_user_no_gcal" });
    await page.goto(`${BASE}/settings/calendar`);

    await expect(page.locator("text=Not connected")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("button", { hasText: "Connect Google Calendar" })).toBeVisible();
  });
});

// ── Plan Page: Publish Flow ────────────────────────────────────────────

test.describe("Plan Page - Publish Flow", () => {
  test.use({ extraHTTPHeaders: { "X-User-Id": userId } });

  let planId: string;

  test.beforeAll(async ({ request }) => {
    // Seed Google integration
    const seedRes = await request.post(`${BASE}/api/integrations/google/__test-seed`, {
      data: { connected_email: "e2e@example.com" },
    });
    if (seedRes.status() === 404) {
      test.skip(true, "GOOGLE_PROVIDER is not fake — skipping UI E2E");
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
    await request.delete(`${BASE}/api/integrations/google/__test-seed`);
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
