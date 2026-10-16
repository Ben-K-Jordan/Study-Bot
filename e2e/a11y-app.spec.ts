/**
 * Accessibility of the filled screens: axe (WCAG 2.0, 2.1 and 2.2, A and
 * AA) on Home, Plan, New plan, Materials, Study, Study guides and Progress
 * with real data, in the light and the dark theme, on both projects, and
 * with their dialogs open. Then keyboard use of the shell: the skip link,
 * the navigation rail, and the bottom bar's More sheet on phones.
 *
 * Already covered elsewhere: every destination's empty state with axe in
 * shell.spec.ts, and the session screens in session-runner.spec.ts.
 */
import type { Page } from "@playwright/test";
import {
  test,
  expect,
  answerRun,
  createGuide,
  createPlan,
  createSession,
  expectNoAxeViolations,
  finishSession,
  hydrated,
  morningZone,
  openWhen,
  setItemStatus,
  unique,
  uploadMaterial,
} from "./fixtures";

const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];

/** The app follows the system theme by default. */
async function emulateTheme(page: Page, colorScheme: Theme) {
  await page.emulateMedia({ colorScheme });
}

/** Check the theme took before axe looks. */
async function expectTheme(page: Page, colorScheme: Theme) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
    .toBe(colorScheme === "dark");
}

/** Opens `path` in the given theme. */
async function openIn(page: Page, path: string, colorScheme: Theme) {
  await emulateTheme(page, colorScheme);
  await page.goto(path);
  await expectTheme(page, colorScheme);
}

test.describe("filled screens pass axe in both themes", () => {
  test("Home", { tag: ["@a11y", "@mobile"] }, async ({ testUserPage: page, testUser }) => {
    const course = unique("E2E A11y Home");
    await createPlan(testUser.api, {
      course_name: course,
      objectives: ["Recursion", "Linked lists", "Hash tables"],
      time_zone: morningZone(),
      all_day: true,
    });
    const session = await createSession(testUser.api, {
      course_name: course,
      topic_scope: "Recursion",
      objectives: [{ id: "recursion", title: "Recursion" }],
    });
    // Two wrong answers marked Sure, then the rest correct and Unsure.
    await answerRun(testUser.api, session.id, [
      { score: "INCORRECT", confidence: 5 },
      { score: "INCORRECT", confidence: 5 },
      { score: "CORRECT", confidence: 3 },
    ]);

    for (const theme of THEMES) {
      await test.step(theme, async () => {
        await openIn(page, "/", theme);
        await expect(page.getByRole("button", { name: `Repair ${course} errors` })).toBeVisible();
        await expect(page.getByRole("region", { name: "Today" }).getByRole("link", { name: "Start session" })).toBeVisible();
        await expectNoAxeViolations(page, `Home (${theme})`);
      });
    }
  });

  test("Plan, with the reschedule preview open", { tag: ["@a11y", "@mobile"] }, async ({ testUserPage: page, testUser }) => {
    const course = unique("E2E A11y Plan");
    const plan = await createPlan(testUser.api, { course_name: course, objectives: ["Recursion", "Linked lists", "Hash tables"] });
    await setItemStatus(testUser.api, plan.id, plan.items[0].id, "DONE");
    await setItemStatus(testUser.api, plan.id, plan.items[1].id, "MISSED");
    await uploadMaterial(testUser.api, { course, text: "Linked lists: nodes that point to the next node." });

    for (const theme of THEMES) {
      await test.step(theme, async () => {
        await openIn(page, `/plan?plan=${plan.id}`, theme);
        await expect(page.getByRole("button", { name: /^Reschedule missed session: / })).toBeVisible();
        await expectNoAxeViolations(page, `Plan (${theme})`);

        await hydrated(page.getByRole("button", { name: "Reschedule sessions" }));
        await page.getByRole("button", { name: "Reschedule sessions" }).click();
        const dialog = page.getByRole("dialog", { name: "Reschedule sessions" });
        await expect(dialog.getByRole("button", { name: "Move 1 session" })).toBeVisible();
        await expectNoAxeViolations(page, `the reschedule preview (${theme})`);
      });
    }
  });

  test("New plan, with its field errors showing", { tag: ["@a11y", "@mobile"] }, async ({ testUserPage: page }) => {
    for (const theme of THEMES) {
      await test.step(theme, async () => {
        await openIn(page, "/plan/new", theme);
        await hydrated(page.getByRole("button", { name: "Create plan" }));
        await page.getByRole("button", { name: "Create plan" }).click();
        await expect(page.getByRole("alert").filter({ hasText: "Check the highlighted fields." })).toBeVisible();
        await expectNoAxeViolations(page, `New plan with field errors (${theme})`);
      });
    }
  });

  test("Materials, with the delete confirmation open", { tag: ["@a11y", "@mobile"] }, async ({
    testUserPage: page,
    testUser,
  }) => {
    const course = unique("E2E A11y Files");
    await uploadMaterial(testUser.api, { course, text: "Hash tables: keys map to buckets." });
    await uploadMaterial(testUser.api, { course, fileName: "raw.md", text: "Heaps.", process: false });

    for (const theme of THEMES) {
      await test.step(theme, async () => {
        await openIn(page, "/plan/materials", theme);
        await hydrated(page.getByRole("button", { name: "Summary of notes.txt" }));
        await page.getByRole("button", { name: "Summary of notes.txt" }).click();
        await expect(page.getByText("No summary for this file.", { exact: false })).toBeVisible();
        await expectNoAxeViolations(page, `Materials with a summary open (${theme})`);

        await page.getByRole("button", { name: "Delete notes.txt" }).click();
        await expect(page.getByRole("alertdialog", { name: "Delete notes.txt?" })).toBeVisible();
        await expectNoAxeViolations(page, `the Delete file dialog (${theme})`);
      });
    }
  });

  test("Study", { tag: ["@a11y", "@mobile"] }, async ({ testUserPage: page, testUser }) => {
    const course = unique("E2E A11y Study");
    await uploadMaterial(testUser.api, { course, text: "Sorting: merge sort splits, sorts and merges." });
    const session = await createSession(testUser.api, { course_name: course });
    await finishSession(testUser.api, session.id, { incorrect: 3 });

    for (const theme of THEMES) {
      await test.step(theme, async () => {
        await openIn(page, "/learn", theme);
        await expect(page.getByRole("heading", { level: 2, name: "Error repair" })).toBeVisible();
        await expect(page.getByRole("region", { name: "Course tools" }).getByRole("link", { name: /^Materials/ })).toContainText(
          "1 file ready",
        );
        await expectNoAxeViolations(page, `Study (${theme})`);
      });
    }
  });

  test("Study guides, with the delete confirmation open", { tag: ["@a11y", "@mobile"] }, async ({
    testUserPage: page,
    testUser,
  }) => {
    const course = unique("E2E A11y Guides");
    await uploadMaterial(testUser.api, { course, text: "Graphs: vertices joined by edges." });
    await createGuide(testUser.api, course);

    for (const theme of THEMES) {
      await test.step(theme, async () => {
        await openIn(page, "/guides", theme);
        await expect(page.getByRole("article", { name: `Key concepts for ${course}` })).toBeVisible();
        await expectNoAxeViolations(page, `Study guides (${theme})`);

        await page.getByRole("button", { name: "Delete guide" }).click();
        await expect(page.getByRole("alertdialog", { name: `Delete Key concepts for ${course}?` })).toBeVisible();
        await expectNoAxeViolations(page, `the Delete guide dialog (${theme})`);
      });
    }
  });

  test("Progress", { tag: ["@a11y", "@mobile"] }, async ({ testUserPage: page, testUser }) => {
    const course = unique("E2E A11y Progress");
    await createPlan(testUser.api, { course_name: course, objectives: ["Recursion", "Linked lists", "Hash tables"] });
    const session = await createSession(testUser.api, {
      course_name: course,
      topic_scope: "Recursion",
      objectives: [{ id: "recursion", title: "Recursion" }],
    });
    // One wrong answer marked Sure, then the rest correct and Unsure.
    await answerRun(testUser.api, session.id, [
      { score: "INCORRECT", confidence: 5 },
      { score: "CORRECT", confidence: 3 },
    ]);

    for (const theme of THEMES) {
      await test.step(theme, async () => {
        // Mastery and XP are written just after the run completes.
        await emulateTheme(page, theme);
        await openWhen(page, "/achievements", page.getByRole("meter", { name: "Recursion mastery" }));
        await expectTheme(page, theme);
        await expect(page.getByRole("region", { name: "Confidence" }).getByRole("table")).toBeVisible();
        await hydrated(page.getByRole("button", { name: "Show study days as a list" }));
        await page.getByRole("button", { name: "Show study days as a list" }).click();
        await expect(page.getByRole("button", { name: "Hide the list" })).toBeVisible();
        await expectNoAxeViolations(page, `Progress (${theme})`);
      });
    }
  });
});

