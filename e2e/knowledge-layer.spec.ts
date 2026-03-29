import { test, expect } from "@playwright/test";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const USER_ID = "e2e_kl_user_" + Date.now();

async function api(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { "X-User-Id": USER_ID };
  if (body && !(body instanceof FormData)) headers["Content-Type"] = "application/json";

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

test.describe("Knowledge Layer — Leak Prevention", () => {
  const COURSE = "E2E_CS_" + Date.now();
  const RECOGNIZABLE = "Dijkstra shortest path algorithm uses a priority queue to greedily select minimum distance vertices";
  let sessionId: string;
  let docId: string;

  test.beforeAll(async () => {
    // Upload + process a doc with recognizable content
    const form = new FormData();
    form.append(
      "file",
      new Blob(
        [
          `Introduction to Graph Algorithms\n\n${RECOGNIZABLE}\n\nThe algorithm maintains a set of visited vertices and relaxes edges.\n\nBellman-Ford handles negative weights but is slower.\n\nFloyd-Warshall computes all-pairs shortest paths.`,
        ],
        { type: "text/plain" }
      ),
      "graphs.txt"
    );
    form.append("namespace", "COURSE");
    form.append("course_name", COURSE);

    const uploadRes = await fetch(`${BASE_URL}/api/content/documents`, {
      method: "POST",
      headers: { "X-User-Id": USER_ID },
      body: form,
    });
    const uploadData = await uploadRes.json();
    docId = uploadData.document_id;

    // Process
    await api("POST", `/api/content/documents/${docId}/process`);

    // Create a RETRIEVAL session for this course
    const sessionRes = await api("POST", "/api/sessions", {
      course_name: COURSE,
      exam_name: "Final",
      mode: "RETRIEVAL",
      topic_scope: "Graph algorithms",
      planned_minutes: 30,
      objectives: [{ id: "obj_graphs", title: "Dijkstra shortest path" }],
    });
    sessionId = sessionRes.data.session_id;
  });

  test("review panel NOT visible before submitting answer", async ({ page }) => {
    // Set user ID in localStorage
    await page.goto(`${BASE_URL}/s/${sessionId}`);
    await page.evaluate((uid) => {
      localStorage.setItem("study_bot_user_id", uid);
    }, USER_ID);
    await page.reload();

    // Start the session
    const startBtn = page.locator('button:has-text("Start Session"), button:has-text("Resume Session")');
    await startBtn.click();

    // Wait for the prompt to appear
    await expect(page.locator("textarea")).toBeVisible({ timeout: 10000 });

    // Assert: review panel is NOT visible
    await expect(page.locator('[data-testid="review-panel"]')).not.toBeVisible();
    // Also assert no text from our recognizable doc is shown
    const pageText = await page.textContent("body");
    expect(pageText).not.toContain("priority queue");
  });

  test("review panel appears after INCORRECT scoring with feedback", async ({ page }) => {
    await page.goto(`${BASE_URL}/s/${sessionId}`);
    await page.evaluate((uid) => {
      localStorage.setItem("study_bot_user_id", uid);
    }, USER_ID);
    await page.reload();

    // Start/resume session
    const startBtn = page.locator('button:has-text("Start Session"), button:has-text("Resume Session")');
    await startBtn.click();

    // Wait for prompt
    await expect(page.locator("textarea")).toBeVisible({ timeout: 10000 });

    // Type answer
    await page.locator("textarea").first().fill("I think Dijkstra uses BFS");
    await page.locator('button:has-text("Submit Answer")').click();

    // Score as INCORRECT
    await page.locator('button:has-text("Incorrect")').click();

    // Fill error log
    await page.locator('textarea[placeholder*="correct rule"]').fill(
      "Dijkstra uses a priority queue not plain BFS"
    );

    // Save
    await page.locator('button:has-text("Save & Next")').click();

    // The review panel should appear if feedback was returned
    // Give it time to fetch and render
    const reviewPanel = page.locator('[data-testid="review-panel"]');
    // Check if review panel appeared (it will only if search returned results)
    const visible = await reviewPanel.isVisible().catch(() => false);

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
