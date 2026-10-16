/**
 * Home for one student: the first-run card, exam countdowns with plan
 * progress, the Today card and the shell's Start session button, weak
 * spots, and the quiet stats line. Each test seeds its own identity through
 * the API, because Home shows everything on the account.
 *
 * Already covered elsewhere: the countdown and today maths in
 * src/__tests__/home-model.test.ts, and Home's empty-state axe scan in
 * shell.spec.ts. The filled Home is scanned in a11y-app.spec.ts.
 */
import {
  test,
  expect,
  MODE_LABELS,
  answerRun,
  createPlan,
  createSession,
  finishSession,
  hydrated,
  morningZone,
  openWhen,
  setItemStatus,
  unique,
} from "./fixtures";

test("a new student's Home leads to materials and a first plan", { tag: "@mobile" }, async ({ testUserPage: page }) => {
  await page.goto("/");
  const firstRun = page.getByRole("region", { name: "Plan for your first exam" });
  // The steps follow the form the one link opens: course and exam first, then materials.
  await expect(firstRun.getByRole("listitem")).toHaveText([
    /^Create a plan/,
    /^Upload your materials\s*On the same form/,
    /^Answer from memory/,
  ]);
  // No countdowns or weak spots before there is anything to count.
  await expect(page.getByRole("region", { name: "Exams" })).toHaveCount(0);

  // "New plan" is the link to the form; "Create plan" is only the form's submit button.
  await expect(firstRun.getByRole("link")).toHaveText(["New plan"]);
  await firstRun.getByRole("link", { name: "New plan" }).click();
  await expect(page).toHaveURL(/\/plan\/new$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("New plan");
  await expect(page.getByRole("button", { name: "Create plan" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Upload materials" })).toBeVisible();
});

test("exam countdowns show the days left and plan progress, nearest exam first", async ({
  testUserPage: page,
  testUser,
}) => {
  const later = await createPlan(testUser.api, { course_name: unique("E2E Home"), exam_name: "Final", exam_in_days: 20 });
  await createPlan(testUser.api, { course_name: unique("E2E Home"), exam_name: "Prelim 2", exam_in_days: 3 });
  // One session done and one missed in the later plan.
  await setItemStatus(testUser.api, later.id, later.items[0].id, "DONE");
  await setItemStatus(testUser.api, later.id, later.items[1].id, "MISSED");

  await page.goto("/");
  const exams = page.getByRole("region", { name: "Exams" });
  await expect(exams).toMatchAriaSnapshot(`
    - list:
      - listitem:
        - article "Prelim 2 is in 3 days"
      - listitem:
        - article "Final is in 20 days"
  `);

  const final = exams.getByRole("article", { name: "Final is in 20 days" });
  await expect(final.getByText(later.course, { exact: true })).toBeVisible();
  await expect(final.getByRole("progressbar", { name: "Final plan progress" })).toHaveAttribute(
    "aria-valuetext",
    `1 of ${later.items.length} sessions done`,
  );
  await expect(final.getByText("1 missed", { exact: true })).toBeVisible();

  // Reschedule on the card opens the plan's preview.
  await final.getByRole("link", { name: "Reschedule" }).click();
  await expect(page).toHaveURL(new RegExp(`/plan\\?plan=${later.id}&reschedule=1$`));
  await expect(page.getByRole("dialog", { name: "Reschedule sessions" })).toBeVisible();
});

test("the Today card starts today's first session", { tag: "@mobile" }, async ({ testUserPage: page, testUser }) => {
  const plan = await createPlan(testUser.api, {
    course_name: unique("E2E Today"),
    exam_name: "Prelim 1",
    time_zone: morningZone(),
    all_day: true,
  });
  const first = plan.items[0];

  await page.goto("/");
  const today = page.getByRole("region", { name: "Today" });
  await expect(today.getByRole("heading", { level: 3, name: MODE_LABELS[first.mode] })).toBeVisible();
  await expect(today.getByText(`${plan.course}, ${plan.exam}`)).toBeVisible();
  await expect(today.getByRole("link", { name: "Open plan" })).toHaveAttribute("href", "/plan");

  await today.getByRole("link", { name: "Start session" }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${first.session_id}$`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText(`${MODE_LABELS[first.mode]}:`);
  await expect(page.getByRole("button", { name: "Start session" })).toBeEnabled();
});

test("the Start button opens today's session from other screens", { tag: "@mobile" }, async ({
  testUserPage: page,
  testUser,
  isMobile,
}) => {
  const plan = await createPlan(testUser.api, { course_name: unique("E2E Start"), time_zone: morningZone(), all_day: true });
  const first = plan.items[0];
  const start = page.getByRole("link", { name: "Start today's session" });

  await page.goto("/");
  // Wide screens keep it in the rail; phones leave Home's corner to the Today card.
  await expect(start).toHaveCount(isMobile ? 0 : 1);

  await page.goto("/guides");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Study guides");
  await expect(start).toHaveAttribute("data-placement", isMobile ? "floating" : "rail");
  await expect(start).toHaveAttribute("href", `/s/${first.session_id}`);
  await start.click();
  await expect(page).toHaveURL(new RegExp(`/s/${first.session_id}$`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText(`${MODE_LABELS[first.mode]}:`);
});

test("weak spots offer a repair session and practice for a weak topic", async ({ testUserPage: page, testUser }) => {
  test.slow();
  const course = unique("E2E Weak");
  await createPlan(testUser.api, { course_name: course, objectives: ["Recursion", "Arrays", "Sorting"] });
  // Every answer on Recursion wrong: its errors stay unresolved and its mastery drops.
  const session = await createSession(testUser.api, {
    course_name: course,
    topic_scope: "Recursion",
    objectives: [{ id: "recursion", title: "Recursion" }],
  });
  await answerRun(testUser.api, session.id, [{ score: "INCORRECT" }]);

  const weakSpots = page.getByRole("region", { name: "Weak spots" });
  // Mastery is written just after the run completes.
  await openWhen(page, "/", weakSpots.getByRole("meter", { name: "Recursion mastery" }));
  const repair = page.getByRole("button", { name: `Repair ${course} errors` });
  const errorRow = weakSpots.getByRole("listitem").filter({ has: repair });
  await expect(errorRow).toContainText(course);
  await expect(errorRow).toContainText(/\d+ unresolved errors?/);
  const topicRow = weakSpots.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Practice Recursion" }) });
  await expect(topicRow.getByRole("meter", { name: "Recursion mastery" })).toBeVisible();
  await expect(topicRow).toContainText(course);

  const repairButton = errorRow.getByRole("button", { name: `Repair ${course} errors` });
  await hydrated(repairButton);
  await repairButton.click();
  await expect(page).toHaveURL(/\/s\/[\w-]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Error repair: Unresolved errors");
});

test("the stats line reports the streak, accuracy and time from the last 7 days", async ({
  testUserPage: page,
  testUser,
}) => {
  const course = unique("E2E Stats");
  await createPlan(testUser.api, { course_name: course });
  const session = await createSession(testUser.api, { course_name: course });
  await finishSession(testUser.api, session.id);

  const stats = page.getByRole("region", { name: "Study stats" });
  // XP, and with it the streak, is written just after the run completes.
  await openWhen(page, "/", stats.getByText("1-day streak"));
  await expect(stats).toMatchAriaSnapshot(`
    - list:
      - listitem: 1-day streak
      - listitem: /100%\\s*accuracy, last 7 days/
      - listitem: /Under 1 min\\s*answering questions, last 7 days/
    - link "See progress"
  `);
});
