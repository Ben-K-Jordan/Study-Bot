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

    // Verify all required session types exist
    const modes = body.items.map((i: any) => i.mode);
    expect(modes).toContain("RETRIEVAL");
    expect(modes).toContain("INTERLEAVED_PRACTICE");
    expect(modes).toContain("EXAM_SIM");
    expect(modes).toContain("ERROR_REPAIR");

    // Verify first session is RETRIEVAL (diagnostic)
    expect(body.items[0].mode).toBe("RETRIEVAL");
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

    const eventCount = (body.match(/BEGIN:VEVENT/g) || []).length;
    expect(eventCount).toBeGreaterThanOrEqual(5);

    expect(body).toContain("UID:");
    expect(body).toContain("DTSTART:");
    expect(body).toContain("DTEND:");
    expect(body).toContain("SUMMARY:");
    expect(body).toContain("DESCRIPTION:");
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

  test("session page renders for plan-created session", async ({ page }) => {
    await page.goto(`/s/${firstSessionId}`);
    await expect(page.getByText("E2E Plan 101")).toBeVisible();
    await expect(page.getByText("Final Exam")).toBeVisible();
  });

  test("start run on plan-created session via API", async ({ request }) => {
    const response = await request.post(
      `${BASE_URL}/api/sessions/${firstSessionId}/runs/start`,
      { headers: { "X-User-Id": USER_ID } }
    );

    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.status).toBe("ACTIVE");
    expect(body.current_index).toBe(0);
    expect(body.prompts.length).toBeGreaterThan(0);
    expect(body.break_state).toBeDefined();
  });

  test("submit attempt on plan-created session", async ({ request }) => {
    // Resume run to get run_id
    const startRes = await request.post(
      `${BASE_URL}/api/sessions/${firstSessionId}/runs/start`,
      { headers: { "X-User-Id": USER_ID } }
    );
    expect(startRes.status()).toBe(200);
    const run = await startRes.json();
    expect(run.resumed).toBe(true);

    // Submit attempt
    const attemptRes = await request.post(
      `${BASE_URL}/api/runs/${run.run_id}/attempt`,
      {
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": USER_ID,
        },
        data: {
          prompt_index: 0,
          user_answer: "Page navigation uses routing and URL matching",
          self_score: "CORRECT",
          time_to_answer_seconds: 30,
        },
      }
    );

    expect(attemptRes.status()).toBe(200);
    const result = await attemptRes.json();
    expect(result.current_index).toBe(1);
    expect(result.metrics.correct_count).toBe(1);
    expect(result.metrics.attempts_count).toBe(1);
  });

  test("resume preserves state after attempt", async ({ request }) => {
    const response = await request.post(
      `${BASE_URL}/api/sessions/${firstSessionId}/runs/start`,
      { headers: { "X-User-Id": USER_ID } }
    );

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.resumed).toBe(true);
    expect(body.current_index).toBe(1);
    expect(body.metrics.attempts_count).toBe(1);
    expect(body.metrics.correct_count).toBe(1);
  });
});

test.describe("E2E: Plan security", () => {
  test.use({ extraHTTPHeaders: {} });
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
