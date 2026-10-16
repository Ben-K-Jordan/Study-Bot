/**
 * Progress (/achievements): mastery by topic (weakest first, A to Z), the
 * Confidence section and its table, the streak and XP cards, the activity
 * heatmap's text summary and day list, and achievements. Each test seeds
 * its own identity through the API, because Progress shows the whole
 * account.
 *
 * Already covered elsewhere: calibration and heatmap maths in
 * src/__tests__/progress-model.test.ts, mastery in mastery.test.ts, XP and
 * streak rules in gamification.test.ts, and Progress's empty-state axe scan
 * in shell.spec.ts.
 */
import { test, expect, answerRun, createPlan, createSession, finishSession, hydrated, openWhen, unique } from "./fixtures";

test("mastery lists the weakest topic first and sorts A to Z on request", { tag: "@mobile" }, async ({
  testUserPage: page,
  testUser,
}) => {
  test.slow();
  const course = unique("E2E Mastery");
  await createPlan(testUser.api, { course_name: course, exam_name: "Prelim 1", objectives: ["Arrays", "Hashing", "Recursion"] });
  const arrays = await createSession(testUser.api, {
    course_name: course,
    topic_scope: "Arrays",
    objectives: [{ id: "arrays", title: "Arrays" }],
  });
  await answerRun(testUser.api, arrays.id, [{ score: "CORRECT" }]);
  const recursion = await createSession(testUser.api, {
    course_name: course,
    topic_scope: "Recursion",
    objectives: [{ id: "recursion", title: "Recursion" }],
  });
  await answerRun(testUser.api, recursion.id, [{ score: "INCORRECT" }]);

  const mastery = page.getByRole("region", { name: "Mastery by topic" });
  const card = mastery.getByRole("group", { name: course });
  // Mastery is written just after the run completes.
  await openWhen(page, "/achievements", card.getByRole("meter", { name: "Recursion mastery" }));
  await expect(card).toContainText("Prelim 1 is in 14 days");
  await expect(card).toContainText("0 of 3 topics mastered");
  await expect(card.getByRole("meter", { name: "Arrays mastery" })).toHaveAttribute("aria-valuenow", "100");

  const rows = card.getByRole("listitem");
  await expect(mastery.getByRole("radio", { name: "Weakest first" })).toBeChecked();
  await expect(rows).toHaveText([/^Recursion/, /^Arrays/, /^Hashing\s*Not practiced/]);
  await expect(card.getByRole("button", { name: "Practice Hashing" })).toBeVisible();

  await hydrated(mastery.getByRole("radio", { name: "A to Z" }));
  await mastery.getByRole("radio", { name: "A to Z" }).click();
  await expect(mastery.getByRole("radio", { name: "A to Z" })).toBeChecked();
  await expect(rows).toHaveText([/^Arrays/, /^Hashing/, /^Recursion/]);
});

test("Confidence compares how sure the student was with how often they were correct", async ({
  testUserPage: page,
  testUser,
}) => {
  const session = await createSession(testUser.api, { course_name: unique("E2E Confidence") });
  // Sure and correct, Sure and wrong, Guessing and correct.
  await answerRun(testUser.api, session.id, [
    { score: "CORRECT", confidence: 5 },
    { score: "INCORRECT", confidence: 5 },
    { score: "CORRECT", confidence: 1 },
  ]);

  await page.goto("/achievements");
  const confidence = page.getByRole("region", { name: "Confidence" });
  await expect(confidence.getByRole("heading", { level: 3, name: "All rated questions, last 12 weeks" })).toBeVisible();
  const table = confidence.getByRole("table");
  await expect(table.getByRole("columnheader")).toHaveText(["How sure", "Questions", "Correct"]);
  await expect(table.getByRole("rowheader")).toHaveText(["Sure", "Unsure", "Guessing"]);
  await expect(table.getByRole("row", { name: /^Sure/ }).getByRole("cell")).toHaveText(["2", /50%$/]);
  await expect(table.getByRole("row", { name: /^Unsure/ }).getByRole("cell")).toHaveText(["0", "No questions"]);
  await expect(table.getByRole("row", { name: /^Guessing/ }).getByRole("cell")).toHaveText(["1", /100%$/]);
  await expect(table.getByRole("progressbar", { name: "Correct when Sure" })).toHaveAttribute("aria-valuetext", "50%");

  await expect(confidence).toContainText(
    "Overconfident on 1 question: you marked it Sure and it wasn't fully correct. Errors you marked Sure come first in Error repair.",
  );
  await expect(confidence).toContainText("Underconfident on 1 question: you marked it Guessing and it was correct.");
  await expect(confidence).toContainText(
    "The weekly trend appears once you have rated questions from 2 different weeks.",
  );
});

