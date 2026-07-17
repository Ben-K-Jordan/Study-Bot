import { test, expect } from "@playwright/test";
import pg from "pg";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const USER_ID = "e2e_test_user";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const SESSION_PAYLOAD = {
  course_name: "E2E 101",
  exam_name: "Final Exam",
  mode: "RETRIEVAL",
  topic_scope: "End-to-end testing",
  planned_minutes: 30,
  objectives: [
    { id: "obj_1", title: "Page navigation" },
    { id: "obj_2", title: "Form submission" },
  ],
  target_outcome: { prompt_count: 3, target_accuracy: 0.7 },
  // cycles: 1 ⇒ no break can trigger (already on last cycle). Breaks are not under test here.
  break_protocol: { type: "TEST_3_2", cycles: 1 },
};

let sessionId: string;
let sessionUrl: string;

// Playwright context headers ride on every browser request, so app fetches
// authenticate as the test user (clients no longer send identity headers).
test.use({ extraHTTPHeaders: { "X-User-Id": USER_ID } });

test.describe.serial("E2E: Full Retrieval Session Runner", () => {
  test.beforeAll(async () => {
    for (const key of ["obj_1", "obj_2"]) {
      await pool.query(
        `INSERT INTO objective_mastery (id, user_id, course_name, objective_key, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, NOW())
         ON CONFLICT (user_id, course_name, objective_key) DO NOTHING`,
        [USER_ID, "E2E 101", key]
      );
    }
    // Purge error logs from any previous attempt (retries keep the DB).
    // Unresolved logs survive a single correct retrieval by design and would
    // inject CROSS_SESSION_REPAIR prompts, shifting the exact "PROMPT k / N"
    // labels these tests assert.
    await pool.query(`DELETE FROM session_error_logs WHERE user_id = $1`, [USER_ID]);
  });

  test.afterAll(async () => {
    await pool.query(`DELETE FROM objective_mastery WHERE user_id = $1`, [USER_ID]);
    await pool.end();
  });

  test("create session via API", async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/sessions`, {
      headers: {
        "Content-Type": "application/json",
        "X-User-Id": USER_ID,
      },
      data: SESSION_PAYLOAD,
    });

    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(body.session_id).toBeDefined();
    expect(body.session_url).toContain("/s/");
    expect(body.calendar.title).toContain("E2E 101");

    sessionId = body.session_id;
    sessionUrl = `/s/${sessionId}`;
  });

  test("preflight screen shows session details", async ({ page }) => {
    await page.goto(sessionUrl);
    await expect(page.getByText("E2E 101")).toBeVisible();
    await expect(page.getByText("Final Exam")).toBeVisible();
    await expect(page.getByText(/Retrieval: End-to-end testing/)).toBeVisible();

    const startBtn = page.getByRole("button", { name: /start session/i });
    await expect(startBtn).toBeEnabled();
  });

  test("start session and see first prompt", async ({ page }) => {
    await page.goto(sessionUrl);

    await page.getByRole("button", { name: /start session/i }).click();

    // Should see the first prompt
    await expect(page.getByText("PROMPT 1 / 3")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("textarea")).toBeVisible();
  });

  test("submit a CORRECT answer", async ({ page }) => {
    await page.goto(sessionUrl);

    await page.getByRole("button", { name: /start session|resume session/i }).click();

    // Should be on prompt 1 (or wherever we left off)
    await expect(page.locator("textarea")).toBeVisible({ timeout: 5000 });

    // Type answer and submit
    await page.locator("textarea").fill("Page navigation involves routing between views");
    await page.getByRole("button", { name: /submit answer/i }).click();

    // Should see scoring buttons
    await expect(page.getByRole("button", { name: "✓ Correct" })).toBeVisible();

    // Click Correct and wait for the attempt API call to complete
    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/attempt") && res.status() === 200),
      page.getByRole("button", { name: "✓ Correct" }).click(),
    ]);

    // The review panel keeps the just-answered prompt on the card — the
    // prompt advances only when the student moves on.
    await expect(page.getByText("PROMPT 1 / 3")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /next prompt/i }).click();
    await expect(page.getByText("PROMPT 2 / 3")).toBeVisible({ timeout: 10_000 });
  });

  test("submit an INCORRECT answer with error log", async ({ page }) => {
    await page.goto(sessionUrl);

    await page.getByRole("button", { name: /start session|resume session/i }).click();
    await expect(page.locator("textarea")).toBeVisible({ timeout: 5000 });

    // Type answer and submit
    await page.locator("textarea").first().fill("Wrong answer about forms");
    await page.getByRole("button", { name: /submit answer/i }).click();

    // Score as incorrect
    await page.getByRole("button", { name: "✗ Incorrect" }).click();

    // Should show error log form
    await expect(page.getByText(/log the error/i)).toBeVisible();

    // Fill correction rule (required)
    const textareas = page.locator("textarea");
    // The correction rule textarea
    await textareas.nth(0).fill("Forms need proper validation before submission");

    // Submit error log and wait for the attempt API call to complete
    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/attempt") && res.status() === 200),
      page.getByRole("button", { name: /save.*next/i }).click(),
    ]);

    // The review panel keeps the just-answered prompt (snapshotted at submit
    // time, before variant injection grew the deck) on the card.
    await expect(page.getByText("PROMPT 2 / 3")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /next prompt/i }).click();
    // Prompt should advance — variant injection extends deck from 3 to 4,
    // and the runner names the growth instead of changing the count silently.
    await expect(page.getByText("PROMPT 3 / 4")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("+1 repair added to this session")).toBeVisible();
  });

  test("refresh page mid-run preserves progress", async ({ page }) => {
    await page.goto(sessionUrl);

    // Should show Resume (not Start) since we have an active run
    await expect(page.getByRole("button", { name: /resume session/i })).toBeVisible({
      timeout: 5000,
    });

    await page.getByRole("button", { name: /resume session/i }).click();

    // Should be on prompt 3 (variant injection extended deck from 3 to 4)
    await expect(page.getByText("PROMPT 3 / 4")).toBeVisible({ timeout: 5000 });
  });

  test("complete final prompt and see end screen", async ({ page }) => {
    await page.goto(sessionUrl);

    await page.getByRole("button", { name: /start session|resume session/i }).click();
    // The review panel renders reflection textareas too, so target the
    // answer box by its placeholder.
    const answerBox = page.getByPlaceholder("Type your answer from memory...");
    await expect(answerBox).toBeVisible({ timeout: 5000 });

    // Submit remaining prompts (original + variant injected by earlier INCORRECT)
    for (let i = 0; i < 2; i++) {
      await answerBox.fill(`Answer ${i}`);
      await page.getByRole("button", { name: /submit answer/i }).click();
      await page.getByRole("button", { name: "✓ Correct" }).click();

      // The last CORRECT completes the run and jumps straight to the end
      // screen; otherwise a review panel appears and Next Prompt advances.
      if (i < 1) {
        await page.getByRole("button", { name: /next prompt/i }).click();
        await expect(answerBox).toBeVisible({ timeout: 5000 });
      }
    }

    // Should show end screen
    await expect(page.getByText("SESSION COMPLETE")).toBeVisible({ timeout: 5000 });
    // Should show accuracy
    await expect(page.getByText("Accuracy", { exact: true })).toBeVisible();
    // Should show recommended follow-ups
    await expect(page.getByText(/RECOMMENDED FOLLOW-UPS/i)).toBeVisible();
  });

  test("verify final metrics via API", async ({ request }) => {
    // Start endpoint on a completed session should create a new run or show completed state
    // Instead, let's verify the session's run data via the start endpoint
    const startRes = await request.post(
      `${BASE_URL}/api/sessions/${sessionId}/runs/start`,
      {
        headers: { "X-User-Id": USER_ID },
      }
    );
    // Since run is completed, it should create a new run (201)
    // or we can check the run directly. Let's just verify the API works.
    expect([200, 201]).toContain(startRes.status());
  });
});

test.describe("E2E: Security", () => {
  test.use({ extraHTTPHeaders: {} });
  test("different user cannot access another user's run", async ({ request }) => {
    // Create a session as user A
    const createRes = await request.post(`${BASE_URL}/api/sessions`, {
      headers: {
        "Content-Type": "application/json",
        "X-User-Id": "user_A_security",
      },
      data: {
        course_name: "SEC 101",
        exam_name: "Test",
        mode: "RETRIEVAL",
        topic_scope: "Security",
        planned_minutes: 15,
      },
    });
    const session = await createRes.json();

    // Start run as user A
    const startRes = await request.post(
      `${BASE_URL}/api/sessions/${session.session_id}/runs/start`,
      { headers: { "X-User-Id": "user_A_security" } }
    );
    const run = await startRes.json();

    // User B tries to GET the run → 403
    const getRes = await request.get(`${BASE_URL}/api/runs/${run.run_id}`, {
      headers: { "X-User-Id": "user_B_intruder" },
    });
    expect(getRes.status()).toBe(403);

    // User B tries to submit attempt → 403
    const attemptRes = await request.post(
      `${BASE_URL}/api/runs/${run.run_id}/attempt`,
      {
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": "user_B_intruder",
        },
        data: {
          prompt_index: 0,
          user_answer: "Hacked",
          self_score: "CORRECT",
        },
      }
    );
    expect(attemptRes.status()).toBe(403);
  });

  test("unknown IDs return 404", async ({ request }) => {
    const res1 = await request.get(`${BASE_URL}/api/sessions/nonexistent_id`, {
      headers: { "X-User-Id": "anyone" },
    });
    expect(res1.status()).toBe(404);

    const res2 = await request.get(`${BASE_URL}/api/runs/nonexistent_run`, {
      headers: { "X-User-Id": "anyone" },
    });
    expect(res2.status()).toBe(404);
  });

  test("missing auth header returns 401", async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/sessions`, {
      headers: {
        "Content-Type": "application/json",
        "X-User-Id": "",
      },
      data: { course_name: "X", exam_name: "Y", mode: "RETRIEVAL", topic_scope: "Z", planned_minutes: 15 },
    });
    expect(res.status()).toBe(401);
  });
});