test.describe("keyboard use of the shell", () => {
  test("the skip link is the first stop and moves focus to the page", { tag: ["@a11y", "@mobile"] }, async ({
    testUserPage: page,
  }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();

    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
    // The next stop is the page's own first control, past the navigation and the top app bar.
    await page.keyboard.press("Tab");
    await expect(page.getByRole("main").getByRole("link", { name: "Create plan" })).toBeFocused();
  });

  // Untagged, so only the desktop project runs it: the rail shows from 600px.
  test("the navigation rail takes Tab in order and opens a destination with Enter", async ({ testUserPage: page }) => {
    await page.goto("/");
    const rail = page.getByRole("navigation", { name: "Main" });
    await expect(rail.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");

    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
    for (const name of ["Home", "Plan", "Study", "Cards", "Guides", "Chat", "Progress", "Settings"]) {
      await page.keyboard.press("Tab");
      await expect(rail.getByRole("link", { name, exact: true })).toBeFocused();
    }

    await page.keyboard.press("Shift+Tab");
    await expect(rail.getByRole("link", { name: "Progress", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/achievements$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Progress");
    await expect(rail.getByRole("link", { name: "Progress", exact: true })).toHaveAttribute("aria-current", "page");
  });

  test("the bottom bar's More sheet opens, closes and navigates from the keyboard", { tag: ["@a11y", "@mobile"] }, async ({
    testUserPage: page,
    isMobile,
  }) => {
    test.skip(!isMobile, "The bottom bar shows under 600px");
    await page.goto("/");
    const bar = page.getByRole("navigation", { name: "Main" });
    await expect(bar.getByRole("link")).toHaveText(["Home", "Plan", "Study", "Cards"]);

    const more = bar.getByRole("button", { name: "More" });
    const sheet = page.getByRole("dialog", { name: "More" });
    await hydrated(more);
    await more.press("Enter");
    await expect(sheet.getByRole("link")).toHaveText(["Guides", "Chat", "Progress", "Settings"]);
    await expectNoAxeViolations(page, "the More sheet");

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(more).toBeFocused();

    await more.press("Enter");
    await sheet.getByRole("link", { name: "Progress" }).press("Enter");
    await expect(page).toHaveURL(/\/achievements$/);
    await expect(sheet).toBeHidden();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Progress");
    await expect(more).toHaveAttribute("aria-current", "page");
  });
});
