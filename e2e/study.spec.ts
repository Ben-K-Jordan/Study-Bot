/**
 * Study (/learn): the recommended session card with its mode and reason in
 * plain words, the mode and length pickers, Start session (one session
 * even on a double click), the course it opens on when none is chosen, and
 * Resume session on a planned session that is under way.
 * Each test seeds its own identity, because Study picks its course from the
 * account's materials and plans.
 *
 * Already covered elsewhere: the recommendation rules and reason copy in
 * src/__tests__/study-recommendations.test.ts, and the session screens in
 * the session-*.spec.ts files.
 */
import type { Page, Request } from "@playwright/test";
import {
  test,
  expect,
  MODE_LABELS,
  createPlan,
  createSession,
  finishSession,
  morningZone,
  startRun,
  unique,
  uploadMaterial,
} from "./fixtures";

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

test("with no course chosen, Study opens on the course with the nearest exam, not the latest upload", async ({
  testUserPage: page,
  testUser,
}) => {
  test.slow();
  const examCourse = unique("E2E Exam soon");
  const latestCourse = unique("E2E Latest upload");
  await uploadMaterial(testUser.api, { course: examCourse, text: "Recursion: a function that calls itself." });
  await createPlan(testUser.api, { course_name: examCourse, exam_in_days: 7 });
  // Uploaded last, so it heads the course list.
  await uploadMaterial(testUser.api, { course: latestCourse, text: "Supply and demand set the price." });

  await page.goto("/learn");
  const switcher = page.getByRole("combobox", { name: "Course" });
  await expect(switcher).toHaveText(examCourse);
  await expect(page.getByRole("main")).toContainText("Final exam is in 7 days");

  // A course the student picks wins from then on.
  await switcher.click();
  await page.getByRole("option", { name: latestCourse }).click();
  await expect(switcher).toHaveText(latestCourse);
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Course" })).toHaveText(latestCourse);
});

test("a planned session with a run under way offers Resume session, as Home does", async ({
  testUserPage: page,
  testUser,
}) => {
  const course = unique("E2E Resume");
  await uploadMaterial(testUser.api, { course, text: "Hash tables: keys map to buckets through a hash function." });
  // A morning zone and an all-day window, so sessions are left today whenever the suite runs.
  const plan = await createPlan(testUser.api, { course_name: course, time_zone: morningZone(), all_day: true });
  const first = plan.items[0];
  const label = MODE_LABELS[first.mode];
  // Starting the run doesn't touch the plan item; the run is what Study has to read.
  await startRun(testUser.api, first.session_id);

  await page.goto("/learn");
  await expect(page.getByRole("combobox", { name: "Course" })).toHaveText(course);
  const planned = page.getByRole("region", { name: "Planned for today" });
  const resume = planned.getByRole("link", { name: new RegExp(`^Resume session: ${label}, `) });
  await expect(resume).toHaveText("Resume session");
  await expect(resume).toHaveAttribute("href", `/s/${first.session_id}`);
  await expect(planned.locator(`a[href="/s/${first.session_id}"]`)).toHaveCount(1);

  await page.goto("/");
  await expect(page.getByRole("region", { name: "Today" }).getByRole("link", { name: "Resume session" })).toHaveAttribute(
    "href",
    `/s/${first.session_id}`,
  );

  await page.goto(`/s/${first.session_id}`);
  await expect(page.getByRole("button", { name: "Resume session" })).toBeVisible();
});
