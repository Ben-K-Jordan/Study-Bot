/**
 * Plan screens: New plan (upload through the keyboard file picker,
 * validation, typed topics), the plan as dated days with statuses,
 * Reschedule sessions, Export calendar (.ics), Replace plan and Delete
 * plan. Each test seeds its own identity, so Plan's default plan and its
 * empty state belong to the test.
 *
 * Already covered elsewhere: scheduling, replace-after-create and reflow
 * rules in src/__tests__/integration/plan-flow.test.ts and
 * reflow-api.test.ts, the .ics headers and links in api-contract.spec.ts,
 * and opening a session from the list in plan-to-session.spec.ts.
 */
import { readFile } from "node:fs/promises";
import type { APIRequestContext } from "@playwright/test";
import {
  test,
  expect,
  MODE_LABELS,
  TIME_ZONE,
  createPlan,
  isoDay,
  hydrated,
  setItemStatus,
  toasts,
  unique,
  type CreatedPlan,
  type PlanItem,
} from "./fixtures";

const EXAM = "Prelim 1";

/** "Friday, October 16": how the plan names a day (calendar keys are read at noon UTC). */
function dayHeading(value: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone }).format(
    new Date(value),
  );
}

/** "Retrieval, 9:00 – 9:30 AM", the session link's name, as a pattern (Intl puts thin spaces in ranges). */
function sessionLinkName(item: PlanItem): RegExp {
  const parts = (value: string) =>
    new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: TIME_ZONE })
      .format(new Date(value))
      .split(/\s/);
  const [startTime, startHalf] = parts(item.start_time);
  const [endTime, endHalf] = parts(item.end_time);
  return new RegExp(`^${MODE_LABELS[item.mode]}, ${startTime}(\\s${startHalf})?\\s–\\s${endTime}\\s${endHalf}$`);
}

async function listPlans(api: APIRequestContext): Promise<{ plan_id: string; course_name: string; items: PlanItem[] }[]> {
  const response = await api.get("/api/plans");
  expect(response.status()).toBe(200);
  return (await response.json()).plans;
}

/** A Prelim 1 plan in New York, 9:00 to 17:00 every day, with at least 3 sessions. */
async function seedPlan(api: APIRequestContext, course: string): Promise<CreatedPlan> {
  const plan = await createPlan(api, { course_name: course, exam_name: EXAM });
  expect(plan.items.length).toBeGreaterThan(2);
  return plan;
}

test("Create plan uses a file chosen with the keyboard and opens the new plan", { tag: "@mobile" }, async ({
  testUserPage: page,
}) => {
  test.slow();
  const course = unique("E2E New plan");
  await page.goto("/plan/new");
  await expect(page.getByRole("heading", { level: 2, name: "Plan for an exam" })).toBeVisible();

  const dropzone = page.getByRole("group", { name: "Upload materials" });
  const chooseFiles = dropzone.getByRole("button", { name: "Choose files" });
  // Files are saved to a course, so the picker waits for one.
  await expect(chooseFiles).toBeDisabled();
  await expect(dropzone).toContainText("Enter the course name first. Files are saved to that course.");

  await hydrated(page.getByRole("combobox", { name: "Course" }));
  await page.getByRole("combobox", { name: "Course" }).fill(course);
  await page.getByRole("textbox", { name: "Exam", exact: true }).fill("Prelim 1");
  await page.getByRole("textbox", { name: "Exam date" }).fill(isoDay(10));
  await expect(chooseFiles).toBeEnabled();

  await test.step("choose a file with the keyboard", async () => {
    const chooser = page.waitForEvent("filechooser");
    await chooseFiles.press("Enter");
    await (await chooser).setFiles({
      name: "lecture-1.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Recursion\n\nA recursive function calls itself on a smaller input until it reaches a base case."),
    });
    const row = page.getByRole("listitem").filter({ hasText: "lecture-1.md" });
    await expect(row).toContainText(`Saved to ${course}, Prelim 1`);
    await expect(row).toContainText("Ready");
  });

  await page.getByRole("button", { name: "Create plan" }).click();
  await expect(page).toHaveURL(/\/plan\?plan=[\w-]+$/);
  await expect(page.getByRole("heading", { level: 2, name: `${course} Prelim 1` })).toBeVisible();
  await expect(page.getByRole("main").getByText(/^Prelim 1 is in 10 days: /)).toBeVisible();
  await expect(toasts(page)).toContainText(/Plan created\. \d+ sessions? between today and Prelim 1/);
  const materials = page.getByRole("region", { name: "Materials" });
  await expect(materials.getByRole("listitem").filter({ hasText: "lecture-1.md" })).toContainText("Ready");
});

