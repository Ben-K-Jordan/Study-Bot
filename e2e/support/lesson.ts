/**
 * Locators for the lesson at /s/[sessionId], shared by the session specs.
 * Pick a choice or a confidence level with `pick` (support/page.ts).
 */
import type { Page } from "@playwright/test";

export type Verdict = "Correct" | "Partly correct" | "Incorrect";

/** "Question 2 of 4" in the top bar; it may carry the exam phase or ", 1 repair question added". */
export function questionCounter(page: Page, shown: number, total: number) {
  return page.getByRole("main").getByText(new RegExp(`^Question ${shown} of ${total}\\b`));
}

/** The answer box on a written question. */
export function answerBox(page: Page) {
  return page.getByRole("textbox", { name: "Your answer" });
}

/** A confidence level under "How sure are you?". */
export function confidenceRadio(page: Page, level: "Guessing" | "Unsure" | "Sure") {
  return page.getByRole("group", { name: "How sure are you?" }).getByRole("radio", { name: level, exact: true });
}

/** The feedback sheet, named for its verdict ("Correct" is inside the other two, hence exact). */
export function feedbackSheet(page: Page, verdict: Verdict) {
  return page.getByRole("region", { name: verdict, exact: true });
}

/** Score a written answer with one of the three buttons under "Score your answer". */
export async function scoreAs(page: Page, verdict: Verdict): Promise<void> {
  await page.getByRole("group", { name: "Score your answer" }).getByRole("button", { name: verdict, exact: true }).click();
}
