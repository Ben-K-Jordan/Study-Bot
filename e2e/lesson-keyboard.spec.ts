/**
 * The lesson by keyboard alone: a whole short session, number keys for
 * the choices and Q, W and E for confidence (as the key hints show),
 * Ctrl+Enter for written answers and corrections, 1 to 3 to score, Enter
 * to move on, keys typed into an answer staying in the answer, and the
 * keyboard shortcuts popover with its switch for single-key shortcuts.
 *
 * The key map itself is unit-tested (src/components/session/runner/hotkeys
 * and use-question-hotkeys); this spec checks the keys reach the real
 * screens. Before any key press the test waits for the focus the screen
 * sets on mount, which also means its key listener is in place.
 *
 * Multiple-choice questions come from a seeded deck (the `seedSession`
 * fixture), because the mock AI never writes a deck; those tests need
 * DATABASE_URL and skip without it (see support/db.ts).
 */
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import {
  test,
  expect,
  QUESTIONS,
  answerBox,
  confidenceRadio,
  createSession,
  getJson,
  hydrated,
  questionCounter,
  unique,
  type SeedQuestion,
} from "./fixtures";

const { baseCase: BASE_CASE, overflow: OVERFLOW, recursiveCase: RECURSIVE_CASE } = QUESTIONS;

interface StoredAttempt {
  self_score: string | null;
  confidence_rating: number | null;
}

/** The run's stored attempts. */
async function storedAttempts(api: APIRequestContext, runId: string): Promise<StoredAttempt[]> {
  return (await getJson<{ attempts: StoredAttempt[] }>(api, `/api/runs/${runId}`)).attempts;
}

const options = (page: Page, question: SeedQuestion) => page.getByRole("group", { name: question.text });

const shortcutsDialog = (page: Page) => page.getByRole("dialog", { name: "Keyboard shortcuts" });

/** Press Tab once per stop, checking that each one takes focus in turn. */
async function tabTo(page: Page, stops: Locator[]) {
  for (const stop of stops) {
    await page.keyboard.press("Tab");
    await expect(stop).toBeFocused();
  }
}

test("a whole short session by keyboard alone", async ({ page, request, seedSession }) => {
  test.slow();
  const session = await seedSession({ course_name: unique("E2E Keys"), deck: [BASE_CASE, RECURSIVE_CASE] });
  await page.goto(session.url);
  await hydrated(page.getByRole("button", { name: "Resume session" }));

  await test.step("Tab reaches Resume session after the skip link and Leave session", async () => {
    await tabTo(page, [
      page.getByRole("link", { name: "Skip to main content" }),
      page.getByRole("link", { name: "Leave session" }),
      page.getByRole("button", { name: "Resume session" }),
    ]);
    await page.keyboard.press("Enter");
  });

  await test.step("multiple choice: 1 picks, W rates Unsure, Enter submits and Enter moves on", async () => {
    await expect(options(page, BASE_CASE).getByRole("radio").first()).toBeFocused();
    await page.keyboard.press("1");
    await page.keyboard.press("w");
    await expect(options(page, BASE_CASE).getByRole("radio", { name: "The base case" })).toBeChecked();
    await expect(confidenceRadio(page, "Unsure")).toBeChecked();
    await page.keyboard.press("Enter");

    const next = page.getByRole("region", { name: "Correct", exact: true }).getByRole("button", { name: "Next question" });
    await expect(next).toBeFocused();
    await page.keyboard.press("Enter");
  });

  await test.step("free recall: type, Ctrl+Enter shows the model answer, 1 scores it Correct", async () => {
    await expect(questionCounter(page, 2, 2)).toBeVisible();
    await expect(answerBox(page)).toBeFocused();
    await page.keyboard.type("It calls itself on a smaller input");
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(page.getByRole("region", { name: "Model answer" })).toBeVisible();
    await page.keyboard.press("1");

    const results = page.getByRole("region", { name: "Correct", exact: true }).getByRole("button", { name: "See results" });
    await expect(results).toBeFocused();
    await page.keyboard.press("Enter");
  });

  await test.step("the results take focus, and Enter on the intro starts the session again", async () => {
    const heading = page.getByRole("heading", { level: 1, name: "Session complete" });
    await expect(heading).toBeFocused();
    await expect(page.getByRole("region", { name: "Session stats" })).toMatchAriaSnapshot(`
      - term: Accuracy
      - definition: 100%
    `);
    const attempts = await storedAttempts(request, session.runId);
    expect(attempts.map((a) => [a.self_score, a.confidence_rating])).toEqual([
      ["CORRECT", 3],
      ["CORRECT", null],
    ]);

    // No plan in this course, so the follow-ups offer Create plan before the footer.
    await tabTo(page, [
      page.getByRole("region", { name: "Follow-up sessions" }).getByRole("link", { name: "Create plan" }),
      page.getByRole("button", { name: "Start session again" }),
    ]);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
    await expect(page.getByRole("button", { name: "Start session" })).toBeVisible();
    // Enter anywhere on the intro (here the focused heading) starts it.
    await page.keyboard.press("Enter");
    await expect(questionCounter(page, 1, 2)).toBeVisible();
  });
});