test("New plan names each missing field and sends nothing until they are fixed", async ({ testUserPage: page }) => {
  const course = unique("E2E Checks");
  const creates: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/plans") creates.push(request.url());
  });
  await page.goto("/plan/new");
  const create = page.getByRole("button", { name: "Create plan" });
  const problem = page.getByRole("alert").filter({ hasText: "Check the highlighted fields." });
  const courseBox = page.getByRole("combobox", { name: "Course" });

  await test.step("an empty form", async () => {
    await hydrated(create);
    await create.click();
    await expect(problem).toBeVisible();
    await expect(courseBox).toBeFocused();
    await expect(courseBox).toHaveAttribute("aria-invalid", "true");
    await expect(courseBox).toHaveAccessibleDescription(/Enter a course name\./);
    await expect(page.getByRole("textbox", { name: "Exam", exact: true })).toHaveAccessibleDescription(
      /Enter an exam name\./,
    );
    await expect(page.getByRole("textbox", { name: "Exam date" })).toHaveAccessibleDescription(/Choose the exam date\./);
  });

  await test.step("no materials and no topics", async () => {
    await courseBox.fill(course);
    await page.getByRole("textbox", { name: "Exam", exact: true }).fill("Prelim 1");
    await page.getByRole("textbox", { name: "Exam date" }).fill(isoDay(12));
    await create.click();
    await expect(page.getByRole("main").getByText("Upload materials, or type at least 3 topics instead.")).toBeVisible();
  });

  await test.step("too few typed topics", async () => {
    await page.getByRole("checkbox", { name: "Type topics instead" }).check();
    const topics = page.getByRole("textbox", { name: "Topics" });
    await topics.fill("Recursion\nGraphs");
    await expect(topics).toHaveAccessibleDescription(/2 typed\./);
    await create.click();
    await expect(topics).toBeFocused();
    await expect(topics).toHaveAccessibleDescription(/Type at least 3 topics, one per line\./);
    expect(creates).toHaveLength(0);
  });

  await page.getByRole("textbox", { name: "Topics" }).fill("Recursion\nGraphs\nSorting");
  await create.click();
  await expect(page.getByRole("heading", { level: 2, name: `${course} Prelim 1` })).toBeVisible();
  expect(creates).toHaveLength(1);
});

test("the plan lists its sessions by day with each one's status", { tag: "@mobile" }, async ({
  testUserPage: page,
  testUser,
}) => {
  const plan = await seedPlan(testUser.api, unique("E2E Days"));
  const [done, missed] = plan.items;
  await setItemStatus(testUser.api, plan.id, done.id, "DONE");
  await setItemStatus(testUser.api, plan.id, missed.id, "MISSED");
  const total = plan.items.length;

  await page.goto(`/plan?plan=${plan.id}`);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 2, name: `${plan.course} Prelim 1` })).toBeVisible();
  await expect(main.getByText(/^Prelim 1 is in 14 days: \w{3}, \w{3} \d{1,2}\.$/)).toBeVisible();

  const progress = main.getByRole("region", { name: "Progress" });
  await expect(progress.getByRole("progressbar", { name: "Plan progress" })).toHaveAttribute(
    "aria-valuetext",
    `1 of ${total} sessions done`,
  );
  await expect(progress.getByRole("listitem")).toHaveText(["1 done", "1 missed", `${total - 2} scheduled`]);

  const sessions = main.getByRole("region", { name: "Sessions" });
  await expect(sessions.getByText(`${total} sessions in this plan`)).toBeVisible();
  const days = sessions.getByRole("list", { name: "Prelim 1 sessions by day" });

  const doneDay = days.getByRole("listitem", { name: new RegExp(`^${dayHeading(done.start_time, TIME_ZONE)}`) });
  const doneRow = doneDay.getByRole("listitem").filter({ has: page.getByRole("link", { name: sessionLinkName(done) }) });
  await expect(doneRow).toContainText("Done");

  const missedDay = days.getByRole("listitem", { name: new RegExp(`^${dayHeading(missed.start_time, TIME_ZONE)}`) });
  const missedRow = missedDay
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { name: sessionLinkName(missed) }) });
  await expect(missedRow).toContainText("Missed");
  await expect(missedRow.getByRole("button", { name: /^Reschedule missed session: / })).toBeVisible();

  const examDay = days.getByRole("listitem", {
    name: `${dayHeading(`${plan.examDate}T12:00:00Z`, "UTC")}, exam day`,
  });
  await expect(examDay).toContainText("Exam day: Prelim 1");
});

