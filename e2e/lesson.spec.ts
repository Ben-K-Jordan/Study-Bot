/**
 * The lesson at /s/[sessionId], screen by screen: the intro, multiple
 * choice, free recall with its model answer and error log, the repair
 * question an error adds, the last answer's feedback and the results
 * (confidence, follow-up sessions), leaving, resuming after a reload,
 * exam simulation, and one question on a phone.
 *
 * session-runner.spec.ts already covers the basic free-recall loop and the
 * results stats; session-results.spec.ts the results of each mode. The
 * scoring, grading and deck rules are covered by the integration tests
 * (full-flow, mode-parity, exam-sim). Keyboard use is in
 * lesson-keyboard.spec.ts and axe in a11y-lesson.spec.ts.
 *
 * Multiple choice and model answers come from a seeded deck (the
 * `seedSession` fixture), because the mock AI never writes a deck; those
 * tests need DATABASE_URL and skip without it (see support/db.ts).
 */
import type { APIRequestContext, Page } from "@playwright/test";
import {
  test,
  expect,
  QUESTIONS,
  answerBox,
  answerQuestion,
  confidenceRadio,
  createPlan,
  createSession,
  feedbackSheet,
  getJson,
  hydrated,
  pick,
  questionCounter,
  scoreAs,
  startRun,
  unique,
} from "./fixtures";

const { baseCase: BASE_CASE, overflow: OVERFLOW, recursiveCase: RECURSIVE_CASE, whyBaseCase: WHY_BASE_CASE } = QUESTIONS;

/** The exam simulation phase beside the counter: "Answering" or "Scoring". */
const phase = (page: Page, label: "Answering" | "Scoring") => page.getByRole("main").getByText(label, { exact: true });

interface StoredRun {
  attempts: { prompt_index: number; user_answer: string; self_score: string | null; confidence_rating: number | null }[];
  error_logs: { prompt_index: number; error_type: string; correction_rule: string; variant_question: string | null }[];
}

/** The run as the server stored it: attempts and error logs. */
const storedRun = (api: APIRequestContext, runId: string) => getJson<StoredRun>(api, `/api/runs/${runId}`);

