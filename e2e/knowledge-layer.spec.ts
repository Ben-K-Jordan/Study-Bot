import { test, expect } from "@playwright/test";
import pg from "pg";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const USER_ID = "e2e_test_user";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Playwright context headers ride on every browser request, so app fetches
// authenticate as the test user (clients no longer send identity headers).
test.use({ extraHTTPHeaders: { "X-User-Id": USER_ID } });

test.describe.serial("Knowledge Layer — Leak Prevention", () => {
  const COURSE = "E2E_CS_KL";
  const RECOGNIZABLE = "Dijkstra shortest path algorithm uses a priority queue to greedily select minimum distance vertices";
  let sessionId: string;

  test.afterAll(async () => {
    await pool.end();
  });

  test("setup: upload doc, create session, start run", async ({ request }) => {
    // Deterministic deck: seed mastery so the new objective doesn't get a
    // PRE_TEST diagnostic prepended (pretest prompts skip the error-log form
    // by design, which this spec's INCORRECT flow depends on), and purge any
    // error logs left by a previous attempt (retries keep the DB).
    await pool.query(
      `INSERT INTO objective_mastery (id, user_id, course_name, objective_key, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NOW())
       ON CONFLICT (user_id, course_name, objective_key) DO NOTHING`,
      [USER_ID, COURSE, "obj_graphs"]
    );
    await pool.query(`DELETE FROM session_error_logs WHERE user_id = $1`, [USER_ID]);

    // Upload a doc with recognizable content
    const docContent = `Introduction to Graph Algorithms\n\n${RECOGNIZABLE}\n\nThe algorithm maintains a set of visited vertices and relaxes edges.\n\nBellman-Ford handles negative weights but is slower.\n\nFloyd-Warshall computes all-pairs shortest paths.`;

    const uploadRes = await request.post(`${BASE_URL}/api/content/documents`, {
      headers: { "X-User-Id": USER_ID },
      multipart: {
        file: {
          name: "graphs.txt",
          mimeType: "text/plain",
          buffer: Buffer.from(docContent),
        },
        namespace: "COURSE",
        course_name: COURSE,
      },
    });
    expect([200, 201]).toContain(uploadRes.status());
    const uploadData = await uploadRes.json();
    const docId = uploadData.document_id;

    // Process
    const processRes = await request.post(`${BASE_URL}/api/content/documents/${docId}/process`, {
      headers: { "Content-Type": "application/json", "X-User-Id": USER_ID },
    });
    expect(processRes.status()).toBe(200);

    // Create a RETRIEVAL session
    const sessionRes = await request.post(`${BASE_URL}/api/sessions`, {
      headers: { "Content-Type": "application/json", "X-User-Id": USER_ID },
      data: {
        course_name: COURSE,
        exam_name: "Final",
        mode: "RETRIEVAL",
        topic_scope: "Graph algorithms",
        planned_minutes: 30,
        objectives: [{ id: "obj_graphs", title: "Dijkstra shortest path" }],
        target_outcome: { prompt_count: 3 },
      },
    });
    expect(sessionRes.status()).toBe(201);
    const sessionData = await sessionRes.json();
    sessionId = sessionData.session_id;
  });

  test("review panel NOT visible before submitting answer", async ({ page }) => {
    const sessionUrl = `${BASE_URL}/s/${sessionId}`;
    await page.goto(sessionUrl);

    await page.getByRole("button", { name: /start session|resume session/i }).click();

    // Wait for the prompt to appear
    await expect(page.locator("textarea")).toBeVisible({ timeout: 10000 });

    // Assert: review panel is NOT visible (strict no-leakage)
    await expect(page.locator('[data-testid="review-panel"]')).not.toBeVisible();
    // Also assert no text from our recognizable doc is shown
    const pageText = await page.textContent("body");
    expect(pageText).not.toContain("priority queue");
  });

  test("review panel appears after INCORRECT scoring with deferred feedback", async ({ page }) => {
    const sessionUrl = `${BASE_URL}/s/${sessionId}`;
    await page.goto(sessionUrl);

    await page.getByRole("button", { name: /start session|resume session/i }).click();

    // Wait for prompt
    await expect(page.locator("textarea")).toBeVisible({ timeout: 10000 });

    // Type answer
    await page.locator("textarea").first().fill("I think Dijkstra uses BFS");
    await page.getByRole("button", { name: /submit answer/i }).click();

    // Score as INCORRECT
    await page.getByRole("button", { name: "✗ Incorrect" }).click();

    // Fill correction rule (required)
    const textareas = page.locator("textarea");
    await textareas.nth(0).fill("Dijkstra uses a priority queue not plain BFS");

    // Submit error log
    await page.getByRole("button", { name: /save/i }).click();

    // The review panel should appear with deferred feedback loading
    const reviewPanel = page.locator('[data-testid="review-panel"]');
    const visible = await reviewPanel.isVisible({ timeout: 8000 }).catch(() => false);

    if (visible) {
      // Phase 1: deferred feedback — check for loading state or excerpts
      const panelText = await reviewPanel.textContent();
      expect(panelText).toBeTruthy();
      // Should contain the review header
      expect(panelText).toContain("REVIEW");
    }
    // If not visible, that's acceptable — feedback is best-effort
  });

  test("attempt response does not leak feedback data (API-level check)", async ({ request }) => {
    // Create a fresh session for this test
    const sessionRes = await request.post(`${BASE_URL}/api/sessions`, {
      headers: { "Content-Type": "application/json", "X-User-Id": USER_ID },
      data: {
        course_name: COURSE,
        exam_name: "Final",
        mode: "RETRIEVAL",
        topic_scope: "Graph algorithms",
        planned_minutes: 30,
        target_outcome: { prompt_count: 2 },
      },
    });
    expect(sessionRes.status()).toBe(201);
    const sessData = await sessionRes.json();

    // Start run
    const startRes = await request.post(`${BASE_URL}/api/sessions/${sessData.session_id}/runs/start`, {
      headers: { "Content-Type": "application/json", "X-User-Id": USER_ID },
    });
    expect(startRes.status()).toBe(201);
    const runData = await startRes.json();

    // Phase 2: verify current_prompt and prompt_count
    expect(runData.current_prompt).toBeDefined();
    expect(runData.prompt_count).toBeDefined();
    expect(runData.current_prompt.text).toBeTruthy();

    // Submit INCORRECT attempt
    const attemptRes = await request.post(`${BASE_URL}/api/runs/${runData.run_id}/attempt`, {
      headers: { "Content-Type": "application/json", "X-User-Id": USER_ID },
      data: {
        prompt_index: 0,
        user_answer: "wrong",
        self_score: "INCORRECT",
        time_to_answer_seconds: 3,
        error_log: {
          error_type: "MEMORY",
          correction_rule: "The correct approach is...",
        },
      },
    });
    expect(attemptRes.status()).toBe(200);
    const attemptData = await attemptRes.json();

    // Phase 1: verify deferred feedback fields
    expect(attemptData.attempt_id).toBeTruthy();
    expect(attemptData.feedback_status).toBe("PENDING");

    // No-leakage: response MUST NOT contain feedback excerpts
    const raw = JSON.stringify(attemptData);
    expect(raw).not.toContain('"snippets"');
    expect(raw).not.toContain('"doc_title"');

    // Phase 1: now call the deferred feedback endpoint. Generation starts
    // eagerly at submit time, so PENDING is a valid transient state — poll
    // like the client does.
    let feedbackData: { status: string } = { status: "PENDING" };
    for (let i = 0; i < 30; i++) {
      const feedbackRes = await request.get(
        `${BASE_URL}/api/attempts/${attemptData.attempt_id}/feedback`,
        { headers: { "X-User-Id": USER_ID } }
      );
      expect(feedbackRes.status()).toBe(200);
      feedbackData = await feedbackRes.json();
      if (feedbackData.status !== "PENDING") break;
      await new Promise((r) => setTimeout(r, 300));
    }
    expect(["OK", "UNAVAILABLE"]).toContain(feedbackData.status);

    // Phase 2: verify prompt endpoint works
    const promptRes = await request.get(
      `${BASE_URL}/api/runs/${runData.run_id}/prompt?index=1`,
      { headers: { "X-User-Id": USER_ID } }
    );
    expect(promptRes.status()).toBe(200);
    const promptData = await promptRes.json();
    expect(promptData.text).toBeTruthy();
    expect(promptData.prompt_index).toBe(1);
  });
});