test("Reschedule sessions previews the move and applies it after confirming", { tag: "@mobile" }, async ({
  testUserPage: page,
  testUser,
}) => {
  const plan = await seedPlan(testUser.api, unique("E2E Reschedule"));
  const missed = plan.items[1];
  await setItemStatus(testUser.api, plan.id, missed.id, "MISSED");
  const statusOf = async () =>
    (await listPlans(testUser.api)).find((p) => p.plan_id === plan.id)?.items.find((i) => i.id === missed.id)?.status;

  await page.goto(`/plan?plan=${plan.id}`);
  const reschedule = page.getByRole("button", { name: "Reschedule sessions" });
  await hydrated(reschedule);
  await reschedule.click();

  const dialog = page.getByRole("dialog", { name: "Reschedule sessions" });
  await expect(dialog).toContainText("Nothing changes until you confirm.");
  await expect(dialog.getByRole("status").filter({ hasText: /^1 session moves and \d+ stays?\.$/ })).toBeVisible();
  const moves = dialog.getByRole("region", { name: "New times" });
  await expect(moves.getByRole("listitem")).toHaveCount(1);
  await expect(moves.getByRole("listitem")).toContainText(MODE_LABELS[missed.mode]);
  await expect(moves.getByRole("listitem")).toContainText("Missed");
  // The preview moves nothing.
  expect(await statusOf()).toBe("MISSED");

  await dialog.getByRole("button", { name: "Move 1 session" }).click();
  await expect(dialog).toBeHidden();
  await expect(toasts(page)).toContainText("1 session moved");
  await expect(reschedule).toBeFocused();
  await expect(page.getByRole("region", { name: "Progress" }).getByRole("listitem")).toHaveText([
    "0 done",
    `${plan.items.length} scheduled`,
  ]);
  expect(await statusOf()).toBe("RESCHEDULED");
});

test("Reschedule sessions previews afresh after leaving the plan and coming back", async ({
  testUserPage: page,
  testUser,
}) => {
  // Each visit to a plan used to restart the preview's cache key, so coming
  // back served the first visit's preview from the cache.
  const plan = await seedPlan(testUser.api, unique("E2E Fresh preview"));
  const other = await seedPlan(testUser.api, unique("E2E Other plan"));
  await setItemStatus(testUser.api, plan.id, plan.items[1].id, "MISSED");

  await page.goto(`/plan?plan=${plan.id}`);
  const reschedule = page.getByRole("button", { name: "Reschedule sessions" });
  const dialog = page.getByRole("dialog", { name: "Reschedule sessions" });
  const summary = dialog.getByRole("status").filter({ hasText: /sessions? moves?/ });
  await hydrated(reschedule);
  await reschedule.click();
  await expect(summary).toHaveText(/^1 session moves and \d+ stays?\.$/);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  await test.step("open the other plan, miss another session, and come back", async () => {
    const plans = page.getByRole("navigation", { name: "Plans" });
    await plans.getByRole("link", { name: new RegExp(other.course) }).click();
    await expect(page.getByRole("heading", { level: 2, name: `${other.course} Prelim 1` })).toBeVisible();
    await setItemStatus(testUser.api, plan.id, plan.items[2].id, "MISSED");
    await plans.getByRole("link", { name: new RegExp(plan.course) }).click();
    await expect(page.getByRole("heading", { level: 2, name: `${plan.course} Prelim 1` })).toBeVisible();
  });

  await hydrated(reschedule);
  await reschedule.click();
  await expect(summary).toHaveText(/^2 sessions move and \d+ stays?\.$/);
  await expect(dialog.getByRole("region", { name: "New times" }).getByRole("listitem")).toHaveCount(2);
  await expect(dialog.getByRole("button", { name: "Move 2 sessions" })).toBeVisible();
});

test("Export calendar downloads the plan as an .ics file", async ({ testUserPage: page, testUser }) => {
  const plan = await seedPlan(testUser.api, unique("E2E Export"));
  await page.goto(`/plan?plan=${plan.id}`);

  const exportButton = page.getByRole("button", { name: "Export calendar (.ics)" });
  await hydrated(exportButton);
  const download = page.waitForEvent("download");
  await exportButton.click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/-plan\.ics$/);
  await expect(toasts(page)).toContainText("Calendar file exported");

  // Unfold the 75-octet lines before matching.
  const ics = (await readFile(await file.path(), "utf8")).replace(/\r\n[ \t]/g, "");
  expect(ics).toMatch(/^BEGIN:VCALENDAR/);
  expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(plan.items.length);
  expect(ics.match(new RegExp(`^SUMMARY:.*${plan.course} Prelim 1$`, "gm"))).toHaveLength(plan.items.length);
  for (const item of plan.items) expect(ics).toContain(`/s/${item.session_id}`);
});