test.describe("the session intro", () => {
  test("shows the mode, topics, question count and Start session", { tag: "@mobile" }, async ({ page, request }) => {
    const session = await createSession(request, {
      course_name: unique("E2E Intro"),
      exam_name: "Prelim 1",
      mode: "INTERLEAVED_PRACTICE",
      topic_scope: "Recursion and stacks",
      planned_minutes: 25,
      questions: 4,
      target_accuracy: 0.8,
      objectives: [
        { id: "recursion", title: "Recursion" },
        { id: "stacks", title: "Stacks" },
      ],
    });
    await page.goto(session.url);

    const main = page.getByRole("main");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Interleaved practice: Recursion and stacks");
    await expect(main.getByText("Questions from different topics, mixed together.")).toBeVisible();
    await expect(main.getByText(session.course)).toBeVisible();
    await expect(main.getByRole("definition").filter({ hasText: /^4 questions/ })).toBeVisible();
    await expect(main.getByRole("definition").filter({ hasText: "25 min" })).toBeVisible();
    await expect(main.getByRole("definition").filter({ hasText: "80%" })).toBeVisible();
    await expect(main.getByRole("term").filter({ hasText: "Topics" })).toBeVisible();
    await expect(main.getByRole("definition").filter({ hasText: "Recursion and Stacks" })).toBeVisible();
    // Topics nobody has studied yet open the deck with a pretest question, and the intro says so first.
    await expect(main.getByRole("note")).toContainText("1 pretest question");

    await page.getByRole("button", { name: "Start session" }).click();
    await expect(questionCounter(page, 1, 4)).toBeVisible();
    await expect(main.getByText(/^Pretest\. You haven't studied this topic yet/)).toBeVisible();
  });
});

test.describe("answering", () => {
  test("multiple choice says Correct for the right pick and shows the answer after a wrong one", async ({
    page,
    request,
    seedSession,
  }) => {
    const session = await seedSession({ course_name: unique("E2E Choice"), deck: [BASE_CASE, OVERFLOW] });
    await page.goto(session.url);
    await expect(page.getByText("0 of 2 questions answered. Your answers are saved.")).toBeVisible();
    await page.getByRole("button", { name: "Resume session" }).click();

    await test.step("a right pick", async () => {
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(BASE_CASE.text);
      const options = page.getByRole("group", { name: BASE_CASE.text });
      await expect(options.getByRole("radio")).toHaveCount(4);
      await expect(page.getByRole("button", { name: "Submit answer" })).toBeDisabled();

      await pick(options.getByRole("radio", { name: "The base case" }));
      await page.getByRole("button", { name: "Submit answer" }).click();

      await expect(feedbackSheet(page, "Correct")).toBeVisible();
      await expect(feedbackSheet(page, "Correct")).not.toContainText("Correct answer:");
      await expect(options.getByRole("radio", { name: "The base case Correct answer" })).toBeChecked();
      await feedbackSheet(page, "Correct").getByRole("button", { name: "Next question" }).click();
    });

    await test.step("a wrong pick marked Sure", async () => {
      await expect(questionCounter(page, 2, 2)).toBeVisible();
      const options = page.getByRole("group", { name: OVERFLOW.text });
      await pick(options.getByRole("radio", { name: "The function returned too early" }));
      await pick(confidenceRadio(page, "Sure"));
      await page.getByRole("button", { name: "Submit answer" }).click();

      const wrong = feedbackSheet(page, "Incorrect");
      await expect(wrong).toContainText("Correct answer: The base case is never reached");
      await expect(options.getByRole("radio", { name: "The base case is never reached Correct answer" })).toBeVisible();
      await expect(options.getByRole("radio", { name: "The function returned too early Incorrect" })).toBeChecked();

      // Below the question: why the pick tempts (AI-written) and the confident-error note.
      const feedback = page.getByRole("region", { name: "Feedback from your materials" });
      const tempting = feedback.getByRole("region", { name: "Why your answer is tempting" });
      await expect(tempting).toContainText("AI-written");
      await expect(tempting).toContainText(OVERFLOW.rationales[0]);
      await expect(feedback.getByRole("heading", { name: "Confident error" })).toBeVisible();

      // The error brings a repair question to the end of the deck.
      await expect(questionCounter(page, 2, 3)).toBeVisible();
      await expect(page.getByRole("main").getByText("1 repair question added")).toBeVisible();
    });

    await test.step("the server graded both picks and logged the error", async () => {
      const run = await storedRun(request, session.runId);
      expect(run.attempts.map((a) => [a.self_score, a.confidence_rating])).toEqual([
        ["CORRECT", null],
        ["INCORRECT", 5],
      ]);
      expect(run.error_logs).toHaveLength(1);
      expect(run.error_logs[0].correction_rule).toContain('The correct answer is "The base case is never reached".');
    });
  });

  test("free recall shows the model answer, and a partial score logs the error and adds a repair question", async ({
    page,
    request,
    seedSession,
  }) => {
    test.slow();
    const session = await seedSession({ course_name: unique("E2E Recall"), deck: [RECURSIVE_CASE, WHY_BASE_CASE] });
    await page.goto(session.url);
    await page.getByRole("button", { name: "Resume session" }).click();

    await test.step("Submit answer reveals the model answer to score against", async () => {
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(RECURSIVE_CASE.text);
      await expect(page.getByRole("button", { name: "Submit answer" })).toBeDisabled();
      await answerBox(page).fill("It calls the function again with less input");
      await page.getByRole("button", { name: "Submit answer" }).click();

      await expect(page.getByRole("region", { name: "Your answer" })).toContainText("It calls the function again with less input");
      const model = page.getByRole("region", { name: "Model answer" });
      await expect(model).toContainText("AI-written");
      await expect(model).toContainText(RECURSIVE_CASE.modelAnswer);
      await expect(model.getByRole("list", { name: "Points to check" }).getByRole("listitem")).toHaveText(RECURSIVE_CASE.keyPoints);

      await scoreAs(page, "Correct");
      await expect(feedbackSheet(page, "Correct")).toBeVisible();
      await feedbackSheet(page, "Correct").getByRole("button", { name: "Next question" }).click();
    });

    await test.step("Partly correct asks for the error type and a correction rule", async () => {
      await expect(questionCounter(page, 2, 2)).toBeVisible();
      await answerBox(page).fill("So the function knows when to stop");
      await page.getByRole("button", { name: "Submit answer" }).click();
      await scoreAs(page, "Partly correct");

      const errorLog = page.getByRole("region", { name: "Log the error" });
      await expect(errorLog).toContainText("You scored this partly correct.");
      await pick(errorLog.getByRole("group", { name: "Error type" }).getByRole("radio", { name: "Memory gap" }));
      await errorLog.getByRole("textbox", { name: "Correction rule" }).fill("A base case stops the calls before the stack overflows");
      await errorLog.getByRole("textbox", { name: "Similar question (optional)" }).fill("What happens without a base case?");
      await page.getByRole("button", { name: "Save correction" }).click();

      await expect(feedbackSheet(page, "Partly correct")).toBeVisible();
      const correction = page.getByRole("region", { name: "Your correction" });
      await expect(correction).toContainText("A base case stops the calls before the stack overflows");
      await expect(correction).toContainText("Similar question: What happens without a base case?");
      await expect(questionCounter(page, 2, 3)).toBeVisible();
    });

    await test.step("the repair question says what it retests", async () => {
      await feedbackSheet(page, "Partly correct").getByRole("button", { name: "Next question" }).click();
      await expect(questionCounter(page, 3, 3)).toBeVisible();
      await expect(page.getByText("Repair question. It retests an error from earlier in this session.")).toBeVisible();
      // A memory gap is retested by explaining the idea again.
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(WHY_BASE_CASE.text);
      await expect(page.getByRole("main")).toContainText("From memory: explain the idea behind this question");
      const original = page.getByRole("button", { name: "Show the original question" });
      await original.click();
      await expect(original).toHaveAttribute("aria-expanded", "true");
    });

    await test.step("the server stored the scores and the error log", async () => {
      const run = await storedRun(request, session.runId);
      expect(run.attempts.map((a) => a.self_score)).toEqual(["CORRECT", "PARTIAL"]);
      expect(run.error_logs).toEqual([
        expect.objectContaining({
          prompt_index: 1,
          error_type: "MEMORY",
          correction_rule: "A base case stops the calls before the stack overflows",
          variant_question: "What happens without a base case?",
        }),
      ]);
    });
  });
});

test.describe("finishing", () => {
  test("the last answer's feedback comes before See results, then the results and follow-ups", async ({ page, request }) => {
    test.slow();
    const course = unique("E2E Results");
    const plan = await createPlan(request, { course_name: course });
    const session = await createSession(request, { course_name: course, questions: 3 });
    await page.goto(session.url);
    await page.getByRole("button", { name: "Start session" }).click();

    await test.step("answer all 3, each marked Sure and scored Correct", async () => {
      for (let n = 1; n <= 3; n++) {
        await expect(questionCounter(page, n, 3)).toBeVisible();
        await answerBox(page).fill(`Answer ${n} from memory`);
        await pick(confidenceRadio(page, "Sure"));
        await page.getByRole("button", { name: "Submit answer" }).click();
        await scoreAs(page, "Correct");
        await expect(feedbackSheet(page, "Correct")).toBeVisible();
        if (n < 3) await feedbackSheet(page, "Correct").getByRole("button", { name: "Next question" }).click();
      }
    });

    await test.step("the last answer's feedback shows, with See results instead of Next question", async () => {
      await expect(page.getByRole("region", { name: "Your answer" })).toContainText("Answer 3 from memory");
      await expect(feedbackSheet(page, "Correct").getByRole("button", { name: "Next question" })).toHaveCount(0);
      await feedbackSheet(page, "Correct").getByRole("button", { name: "See results" }).click();
    });

    await test.step("the results: stats, confidence and follow-up sessions", async () => {
      await expect(page.getByRole("heading", { level: 1, name: "Session complete" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Session stats" })).toMatchAriaSnapshot(`
        - term: Accuracy
        - definition: 100%
        - term: Questions
        - definition: "3"
      `);
      const confidenceSection = page.getByRole("region", { name: "Confidence" });
      await expect(confidenceSection).toContainText("Your confidence matched your result on 3 of 3 rated questions.");
      await expect(confidenceSection.getByRole("listitem")).toContainText(["Sure: 3 of 3 correct (100%)"]);
      // The table sits behind a disclosure.
      await hydrated(confidenceSection.getByRole("button", { name: "Show as a table" }));
      await confidenceSection.getByRole("button", { name: "Show as a table" }).click();
      await expect(confidenceSection.getByRole("row", { name: "Sure 3 3 (100%)" })).toBeVisible();

      const followups = page.getByRole("region", { name: "Follow-up sessions" });
      await expect(followups.getByRole("listitem")).toHaveText([
        /^Retrieval session, \w{3}, \w{3} \d{1,2} \(in \d+ days\)$/,
        /^Retrieval session, \w{3}, \w{3} \d{1,2} \(in \d+ days\)$/,
      ]);
    });

    await test.step("Add follow-ups to plan puts them in the course's plan", async () => {
      const followups = page.getByRole("region", { name: "Follow-up sessions" });
      await followups.getByRole("button", { name: "Add follow-ups to plan" }).click();
      await expect(followups.getByRole("status")).toContainText(/^Added to your plan: \w{3}, \w{3} \d{1,2} and \w{3}, \w{3} \d{1,2}\./);
      await expect(followups.getByRole("link", { name: "Open plan" })).toHaveAttribute("href", `/plan?plan=${plan.id}`);
      const links = followups.getByRole("link", { name: /^Retrieval session, / });
      await expect(links).toHaveCount(2);

      const stored = await getJson<{ items: { session_id: string }[] }>(request, `/api/plans/${plan.id}`);
      const planSessions = stored.items.map((item) => `/s/${item.session_id}`);
      expect(stored.items).toHaveLength(plan.items.length + 2);
      for (const href of await links.evaluateAll((els) => els.map((el) => el.getAttribute("href")))) {
        expect(planSessions).toContain(href);
      }

      // The results remember it, and still link to the plan.
      await page.reload();
      await expect(followups.getByRole("status")).toContainText("Added to your plan:");
      await expect(followups.getByRole("button", { name: "Add follow-ups to plan" })).toHaveCount(0);
      await expect(followups.getByRole("link", { name: "Open plan" })).toHaveAttribute("href", `/plan?plan=${plan.id}`);
    });
  });

  test("Leave session goes to Home and keeps the session open to resume", { tag: "@mobile" }, async ({ page, request }) => {
    const session = await createSession(request, { course_name: unique("E2E Leave") });
    await page.goto(session.url);
    await page.getByRole("button", { name: "Start session" }).click();
    await expect(questionCounter(page, 1, 3)).toBeVisible();

    await page.getByRole("link", { name: "Leave session" }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Home");

    await page.goto(session.url);
    await expect(page.getByText("0 of 3 questions answered. Your answers are saved.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Resume session" })).toBeVisible();
  });

  test("a reload mid-question resumes on the same question with the typed answer kept", async ({ page, request }) => {
    const session = await createSession(request, { course_name: unique("E2E Draft") });
    const run = await startRun(request, session.id);
    await answerQuestion(request, run.run_id, 0, "CORRECT");

    await page.goto(session.url);
    await expect(page.getByText("1 of 3 questions answered. Your answers are saved.")).toBeVisible();
    await page.getByRole("button", { name: "Resume session" }).click();
    await expect(questionCounter(page, 2, 3)).toBeVisible();
    await answerBox(page).fill("Half of my answer, still being written");
    await pick(confidenceRadio(page, "Unsure"));
    // The draft is kept in the browser as it's typed.
    await expect
      .poll(() => page.evaluate(() => Object.values(window.localStorage).join("\n")))
      .toContain("Half of my answer, still being written");

    await page.reload();
    await page.getByRole("button", { name: "Resume session" }).click();
    await expect(questionCounter(page, 2, 3)).toBeVisible();
    await expect(answerBox(page)).toHaveValue("Half of my answer, still being written");
    await expect(confidenceRadio(page, "Unsure")).toBeChecked();
  });
});

test.describe("exam simulation", () => {
  /** Answer both questions (a wrong pick, then a written answer) and open scoring. */
  async function answerTheExam(page: Page) {
    await page.getByRole("button", { name: "Resume session" }).click();
    await expect(questionCounter(page, 1, 2)).toBeVisible();
    await expect(phase(page, "Answering")).toBeVisible();
    await pick(page.getByRole("group", { name: BASE_CASE.text }).getByRole("radio", { name: "The recursive call" }));
    await page.getByRole("button", { name: "Submit answer" }).click();

    // No feedback while answering: the next question replaces this one.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(RECURSIVE_CASE.text);
    await expect(questionCounter(page, 2, 2)).toBeVisible();
    await expect(phase(page, "Answering")).toBeVisible();
    await expect(page.getByRole("region", { name: "Feedback from your materials" })).toHaveCount(0);
    await answerBox(page).fill("It calls itself on a smaller piece of the problem");
    await page.getByRole("button", { name: "Submit answer" }).click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("All answers saved");
    await expect(questionCounter(page, 1, 2)).toBeVisible();
    await expect(phase(page, "Scoring")).toBeVisible();
    await page.getByRole("button", { name: "Start scoring" }).click();
  }

  test("saves every answer without feedback, then scores each one", async ({ page, request, seedSession }) => {
    test.slow();
    const session = await seedSession({ course_name: unique("E2E Exam"), mode: "EXAM_SIM", deck: [BASE_CASE, RECURSIVE_CASE] });
    await page.goto(session.url);
    await answerTheExam(page);

    await test.step("a multiple-choice answer is scored for you", async () => {
      await expect(questionCounter(page, 1, 2)).toBeVisible();
      await expect(phase(page, "Scoring")).toBeVisible();
      await expect(page.getByRole("main").getByText("Correct answer: The base case", { exact: true })).toBeVisible();
      await expect(page.getByRole("radio", { name: "The recursive call (your answer) Incorrect" })).toBeChecked();
      await page.getByRole("button", { name: "Save score" }).click();
      await expect(feedbackSheet(page, "Incorrect")).toContainText("Correct answer: The base case");
      await feedbackSheet(page, "Incorrect").getByRole("button", { name: "Next question" }).click();
    });

    await test.step("a written answer is scored against its model answer", async () => {
      await expect(questionCounter(page, 2, 2)).toBeVisible();
      await expect(phase(page, "Scoring")).toBeVisible();
      await expect(page.getByRole("region", { name: "Your answer" })).toContainText("It calls itself on a smaller piece of the problem");
      await expect(page.getByRole("region", { name: "Model answer" })).toContainText(RECURSIVE_CASE.modelAnswer);
      await scoreAs(page, "Correct");
      await feedbackSheet(page, "Correct").getByRole("button", { name: "See results" }).click();
    });

    await test.step("the results count both scores", async () => {
      await expect(page.getByRole("heading", { level: 1, name: "Session complete" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Session stats" })).toMatchAriaSnapshot(`
        - term: Accuracy
        - definition: 50%
        - term: Questions
        - definition: "2"
        - term: Time answering
        - definition: /.+/
        - term: Errors logged
        - definition: "1"
        - term: Repair questions
        - definition: "0"
        - term: Scored
        - definition: 2 of 2
      `);
      const run = await storedRun(request, session.runId);
      expect(run.attempts.map((a) => [a.prompt_index, a.self_score])).toEqual([
        [0, "INCORRECT"],
        [1, "CORRECT"],
      ]);
    });
  });

  test("no score is recorded while the saved exam answers are still loading", async ({ page, request, seedSession }) => {
    const session = await seedSession({ course_name: unique("E2E Exam"), mode: "EXAM_SIM", deck: [BASE_CASE, RECURSIVE_CASE] });
    // Hold the saved answers (GET /api/runs/{id}) until the checks below are done.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(`**/api/runs/${session.runId}`, async (route) => {
      if (route.request().method() === "GET") await held;
      await route.fallback();
    });
    await page.goto(session.url);
    await answerTheExam(page);

    const bar = page.getByRole("group", { name: "Loading your saved answer…" });
    await expect(bar).toBeVisible();
    for (const name of ["Correct", "Partly correct", "Incorrect"]) {
      await expect(bar.getByRole("button", { name, exact: true })).toBeDisabled();
    }
    await expect(page.getByRole("main")).not.toContainText("has no model answer");
    await page.keyboard.press("1");
    await page.keyboard.press("Enter");
    expect((await storedRun(request, session.runId)).attempts.map((a) => a.self_score)).toEqual([null, null]);

    release();
    await expect(page.getByRole("main").getByText("Correct answer: The base case", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save score" })).toBeEnabled();
  });

  test("the last exam answer stays on screen after it is scored", async ({ page, seedSession }) => {
    const session = await seedSession({ course_name: unique("E2E Exam"), mode: "EXAM_SIM", deck: [BASE_CASE, RECURSIVE_CASE] });
    await page.goto(session.url);
    await answerTheExam(page);
    await page.getByRole("button", { name: "Save score" }).click();
    await feedbackSheet(page, "Incorrect").getByRole("button", { name: "Next question" }).click();

    const yourAnswer = page.getByRole("region", { name: "Your answer" });
    await expect(yourAnswer).toContainText("It calls itself on a smaller piece of the problem");
    await scoreAs(page, "Correct");
    await expect(feedbackSheet(page, "Correct")).toBeVisible();
    await expect(yourAnswer).toContainText("It calls itself on a smaller piece of the problem");
  });
});

/** The top of the sticky footer that holds `el` (the score bar, Save correction). */
const footerTop = (el: HTMLElement): number => {
  let node: HTMLElement | null = el;
  while (node && getComputedStyle(node).position !== "sticky") node = node.parentElement;
  return node ? node.getBoundingClientRect().top : window.innerHeight;
};

test("on a small phone the score bar is one row and the correction rule stays above the footer", { tag: "@mobile" }, async ({
  page,
  seedSession,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  const session = await seedSession({ course_name: unique("E2E Small phone"), deck: [RECURSIVE_CASE] });
  await page.goto(session.url);
  await page.getByRole("button", { name: "Resume session" }).click();
  await answerBox(page).fill("It calls the function again");
  await page.getByRole("button", { name: "Submit answer" }).click();

  await test.step("the three scores sit in one row, under the model answer they're scored against", async () => {
    const bar = page.getByRole("group", { name: "Score your answer" });
    // The bar replaces Submit answer once the model answer arrives.
    await expect(bar.getByRole("button")).toHaveCount(3);
    const tops = await bar.getByRole("button").evaluateAll((buttons) => buttons.map((b) => Math.round(b.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    const barTop = await bar.evaluate(footerTop);
    const modelTop = await page.getByRole("region", { name: "Model answer" }).evaluate((el) => el.getBoundingClientRect().top);
    // At least the heading and a few lines of the model answer show above the bar.
    expect(barTop - modelTop).toBeGreaterThan(120);
  });

  await test.step("the focused correction rule field, and its error, are not hidden by the footer", async () => {
    await scoreAs(page, "Incorrect");
    const rule = page.getByRole("textbox", { name: "Correction rule" });
    await expect(rule).toBeFocused();
    const save = page.getByRole("button", { name: "Save correction" });
    const limit = await save.evaluate(footerTop);
    expect(await rule.evaluate((el) => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(limit);
    // Change score and Save correction share one row.
    const changeTop = await page.getByRole("button", { name: "Change score" }).evaluate((el) => Math.round(el.getBoundingClientRect().top));
    expect(await save.evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBe(changeTop);

    await save.click();
    const error = page.getByText("Write the correction rule first.");
    await expect(error).toBeVisible();
    await expect(rule).toBeFocused();
    expect(await error.evaluate((el) => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(await save.evaluate(footerTop));
  });
});

test("one multiple-choice question by touch on a phone", { tag: "@mobile" }, async ({ page, isMobile, seedSession }) => {
  test.skip(!isMobile, "Phone layout only");
  const session = await seedSession({ course_name: unique("E2E Phone"), deck: [BASE_CASE] });
  await page.goto(session.url);
  await page.getByRole("button", { name: "Resume session" }).tap();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(BASE_CASE.text);
  // No keyboard on a phone, so no keyboard shortcuts button.
  await expect(page.getByRole("button", { name: "Keyboard shortcuts" })).toBeHidden();
  await pick(page.getByRole("radio", { name: "The base case" }));
  await pick(confidenceRadio(page, "Sure"));
  await page.getByRole("button", { name: "Submit answer" }).tap();

  await expect(feedbackSheet(page, "Correct")).toBeInViewport();
  await feedbackSheet(page, "Correct").getByRole("button", { name: "See results" }).tap();
  await expect(page.getByRole("heading", { level: 1, name: "Session complete" })).toBeVisible();
});
