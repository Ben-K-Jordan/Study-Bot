/**
 * Who can see what, through the proxy and the route handlers: signed-out
 * visitors, another student's data, unknown ids and cross-site writes.
 * The services' own ownership checks are covered by the integration tests;
 * these check the HTTP answers and the pages a browser lands on.
 */
import { test, expect, createPlan, createSession, startRun, unique, SIGNED_OUT } from "./fixtures";

test.describe("signed out", () => {
  test.use({ storageState: SIGNED_OUT });

  test("a page sends the visitor to sign in and keeps the address", async ({ page }) => {
    await page.goto("/plan?plan=abc");
    await expect(page).toHaveURL("/auth/signin?callbackUrl=%2Fplan%3Fplan%3Dabc");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  });

  test("the API answers 401 with a code", async ({ request }) => {
    for (const [method, url] of [
      ["GET", "/api/plans"],
      ["POST", "/api/sessions"],
      ["GET", "/api/stats/game"],
    ] as const) {
      const response = await request.fetch(url, { method, data: method === "POST" ? {} : undefined });
      expect(response.status(), `${method} ${url}`).toBe(401);
      expect(await response.json()).toMatchObject({ code: "UNAUTHORIZED" });
    }
  });

  test("the test header is ignored when it is empty", async ({ request }) => {
    const response = await request.get("/api/plans", { headers: { "X-User-Id": "" } });
    expect(response.status()).toBe(401);
  });
});

test.describe("another student's data", () => {
  // The owner is a fresh test identity; the intruder is the signed-in e2e account.

  test.describe(() => {
    // Chromium logs the 404 document response as a console error.
    test.use({ allowConsoleErrors: [/the server responded with a status of 404/] });

    test("their session page is not found", async ({ page, testUser }) => {
      const session = await createSession(testUser.api, { course_name: unique("E2E Private") });

      const response = await page.goto(session.url);
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { name: "Session not found" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Go to Home" })).toBeVisible();

      // The owner still opens it.
      const owner = await testUser.api.get(session.url);
      expect(owner.status()).toBe(200);
    });
  });

  test("their run and its attempts answer 403", async ({ request, testUser }) => {
    const session = await createSession(testUser.api, { course_name: unique("E2E Private") });
    const run = await startRun(testUser.api, session.id);

    expect((await request.get(`/api/runs/${run.run_id}`)).status()).toBe(403);
    const attempt = await request.post(`/api/runs/${run.run_id}/attempt`, {
      data: { prompt_index: 0, user_answer: "Not mine", self_score: "CORRECT" },
    });
    expect(attempt.status()).toBe(403);
  });

  test("their plan and its calendar file answer 403", async ({ request, testUser }) => {
    const plan = await createPlan(testUser.api, { course_name: unique("E2E Private plan") });

    expect((await request.get(`/api/plans/${plan.id}`)).status()).toBe(403);
    expect((await request.get(`/api/plans/${plan.id}/ics`)).status()).toBe(403);
    expect((await testUser.api.get(`/api/plans/${plan.id}`)).status()).toBe(200);
  });
});

test("unknown ids answer 404", async ({ request }) => {
  for (const url of ["/api/sessions/nonexistent_id", "/api/runs/nonexistent_run", "/api/plans/nonexistent_plan"]) {
    expect((await request.get(url)).status(), url).toBe(404);
  }
});

test("a write from another site answers 403", async ({ request }) => {
  const response = await request.post("/api/sessions", {
    headers: { Origin: "https://evil.example" },
    data: { course_name: "X", exam_name: "Y", mode: "RETRIEVAL", topic_scope: "Z", planned_minutes: 15 },
  });
  expect(response.status()).toBe(403);
});
