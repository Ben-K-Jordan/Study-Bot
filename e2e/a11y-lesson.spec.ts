/**
 * Axe (WCAG 2.0 to 2.2, A and AA) on the lesson, card and chat screens in
 * each state a student sees, in the light and the dark theme, on desktop
 * and on a phone: the session intro, a written question, its scoring, the
 * feedback sheet, the results; a multiple-choice question and its
 * feedback after a wrong pick; a deck page, the card review (front,
 * answer, completion); and Chat, empty and answered. It also checks that
 * popovers and dialogs give focus back to their button when Escape
 * closes them.
 *
 * session-runner.spec.ts runs axe on the intro, a question, the error log
 * and the results in the light theme on desktop; shell.spec.ts on every
 * destination's empty state.
 *
 * Multiple-choice questions come from a seeded deck (the `seedSession`
 * fixture), because the mock AI never writes a deck; that test needs
 * DATABASE_URL and skips without it (see support/db.ts).
 */
import {
  test,
  expect,
  QUESTIONS,
  answerBox,
  confidenceRadio,
  createDeck,
  createSession,
  expectNoAxeViolations,
  feedbackSheet,
  pick,
  scoreAs,
  unique,
  uploadMaterial,
} from "./fixtures";

const { overflow: OVERFLOW, recursiveCase: RECURSIVE_CASE } = QUESTIONS;

const NOTES = [
  "Recursion: a function that calls itself on a smaller input.",
  "A base case stops the recursion before the call stack overflows.",
  "Each recursive call gets its own frame on the call stack.",
].join("\n\n");

for (const theme of ["light", "dark"] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    test("the intro, a written question, its scoring, the feedback sheet and the results pass axe", { tag: ["@a11y", "@mobile"] }, async ({
      page,
      request,
    }) => {
      test.slow();
      const session = await createSession(request, { course_name: unique("E2E A11y"), questions: 2, target_accuracy: 0.8 });
      await page.goto(session.url);
      // The app follows the system theme, which test.use() sets.
      if (theme === "dark") await expect(page.locator("html")).toHaveClass(/\bdark\b/);
      else await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
      await expect(page.getByRole("button", { name: "Start session" })).toBeVisible();
      await expectNoAxeViolations(page, "the intro");

      await page.getByRole("button", { name: "Start session" }).click();
      await expect(answerBox(page)).toBeVisible();
      await expectNoAxeViolations(page, "a written question");

      for (const n of [1, 2]) {
        await answerBox(page).fill(`Answer ${n} from memory`);
        await pick(confidenceRadio(page, "Unsure"));
        await page.getByRole("button", { name: "Submit answer" }).click();
        await expect(page.getByRole("group", { name: "Score your answer" })).toBeVisible();
        if (n === 1) await expectNoAxeViolations(page, "scoring a written answer");
        await scoreAs(page, "Correct");
        const sheet = feedbackSheet(page, "Correct");
        await expect(sheet).toBeVisible();
        if (n === 1) {
          await expectNoAxeViolations(page, "the Correct feedback sheet");
          await sheet.getByRole("button", { name: "Next question" }).click();
        } else {
          await sheet.getByRole("button", { name: "See results" }).click();
        }
      }

      await expect(page.getByRole("heading", { level: 1, name: "Session complete" })).toBeVisible();
      await expect(page).toHaveTitle(`Session complete · ${session.course} · Study Bot`);
      // Finishing refreshes the page's server data in the background (router.refresh), and
      // the <title> is swapped when that lands, so axe could catch the page between titles.
      // The results the page serves from then on are the same screen.
      await page.reload();
      await expect(page.getByRole("region", { name: "Follow-up sessions" })).toBeVisible();
      await expectNoAxeViolations(page, "the results");
    });

    test("a multiple-choice question, its feedback after a wrong pick, and a model answer pass axe", { tag: ["@a11y", "@mobile"] }, async ({
      page,
      seedSession,
    }) => {
      const session = await seedSession({ course_name: unique("E2E A11y"), deck: [OVERFLOW, RECURSIVE_CASE] });
      await page.goto(session.url);
      await page.getByRole("button", { name: "Resume session" }).click();
      const options = page.getByRole("group", { name: OVERFLOW.text });
      await expect(options.getByRole("radio")).toHaveCount(4);
      await expectNoAxeViolations(page, "a multiple-choice question");

      await pick(options.getByRole("radio", { name: "The function returned too early" }));
      await pick(confidenceRadio(page, "Sure"));
      await page.getByRole("button", { name: "Submit answer" }).click();
      const sheet = feedbackSheet(page, "Incorrect");
      await expect(sheet).toContainText("Correct answer: The base case is never reached");
      // Focus lands on the continue button, so it carries the correction with it.
      await expect(sheet.getByRole("button", { name: "Next question" })).toHaveAccessibleDescription(
        /Correct answer: The base case is never reached/
      );
      await expect(page.getByRole("region", { name: "Why your answer is tempting" })).toBeVisible();
      await expectNoAxeViolations(page, "the Incorrect feedback sheet");

      await sheet.getByRole("button", { name: "Next question" }).click();
      await answerBox(page).fill("It calls itself on a smaller input");
      await page.getByRole("button", { name: "Submit answer" }).click();
      await expect(page.getByRole("region", { name: "Model answer" })).toContainText(RECURSIVE_CASE.modelAnswer);
      await expectNoAxeViolations(page, "a model answer to score against");
    });

    test("a deck page and the card review pass axe", { tag: ["@a11y", "@mobile"] }, async ({ testUser, testUserPage: page }) => {
      const deck = await createDeck(testUser.api);
      await page.goto(`/flashcards/${deck.id}`);
      await expect(page.getByRole("heading", { level: 2, name: deck.title })).toBeVisible();
      await expect(page.getByRole("region", { name: "Cards", exact: true }).getByRole("listitem")).toHaveCount(3);
      await expectNoAxeViolations(page, "the deck page");

      await page.goto(`/flashcards/${deck.id}/review`);
      const front = page.getByRole("heading", { level: 1 });
      await expect(front).toHaveText(deck.cards[0].front);
      await expectNoAxeViolations(page, "a card's front");

      for (const [i, card] of deck.cards.entries()) {
        await expect(front).toHaveText(card.front);
        await page.getByRole("button", { name: "Show answer" }).click();
        await expect(page.getByRole("region", { name: "Answer" })).toBeVisible();
        if (i === 0) await expectNoAxeViolations(page, "a card's answer and the ratings");
        await page.getByRole("group", { name: "How well did you know it?" }).getByRole("button", { name: /^Good\b/ }).click();
      }
      await expect(page.getByRole("heading", { level: 1, name: "Deck reviewed" })).toBeVisible();
      await expectNoAxeViolations(page, "the completion screen");
    });

    test("Chat passes axe, empty and with an answer", { tag: ["@a11y", "@mobile"] }, async ({ account }) => {
      const { page, api } = account;
      const course = unique("E2E Chat");
      await uploadMaterial(api, { course, fileName: "recursion.txt", text: NOTES });
      await page.goto("/chat");
      const box = page.getByRole("textbox", { name: `Ask about your ${course} materials` });
      await expect(page.getByRole("heading", { level: 2, name: `No questions about ${course} yet` })).toBeVisible();
      await expectNoAxeViolations(page, "an empty chat");

      await box.fill("What is recursion?");
      await box.press("Enter");
      const answer = page.getByRole("article", { name: "Study Bot answered" });
      await expect(answer.getByRole("group", { name: "Sources (1)" })).toBeVisible();
      await answer.getByRole("button", { name: "Source 1: recursion.txt" }).click();
      await expectNoAxeViolations(page, "an answer with a source open");
    });
  });
}