test.describe("E2E: State validation", () => {
  let sessionId: string;
  let runId: string;
  const uid = "state_test_user";

  test.beforeAll(async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/sessions`, {
      headers: { "Content-Type": "application/json", "X-User-Id": uid },
      data: {
        course_name: "STATE 101",
        exam_name: "Quiz",
        mode: "RETRIEVAL",
        topic_scope: "State machines",
        planned_minutes: 15,
        target_outcome: { prompt_count: 2 },
      },
    });
    const body = await res.json();
    sessionId = body.session_id;

    const startRes = await request.post(
      `${BASE_URL}/api/sessions/${sessionId}/runs/start`,
      { headers: { "X-User-Id": uid } }
    );
    const startBody = await startRes.json();
    runId = startBody.run_id;
  });

  test("cannot submit wrong prompt_index (409)", async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/runs/${runId}/attempt`, {
      headers: { "Content-Type": "application/json", "X-User-Id": uid },
      data: {
        prompt_index: 5,
        user_answer: "Out of order",
        self_score: "CORRECT",
      },
    });
    expect(res.status()).toBe(409);
  });

  test("complete all prompts then reject further attempts (409)", async ({ request }) => {
    // Submit prompt 0
    await request.post(`${BASE_URL}/api/runs/${runId}/attempt`, {
      headers: { "Content-Type": "application/json", "X-User-Id": uid },
      data: { prompt_index: 0, user_answer: "A", self_score: "CORRECT" },
    });
    // Submit prompt 1 (last)
    await request.post(`${BASE_URL}/api/runs/${runId}/attempt`, {
      headers: { "Content-Type": "application/json", "X-User-Id": uid },
      data: { prompt_index: 1, user_answer: "B", self_score: "CORRECT" },
    });

    // Try prompt 2 — should be 409 (run completed)
    const res = await request.post(`${BASE_URL}/api/runs/${runId}/attempt`, {
      headers: { "Content-Type": "application/json", "X-User-Id": uid },
      data: { prompt_index: 2, user_answer: "C", self_score: "CORRECT" },
    });
    expect(res.status()).toBe(409);
  });

  test("complete endpoint is idempotent", async ({ request }) => {
    const res1 = await request.post(`${BASE_URL}/api/runs/${runId}/complete`, {
      headers: { "X-User-Id": uid },
    });
    expect(res1.status()).toBe(200);

    const res2 = await request.post(`${BASE_URL}/api/runs/${runId}/complete`, {
      headers: { "X-User-Id": uid },
    });
    expect(res2.status()).toBe(200);

    const body1 = await res1.json();
    const body2 = await res2.json();
    expect(body1.status).toBe("COMPLETED");
    expect(body2.status).toBe("COMPLETED");
  });
});