test("Replace plan asks first, then swaps the old plan for the new one", async ({ testUserPage: page, testUser }) => {
  test.slow();
  const plan = await seedPlan(testUser.api, unique("E2E Replace"));
  const plansFor = async () =>
    (await listPlans(testUser.api)).filter((p) => p.course_name === plan.course).map((p) => p.plan_id);

  await page.goto(`/plan?plan=${plan.id}`);
  const more = page.getByRole("button", { name: "More actions for the Prelim 1 plan" });
  await hydrated(more);
  await more.click();
  await page.getByRole("menuitem", { name: "Replace plan" }).click();

  await expect(page).toHaveURL(new RegExp(`/plan/new\\?replace=${plan.id}$`));
  await expect(page.getByRole("heading", { level: 2, name: `Replace the ${plan.course} Prelim 1 plan` })).toBeVisible();
  await expect(page).toHaveTitle(`Replace ${plan.course} Prelim 1 plan · Study Bot`);
  await expect(page.getByRole("combobox", { name: "Course" })).toHaveValue(plan.course);
  await expect(page.getByRole("textbox", { name: "Exam", exact: true })).toHaveValue("Prelim 1");
  await expect(page.getByRole("textbox", { name: "Exam date" })).toHaveValue(plan.examDate);
  await hydrated(page.getByRole("checkbox", { name: "Type topics instead" }));
  await page.getByRole("checkbox", { name: "Type topics instead" }).check();
  await page.getByRole("textbox", { name: "Topics" }).fill("Recursion\nGraphs\nSorting");

  const create = page.getByRole("button", { name: "Create plan" });
  const dialog = page.getByRole("alertdialog", { name: `Replace your ${plan.course} plan?` });
  await test.step("Cancel keeps the current plan", async () => {
    await create.click();
    await expect(dialog).toContainText(
      `Creating this plan deletes the current one for Prelim 1 and its ${plan.items.length} remaining sessions.`,
    );
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(create).toBeFocused();
    expect(await plansFor()).toEqual([plan.id]);
  });

  await create.click();
  await dialog.getByRole("button", { name: "Replace plan" }).click();
  await expect(page).toHaveURL(/\/plan\?plan=[\w-]+$/);
  await expect(page).not.toHaveURL(new RegExp(plan.id));
  await expect(page.getByRole("heading", { level: 2, name: `${plan.course} Prelim 1` })).toBeVisible();
  const remaining = await plansFor();
  expect(remaining).toHaveLength(1);
  expect(remaining[0]).not.toBe(plan.id);

  await page.goto(`/plan?plan=${plan.id}`);
  await expect(page.getByRole("main").getByText("This plan doesn't exist anymore.")).toBeVisible();
});

test("Delete plan asks first and removes the plan", { tag: "@mobile" }, async ({ testUserPage: page, testUser }) => {
  const plan = await seedPlan(testUser.api, unique("E2E Delete"));
  await page.goto(`/plan?plan=${plan.id}`);
  const more = page.getByRole("button", { name: "More actions for the Prelim 1 plan" });
  const dialog = page.getByRole("alertdialog", { name: "Delete the Prelim 1 plan?" });

  await test.step("Cancel keeps it", async () => {
    await hydrated(more);
    await more.click();
    await page.getByRole("menuitem", { name: "Delete plan" }).click();
    await expect(dialog).toContainText(
      `Its ${plan.items.length} remaining sessions come off your schedule. Your answers and progress stay, and so do events already in Google Calendar.`,
    );
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(more).toBeFocused();
  });

  await more.click();
  await page.getByRole("menuitem", { name: "Delete plan" }).click();
  await dialog.getByRole("button", { name: "Delete plan" }).click();
  await expect(toasts(page)).toContainText("Prelim 1 plan deleted");
  await expect(page).toHaveURL(/\/plan$/);
  await expect(page.getByRole("heading", { level: 2, name: "No plan yet" })).toBeVisible();
  expect(await listPlans(testUser.api)).toEqual([]);
});