test.describe("Escape gives focus back", () => {
  test("the session's keyboard shortcuts close on Escape, back to their button", { tag: "@a11y" }, async ({ page, request }) => {
    const session = await createSession(request, { course_name: unique("E2E A11y") });
    await page.goto(session.url);
    await page.getByRole("button", { name: "Start session" }).click();
    await expect(page.getByRole("textbox", { name: "Your answer" })).toBeFocused();

    const help = page.getByRole("button", { name: "Keyboard shortcuts" });
    await help.click();
    const popover = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(popover).toBeVisible();
    await expectNoAxeViolations(page, "the keyboard shortcuts popover");
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();
    await expect(help).toBeFocused();
  });

  test("the deck page's dialogs close on Escape, back to what opened them", { tag: "@a11y" }, async ({ testUser, testUserPage: page }) => {
    const deck = await createDeck(testUser.api);
    await page.goto(`/flashcards/${deck.id}`);
    await expect(page.getByRole("region", { name: "Cards", exact: true }).getByRole("listitem")).toHaveCount(3);

    await test.step("Add cards", async () => {
      const add = page.getByRole("main").getByRole("button", { name: "Add cards" });
      await add.click();
      const dialog = page.getByRole("dialog", { name: "Add cards" });
      await expect(dialog).toBeVisible();
      await expectNoAxeViolations(page, "the Add cards dialog");
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(add).toBeFocused();
    });

    await test.step("Delete card", async () => {
      const remove = page.getByRole("button", { name: "Delete card 1" });
      await remove.click();
      const dialog = page.getByRole("alertdialog", { name: "Delete this card?" });
      await expect(dialog).toContainText("This deletes the card and its review history.");
      await expectNoAxeViolations(page, "the Delete card dialog");
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(remove).toBeFocused();
      await expect(page.getByRole("region", { name: "Cards", exact: true }).getByRole("listitem")).toHaveCount(3);
    });

    await test.step("Delete deck, from the actions menu", async () => {
      const more = page.getByRole("button", { name: `More actions for ${deck.title}` });
      await more.click();
      await page.getByRole("menuitem", { name: "Delete deck" }).click();
      const dialog = page.getByRole("alertdialog", { name: `Delete ${deck.title}?` });
      await expect(dialog).toContainText("This deletes the deck and its 3 cards, with their review history.");
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(more).toBeFocused();
    });
  });

  test("the card review's keyboard shortcuts close on Escape, back to their button", { tag: "@a11y" }, async ({ testUser, testUserPage: page }) => {
    const deck = await createDeck(testUser.api);
    await page.goto(`/flashcards/${deck.id}/review`);
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
    const help = page.getByRole("button", { name: "Keyboard shortcuts" });
    await help.click();
    const popover = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(popover).toBeVisible();
    await expectNoAxeViolations(page, "the review's keyboard shortcuts popover");
    await page.keyboard.press("Escape");
    await expect(popover).toBeHidden();
    await expect(help).toBeFocused();
  });
});
