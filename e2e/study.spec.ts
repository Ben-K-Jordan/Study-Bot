/**
 * Study (/learn): the recommended session card with its mode and reason in
 * plain words, the mode and length pickers, and Start session (one session
 * even on a double click). Each test seeds its own identity, because Study
 * picks its course from the account's materials.
 *
 * Already covered elsewhere: the recommendation rules and reason copy in
 * src/__tests__/study-recommendations.test.ts, and the session screens in
 * the session-*.spec.ts files.
 */
import type { Page, Request } from "@playwright/test";
import { test, expect, createSession, finishSession, unique, uploadMaterial } from "./fixtures";

/** The recommendation card: the one section with the Start session button. */
function sessionCard(page: Page) {
  return page
    .getByRole("main")
    .getByRole("region")
    .filter({ has: page.getByRole("button", { name: /^Start(ing)? session/ }) });
}

function isStart(request: Request): boolean {
  return request.method() === "POST" && new URL(request.url()).pathname === "/api/learn/start";
}

test("the recommendation names its mode and reason in plain words", { tag: "@mobile" }, async ({
  testUserPage: page,
  testUser,
}) => {
  const course = unique("E2E Study");
  await uploadMaterial(testUser.api, { course, text: "Recursion: a function that calls itself until a base case." });
  // Three wrong answers leave three unresolved errors, so Error repair comes first.
  const session = await createSession(testUser.api, { course_name: course });
  await finishSession(testUser.api, session.id, { incorrect: 3 });

  await page.goto("/learn");
  await expect(page.getByRole("combobox", { name: "Course" })).toHaveText(course);
  const card = sessionCard(page);
  await expect(card.getByRole("heading", { level: 2 })).toHaveText("Error repair");
  await expect(card.getByText("Recommended", { exact: true })).toBeVisible();
  await expect(card).toContainText("Retests your 3 unresolved errors");
  await expect(card).toContainText(
    "All are memory gaps. An error is resolved after you answer it correctly on 2 different days.",
  );
  // No stored codes or keys reach the student.
  await expect(card).not.toContainText(/\b[A-Z]{2,}(_[A-Z]+)+\b|\bMEMORY\b/);
  await expect(card).not.toContainText(/\b[a-z0-9]+_[a-z0-9_]+\b/);
  await expect(page.getByRole("main").getByText("3 unresolved errors", { exact: true })).toBeVisible();
});

test("the mode and length can change before the session starts", async ({ testUserPage: page, testUser }) => {
  test.slow();
  const course = unique("E2E Modes");
  await uploadMaterial(testUser.api, { course, text: "Sorting: merge sort splits, sorts and merges." });
  const session = await createSession(testUser.api, { course_name: course });
  await finishSession(testUser.api, session.id, { incorrect: 3 });

  await page.goto("/learn");
  const card = sessionCard(page);
  await expect(card.getByRole("heading", { level: 2 })).toHaveText("Error repair");

  await card.getByRole("radio", { name: "Retrieval", exact: true }).check();
  await expect(card.getByRole("heading", { level: 2 })).toHaveText("Retrieval");
  // The recommendation stays visible beside the mode it names.
  await expect(card.getByRole("radio", { name: "Error repair Recommended" })).not.toBeChecked();
  await expect(card).toContainText("Error repair is the recommended mode.");

  const length = card.getByRole("radiogroup", { name: "Length" });
  await expect(length.getByRole("radio", { name: "30 min" })).toBeChecked();
  await length.getByRole("radio", { name: "15 min" }).click();
  await expect(length.getByRole("radio", { name: "15 min" })).toBeChecked();
  await expect(card).toContainText("About 5 questions.");
  await expect(card).toContainText("Retrieval, 15 min");

  await card.getByRole("button", { name: "Start session" }).click();
  await expect(page).toHaveURL(/\/s\/[\w-]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Retrieval:");
  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - term: Planned time
    - definition: 15 min
  `);
});

test("Start session makes one session on a double click and opens it", { tag: "@mobile" }, async ({
  testUserPage: page,
  testUser,
}) => {
  const course = unique("E2E Start");
  await uploadMaterial(testUser.api, { course, text: "Graphs: vertices joined by edges." });
  const starts: Request[] = [];
  page.on("request", (request) => {
    if (isStart(request)) starts.push(request);
  });

  await page.goto("/learn");
  const card = sessionCard(page);
  await expect(card.getByRole("heading", { level: 2 })).toHaveText("Retrieval");
  await expect(card).toContainText(`You haven't practiced ${course} yet.`);

  await card.getByRole("button", { name: "Start session" }).dblclick();
  await expect(page).toHaveURL(/\/s\/[\w-]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Retrieval:");
  await expect(page.getByRole("button", { name: "Start session" })).toBeEnabled();
  expect(starts).toHaveLength(1);

  // The server hands back the same unstarted session for the same request.
  const sessionId = new URL(page.url()).pathname.split("/").pop();
  const again = await testUser.api.post("/api/learn/start", {
    data: { course_name: course, mode: "RETRIEVAL", minutes: 30 },
  });
  expect(again.status(), await again.text()).toBe(200);
  expect(await again.json()).toMatchObject({ session_id: sessionId, reused: true });
});