test("number keys pick the option their hint shows, and Q, W and E rate how sure you are", async ({ page, request, seedSession }) => {
  const session = await seedSession({ course_name: unique("E2E Keys"), deck: [BASE_CASE] });
  await page.goto(session.url);
  await page.getByRole("button", { name: "Resume session" }).click();
  const group = options(page, BASE_CASE);
  const sure = page.getByRole("group", { name: "How sure are you?" });
  await expect(group.getByRole("radio").first()).toBeFocused();

  // Each option shows its number key, and each confidence level its letter.
  for (const hint of ["1", "2", "3", "4"]) await expect(group.getByText(hint, { exact: true })).toBeVisible();
  for (const hint of ["Q", "W", "E"]) await expect(sure.getByText(hint, { exact: true })).toBeVisible();

  for (const [key, choice] of [
    ["3", "The return type"],
    ["4", "The parameter list"],
    ["2", "The recursive call"],
    ["1", "The base case"],
  ] as const) {
    await page.keyboard.press(key);
    const radio = group.getByRole("radio", { name: choice });
    await expect(radio).toBeChecked();
    await expect(radio).toBeFocused();
  }
  for (const [key, level] of [
    ["q", "Guessing"],
    ["e", "Sure"],
  ] as const) {
    await page.keyboard.press(key);
    await expect(confidenceRadio(page, level)).toBeChecked();
  }

  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Correct", exact: true })).toBeVisible();
  expect(await storedAttempts(request, session.runId)).toEqual([
    expect.objectContaining({ self_score: "CORRECT", confidence_rating: 5 }),
  ]);
});

test("keys typed into an answer stay there; Ctrl+Enter submits and saves the correction", async ({ page, request }) => {
  const session = await createSession(request, { course_name: unique("E2E Keys") });
  await page.goto(session.url);
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(answerBox(page)).toBeFocused();

  await page.keyboard.type("1 2 3 q w e ?");
  await expect(answerBox(page)).toHaveValue("1 2 3 q w e ?");
  for (const level of ["Guessing", "Unsure", "Sure"] as const) await expect(confidenceRadio(page, level)).not.toBeChecked();
  await expect(shortcutsDialog(page)).toBeHidden();

  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByRole("group", { name: "Score your answer" })).toBeVisible();
  await page.keyboard.press("3");

  const rule = page.getByRole("region", { name: "Log the error" }).getByRole("textbox", { name: "Correction rule" });
  await expect(rule).toBeFocused();
  await page.keyboard.type("Answer from the notes, not from guesses");
  await page.keyboard.press("ControlOrMeta+Enter");

  const next = page.getByRole("region", { name: "Incorrect", exact: true }).getByRole("button", { name: "Next question" });
  await expect(next).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(questionCounter(page, 2, 4)).toBeVisible();
});

test("? opens the keyboard shortcuts, and turning off single-key shortcuts stops the number keys", async ({ page, seedSession }) => {
  test.slow();
  const session = await seedSession({ course_name: unique("E2E Keys"), deck: [BASE_CASE, OVERFLOW] });
  await page.goto(session.url);
  await page.getByRole("button", { name: "Resume session" }).click();
  const first = options(page, BASE_CASE).getByRole("radio").first();
  await expect(first).toBeFocused();

  await test.step("? opens the list, Escape closes it and focus goes back to the answer", async () => {
    await page.keyboard.press("?");
    await expect(shortcutsDialog(page)).toBeVisible();
    await expect(shortcutsDialog(page).getByRole("definition")).toContainText([
      "Choose an answer",
      "Rate how sure you are: Guessing, Unsure, Sure",
      "Submit your choice, then go to the next question",
    ]);
    await page.keyboard.press("Escape");
    await expect(shortcutsDialog(page)).toBeHidden();
    await expect(first).toBeFocused();
  });

  await test.step("the switch turns off single-key shortcuts", async () => {
    const help = page.getByRole("button", { name: "Keyboard shortcuts" });
    await help.click();
    const single = shortcutsDialog(page).getByRole("switch", { name: "Single-key shortcuts" });
    await expect(single).toBeChecked();
    await single.click();
    await expect(single).not.toBeChecked();
    await page.keyboard.press("Escape");
    await expect(help).toBeFocused();

    // The number hints go, and the keys do nothing.
    await expect(options(page, BASE_CASE).getByText("1", { exact: true })).toHaveCount(0);
    await first.focus();
    await page.keyboard.press("2");
    await page.keyboard.press("e");
    await page.keyboard.press("?");
    await expect(options(page, BASE_CASE).getByRole("radio", { checked: true })).toHaveCount(0);
    await expect(confidenceRadio(page, "Sure")).not.toBeChecked();
    await expect(shortcutsDialog(page)).toBeHidden();
  });

  await test.step("Space and Enter still work, and the choice is remembered", async () => {
    await page.keyboard.press("Space");
    await expect(first).toBeChecked();
    await page.keyboard.press("Enter");
    await page.getByRole("region", { name: "Correct", exact: true }).getByRole("button", { name: "Next question" }).click();
    await expect(questionCounter(page, 2, 2)).toBeVisible();

    await page.reload();
    await page.getByRole("button", { name: "Resume session" }).click();
    await expect(options(page, OVERFLOW).getByRole("radio").first()).toBeFocused();
    await expect(options(page, OVERFLOW).getByText("1", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
    await expect(shortcutsDialog(page).getByRole("switch", { name: "Single-key shortcuts" })).not.toBeChecked();
  });
});