test("a finished session shows in the streak, XP, activity and achievements", { tag: "@mobile" }, async ({
  testUserPage: page,
  testUser,
  isMobile,
}) => {
  const session = await createSession(testUser.api, { course_name: unique("E2E Streak") });
  await finishSession(testUser.api, session.id);

  const streakXp = page.getByRole("region", { name: "Streak and XP" });
  // XP, and with it the streak, is written just after the run completes.
  await openWhen(page, "/achievements", streakXp.getByText("1-day streak", { exact: true }));

  await test.step("streak and XP", async () => {
    await expect(streakXp.getByRole("status")).toHaveText("Today counts. Study tomorrow to keep it going.");
    await expect(streakXp.getByRole("progressbar", { name: "Daily XP goal" })).toHaveAttribute(
      "aria-valuetext",
      /^10 of \d+ XP today$/,
    );
    await expect(streakXp).toContainText("10 XP in total.");
  });

  await test.step("activity", async () => {
    const activity = page.getByRole("region", { name: "Activity" });
    // The squares are hidden from assistive technology; the sentence and the list carry the data.
    await expect(activity.getByText("Active on 1 day in the last 12 months.")).toBeVisible();
    const showList = activity.getByRole("button", { name: "Show study days as a list" });
    await hydrated(showList);

    const heatmap = activity.getByRole("region", { name: "Activity heatmap, last 12 months" });
    if (isMobile) {
      // A phone is narrower than the year, so the scroller is a tab stop. Focusing it
      // reads the summary and points to the list, since the squares themselves are silent.
      await expect(heatmap).toHaveAccessibleDescription(
        /^Active on 1 day in the last 12 months\. Each square is a day\..*show the study days as a list\.$/,
      );
      await heatmap.focus();
      await expect(heatmap).toBeFocused();
    } else {
      // At desktop width the whole year fits: no empty region and no extra tab stop.
      await expect(heatmap).toHaveCount(0);
    }

    await showList.click();
    await expect(activity.getByRole("button", { name: "Hide the list" })).toHaveAttribute("aria-expanded", "true");
    // A new identity has no plan or saved zone, so its days are UTC days: "Fri, Oct 16: 1 session".
    const today = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(
      new Date(),
    );
    await expect(activity.getByRole("listitem")).toHaveText([`${today}: 1 session`]);
  });

  await test.step("achievements", async () => {
    const achievements = page.getByRole("region", { name: "Achievements" });
    await expect(achievements).toContainText(
      "No achievements yet. The first comes with a 3-day streak or your first card review.",
    );
    await expect(achievements.getByRole("heading", { level: 3 })).toHaveText(["Streaks", "Flashcards", "XP"]);
    await expect(achievements.getByRole("progressbar", { name: "3-day streak progress" })).toHaveAttribute(
      "aria-valuetext",
      "1 of 3 days",
    );
    await expect(achievements.getByRole("progressbar", { name: "100 XP progress" })).toHaveAttribute(
      "aria-valuetext",
      "10 of 100 XP",
    );
  });
});
