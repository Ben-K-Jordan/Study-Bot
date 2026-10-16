/**
 * The study loop in /s/[sessionId]: the session intro, answering and
 * scoring questions, logging an error, resuming after a reload, and the
 * results screen. Each test makes its own session in its own course, so a
 * logged error never turns up as a repair question in another test.
 */
import { test as base, expect, createSession, startRun, answerQuestion, unique, type CreatedSession } from "./fixtures";
import type { Page } from "@playwright/test";

/** A new 3-question Retrieval session in its own course, for each test. */
const test = base.extend<{ session: CreatedSession }>({
  session: async ({ request }, provide) => {
    await provide(await createSession(request, { course_name: unique("E2E 101"), target_accuracy: 0.7 }));
  },
});

/** The answer box on the question screen. */
const answerBox = (page: Page) => page.getByRole("textbox", { name: "Your answer" });

/** "Question 2 of 4" in the top bar (it may carry ", 1 repair question added"). */
const counter = (page: Page, shown: number, total: number) =>
  page.getByRole("main").getByText(new RegExp(`^Question ${shown} of ${total}\\b`));

async function answerAndScore(page: Page, answer: string, score: "Correct" | "Partly correct" | "Incorrect") {
  await answerBox(page).fill(answer);
  await page.getByRole("button", { name: "Submit answer" }).click();
  await page.getByRole("group", { name: "Score your answer" }).getByRole("button", { name: score, exact: true }).click();
}

test.describe("study session", () => {
  test("the intro names the session and starts on question 1", { tag: "@mobile" }, async ({ page, session }) => {
    await page.goto(session.url);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Retrieval: End-to-end testing");
    const main = page.getByRole("main");
    await expect(main.getByText(session.course)).toBeVisible();
    await expect(main.getByText("Final exam")).toBeVisible();
    await expect(main.getByRole("definition").filter({ hasText: "3 questions" })).toBeVisible();
    await expect(page).toHaveTitle(`Retrieval · ${session.course} · Study Bot`);

    await page.getByRole("button", { name: "Start session" }).click();
    await expect(counter(page, 1, 3)).toBeVisible();
    await expect(answerBox(page)).toBeFocused();
    await expect(page.getByRole("button", { name: "Submit answer" })).toBeDisabled();
    await expect(page).toHaveTitle(`Question 1 of 3 · ${session.course} · Study Bot`);
  });

  test("answer, log an error, resume after a reload and see the results", { tag: "@mobile" }, async ({ page, session }) => {
    // One student going through one session: every step needs the last.
    test.slow();
    await page.goto(session.url);
    await page.getByRole("button", { name: "Start session" }).click();

    await test.step("a correct answer keeps question 1 on screen until Next question", async () => {
      await answerAndScore(page, "Page navigation routes between views", "Correct");
      const sheet = page.getByRole("region", { name: "Correct", exact: true });
      await expect(sheet).toBeVisible();
      await expect(counter(page, 1, 3)).toBeVisible();
      await sheet.getByRole("button", { name: "Next question" }).click();
      await expect(counter(page, 2, 3)).toBeVisible();
    });

    await test.step("an incorrect answer asks for a correction rule and adds a repair question", async () => {
      await answerAndScore(page, "Forms submit themselves", "Incorrect");
      const errorLog = page.getByRole("region", { name: "Log the error" });
      await expect(errorLog).toBeVisible();

      // Saving without a rule says what's missing beside the field.
      const rule = errorLog.getByRole("textbox", { name: "Correction rule" });
      await page.getByRole("button", { name: "Save correction" }).click();
      await expect(rule).toHaveAttribute("aria-invalid", "true");
      await expect(rule).toHaveAccessibleDescription(/Write the correction rule first\./);

      await rule.fill("Forms need validation before they submit");
      await page.getByRole("button", { name: "Save correction" }).click();

      const sheet = page.getByRole("region", { name: "Incorrect", exact: true });
      await expect(sheet).toBeVisible();
      await expect(page.getByRole("region", { name: "Your correction" })).toContainText(
        "Forms need validation before they submit",
      );
      // The deck grows by one and says so; the answered question stays on screen.
      await expect(counter(page, 2, 4)).toBeVisible();
      await expect(page.getByRole("main").getByText("1 repair question added")).toBeVisible();
      await sheet.getByRole("button", { name: "Next question" }).click();
      await expect(counter(page, 3, 4)).toBeVisible();
      await expect(page.getByText("Repair question. It retests an error from earlier in this session.")).toBeVisible();
    });

    await test.step("a reload offers Resume session and returns to the same question", async () => {
      await page.reload();
      await expect(page.getByText("2 of 4 questions answered. Your answers are saved.")).toBeVisible();
      await page.getByRole("button", { name: "Resume session" }).click();
      await expect(counter(page, 3, 4)).toBeVisible();
    });

    await test.step("the last answer offers See results instead of Next question", async () => {
      await answerAndScore(page, "The rule is to validate first", "Correct");
      await page.getByRole("button", { name: "Next question" }).click();
      await expect(counter(page, 4, 4)).toBeVisible();
      await answerAndScore(page, "Steps: plan, act, check", "Correct");
      await expect(page.getByRole("button", { name: "Next question" })).toBeHidden();
      await page.getByRole("button", { name: "See results" }).click();
    });

    await test.step("the results screen shows accuracy and follow-up sessions", async () => {
      await expect(page.getByRole("heading", { level: 1, name: "Session complete" })).toBeVisible();
      // 3 of 4 graded questions correct, one error, one repair question.
      await expect(page.getByRole("region", { name: "Session stats" })).toMatchAriaSnapshot(`
        - term: Accuracy
        - definition: 75%
        - term: Questions
        - definition: "4"
        - term: Time answering
        - definition: /.+/
        - term: Errors logged
        - definition: "1"
        - term: Repair questions
        - definition: "1"
      `);
      await expect(page.getByRole("heading", { level: 2, name: "Follow-up sessions" })).toBeVisible();
      await expect(page).toHaveTitle(`Session complete · ${session.course} · Study Bot`);
    });
  });

  test("a finished session opens on its results", { tag: "@a11y" }, async ({ page, request, session, makeAxeBuilder }) => {
    const run = await startRun(request, session.id);
    for (let i = 0; i < 3; i++) await answerQuestion(request, run.run_id, i, "CORRECT");

    await page.goto(session.url);
    await expect(page.getByRole("heading", { level: 1, name: "Session complete" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Session stats" })).toMatchAriaSnapshot(`
      - term: Accuracy
      - definition: 100%
    `);
    await expect(page.getByRole("button", { name: "Start session again" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to Home" })).toHaveAttribute("href", "/");
    expect((await makeAxeBuilder().analyze()).violations).toEqual([]);
  });

  test("the intro, a question and the error log pass axe", { tag: "@a11y" }, async ({ page, session, makeAxeBuilder }) => {
    await page.goto(session.url);
    await expect(page.getByRole("button", { name: "Start session" })).toBeVisible();
    expect((await makeAxeBuilder().analyze()).violations).toEqual([]);

    await page.getByRole("button", { name: "Start session" }).click();
    await expect(answerBox(page)).toBeVisible();
    expect((await makeAxeBuilder().analyze()).violations).toEqual([]);

    await answerAndScore(page, "An answer", "Incorrect");
    await expect(page.getByRole("region", { name: "Log the error" })).toBeVisible();
    expect((await makeAxeBuilder().analyze()).violations).toEqual([]);
  });
});
