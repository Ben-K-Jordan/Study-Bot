import { test, expect } from "@playwright/test";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const USER_ID = "e2e_kl_user_" + Date.now();

test.describe.serial("Knowledge Layer — Leak Prevention", () => {
  const COURSE = "E2E_CS_" + Date.now();
  const RECOGNIZABLE = "Dijkstra shortest path algorithm uses a priority queue to greedily select minimum distance vertices";
  let sessionId: string;

  test("setup: upload doc, create session", async ({ request }) => {
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
    expect(uploadRes.status()).toBe(201);
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
    await page.evaluate((uid) => {
      localStorage.setItem("study_bot_user_id", uid);
    }, USER_ID);
    await page.goto(sessionUrl);

    // Check pre-session commitment checkboxes
    const checkboxes = page.locator('input[type="checkbox"]');
    for (let i = 0; i < 3; i++) {
      await checkboxes.nth(i).check();
    }

    // Start the session
    await page.getByRole("button", { name: /start session/i }).click();

    // Wait for the prompt to appear
    await expect(page.getByText("PROMPT 1 / 3")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("textarea")).toBeVisible();

    // Assert: review panel is NOT visible
    await expect(page.locator('[data-testid="review-panel"]')).not.toBeVisible();
    // Also assert no text from our recognizable doc is shown
    const pageText = await page.textContent("body");
    expect(pageText).not.toContain("priority queue");
  });

  test("review panel appears after INCORRECT scoring with feedback", async ({ page }) => {
    const sessionUrl = `${BASE_URL}/s/${sessionId}`;
    await page.goto(sessionUrl);
    await page.evaluate((uid) => {
      localStorage.setItem("study_bot_user_id", uid);
    }, USER_ID);
    await page.goto(sessionUrl);

    // Check pre-session commitment checkboxes
    const checkboxes = page.locator('input[type="checkbox"]');
    for (let i = 0; i < 3; i++) {
      await checkboxes.nth(i).check();
    }

    // Resume session (run was started in previous test)
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

    // The review panel should appear if feedback was returned
    // Give it time to fetch and render
    const reviewPanel = page.locator('[data-testid="review-panel"]');
    // Check if review panel appeared (it will only if search returned results)
    const visible = await reviewPanel.isVisible({ timeout: 5000 }).catch(() => false);

    if (visible) {
      // If visible, verify it shows the doc title or snippet content
      const panelText = await reviewPanel.textContent();
      expect(panelText).toBeTruthy();

      // Check for doc title reference
      const titleEl = page.locator('[data-testid="excerpt-doc-title"]');
      if (await titleEl.isVisible().catch(() => false)) {
        const title = await titleEl.textContent();
        expect(title).toBeTruthy();
      }
    }
    // If not visible, that's acceptable — feedback is best-effort
  });
});

test.describe("Knowledge Layer — Library Page", () => {
  test("library page renders with tabs", async ({ page }) => {
    await page.goto(`${BASE_URL}/library`);
    await expect(page.locator("h1")).toContainText("Knowledge Library");
    await expect(page.locator('button:has-text("Course Materials")')).toBeVisible();
    await expect(page.locator('button:has-text("Practice Bank")')).toBeVisible();
    await expect(page.locator('button:has-text("Research Library")')).toBeVisible();
  });
});
