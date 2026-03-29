import { test, expect } from "@playwright/test";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const USER_ID = "e2e_plan_user";

const PLAN_PAYLOAD = {
  course_name: "E2E Plan 101",
  exam_name: "Final Exam",
  exam_date: "2025-12-15",
  objectives: [
    "Page navigation",
    "Form validation",
    "API integration",
    "Error handling",
    "State management",
  ],
  availability: Array.from({ length: 7 }, () => ({
    start: "09:00",
    end: "17:00",
  })),
  daily_study_cap_minutes: 180,
  break_protocol_default: "50_10",
};

let planId: string;
let firstSessionId: string;
let firstSessionUrl: string;

test.describe.serial("E2E: Plan → Session → Run continuity", () => {
  test("create plan via API", async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/plans`, {
      headers: {
        "Content-Type": "application/json",
        "X-User-Id": USER_ID,
      },
      data: PLAN_PAYLOAD,
    });

    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.plan_id).toBeDefined();
    expect(body.items.length).toBeGreaterThanOrEqual(5);

    planId = body.plan_id;
    firstSessionId = body.items[0].session_id;
    firstSessionUrl = `/s/${firstSessionId}`;

    // Verify all required session types exist
    const modes = body.items.map((i: any) => i.mode);
    expect(modes).toContain("RETRIEVAL");
    expect(modes).toContain("INTERLEAVED_PRACTICE");
    expect(modes).toContain("EXAM_SIM");
    expect(modes).toContain("ERROR_REPAIR");
  });

  test("GET plan returns correct items", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/plans/${planId}`, {
      headers: { "X-User-Id": USER_ID },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.plan_id).toBe(planId);
    expect(body.course_name).toBe("E2E Plan 101");
    expect(body.items.length).toBeGreaterThanOrEqual(5);

    // Verify each item has session_url
    for (const item of body.items) {
      expect(item.session_url).toContain("/s/");
      expect(item.calendar).toBeTruthy();
    }
  });

  test("GET plan ICS returns valid calendar file", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/plans/${planId}/ics`, {
      headers: { "X-User-Id": USER_ID },
    });

    expect(response.status()).toBe(200);
    const contentType = response.headers()["content-type"];
    expect(contentType).toContain("text/calendar");

    const body = await response.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("END:VCALENDAR");

    // Count events
    const eventCount = (body.match(/BEGIN:VEVENT/g) || []).length;
    expect(eventCount).toBeGreaterThanOrEqual(5);

    // Every event has required fields
    expect(body).toContain("UID:");
    expect(body).toContain("DTSTART:");
    expect(body).toContain("DTEND:");
    expect(body).toContain("SUMMARY:");
    expect(body).toContain("DESCRIPTION:");

    // Deep links present
    expect(body).toContain("/s/");

    // No duplicate UIDs
    const uidMatches = body.match(/UID:.+/g) || [];
    const uids = uidMatches.map((m: string) => m.trim());
    expect(new Set(uids).size).toBe(uids.length);
  });

  test("ICS content-disposition has filename", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/plans/${planId}/ics`, {
      headers: { "X-User-Id": USER_ID },
    });

    const disposition = response.headers()["content-disposition"];
    expect(disposition).toContain("attachment");
    expect(disposition).toContain(".ics");
  });

  test("open first session from plan in browser", async ({ page }) => {
    await page.goto(firstSessionUrl);

    // Session info visible
    await expect(page.getByText("E2E Plan 101")).toBeVisible();
    await expect(page.getByText("Final Exam")).toBeVisible();
  });

  test("start run on plan-created session", async ({ page, request }) => {
    // Verify the session is RETRIEVAL mode via API first
    const apiRes = await request.post(
      `${BASE_URL}/api/sessions/${firstSessionId}/runs/start`,
      { headers: { "X-User-Id": USER_ID } }
    );
    expect(apiRes.status()).toBeLessThan(400);
    const runData = await apiRes.json();
    expect(runData.prompts.length).toBeGreaterThan(0);

    // Now test the UI
    await page.goto(firstSessionUrl);
    await page.evaluate((uid) => {
      localStorage.setItem("study_bot_user_id", uid);
    }, USER_ID);
    await page.goto(firstSessionUrl);

    // Should show Resume since we just started a run via API
    const checkboxes = page.locator('input[type="checkbox"]');
    const count = await checkboxes.count();
    for (let i = 0; i < count; i++) {
      await checkboxes.nth(i).check();
    }
    await page.getByRole("button", { name: /start session|resume session/i }).click();

    // Should see first prompt
    await expect(page.getByText(/PROMPT 1 \//)).toBeVisible({ timeout: 15000 });
    await expect(page.locator("textarea")).toBeVisible();
  });

  test("submit attempt and see progress", async ({ page }) => {
    await page.goto(firstSessionUrl);
    await page.evaluate((uid) => {
      localStorage.setItem("study_bot_user_id", uid);
    }, USER_ID);
    await page.goto(firstSessionUrl);

    // Resume
    const checkboxes = page.locator('input[type="checkbox"]');
    const count = await checkboxes.count();
    for (let i = 0; i < count; i++) {
      await checkboxes.nth(i).check();
    }
    await page.getByRole("button", { name: /start session|resume session/i }).click();
    await expect(page.locator("textarea")).toBeVisible({ timeout: 5000 });

    // Type answer
    await page.locator("textarea").fill("Page navigation uses routing and URL patterns");
    await page.getByRole("button", { name: /submit answer/i }).click();

    // Score as correct
    await expect(page.getByRole("button", { name: "✓ Correct" })).toBeVisible();
    await page.getByRole("button", { name: "✓ Correct" }).click();

    // Should advance to prompt 2
    await expect(page.getByText(/PROMPT 2 \//)).toBeVisible({ timeout: 5000 });
  });

  test("refresh preserves progress (resume state)", async ({ page }) => {
    await page.goto(firstSessionUrl);
    await page.evaluate((uid) => {
      localStorage.setItem("study_bot_user_id", uid);
    }, USER_ID);
    await page.goto(firstSessionUrl);

    // Should show Resume button
    await expect(
      page.getByRole("button", { name: /resume session/i })
    ).toBeVisible({ timeout: 5000 });

    // Resume
    const checkboxes = page.locator('input[type="checkbox"]');
    const count = await checkboxes.count();
    for (let i = 0; i < count; i++) {
      await checkboxes.nth(i).check();
    }
    await page.getByRole("button", { name: /resume session/i }).click();

    // Should still be on prompt 2 (not prompt 1)
    await expect(page.getByText(/PROMPT 2 \//)).toBeVisible({ timeout: 5000 });
  });

  test("verify run state via API", async ({ request }) => {
    // Start/resume to get run_id
    const startRes = await request.post(
      `${BASE_URL}/api/sessions/${firstSessionId}/runs/start`,
      { headers: { "X-User-Id": USER_ID } }
    );
    expect(startRes.status()).toBe(200);
    const run = await startRes.json();
    expect(run.status).toBe("ACTIVE");
    expect(run.current_index).toBe(1); // 1 attempt submitted
    expect(run.metrics.attempts_count).toBe(1);
    expect(run.metrics.correct_count).toBe(1);
    expect(run.resumed).toBe(true);
  });
});

test.describe("E2E: Plan security", () => {
  let planId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/plans`, {
      headers: {
        "Content-Type": "application/json",
        "X-User-Id": "plan_owner_sec",
      },
      data: {
        ...PLAN_PAYLOAD,
        course_name: "SEC Plan",
      },
    });
    const body = await res.json();
    planId = body.plan_id;
  });

  test("other user cannot view plan (403)", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/plans/${planId}`, {
      headers: { "X-User-Id": "intruder" },
    });
    expect(res.status()).toBe(403);
  });

  test("other user cannot export ICS (403)", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/plans/${planId}/ics`, {
      headers: { "X-User-Id": "intruder" },
    });
    expect(res.status()).toBe(403);
  });

  test("unknown plan_id returns 404", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/plans/nonexistent_plan`, {
      headers: { "X-User-Id": "anyone" },
    });
    expect(res.status()).toBe(404);
  });

  test("missing auth returns 401", async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/plans`, {
      headers: {
        "Content-Type": "application/json",
        "X-User-Id": "",
      },
      data: PLAN_PAYLOAD,
    });
    expect(res.status()).toBe(401);
  });
});
