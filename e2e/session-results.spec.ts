/**
 * Each mode's finished session opens on its results, named the way the
 * student saw it. The runs are finished through the API; the deck rules for
 * each mode are covered by src/__tests__/integration/mode-parity.test.ts.
 */
import { test, expect, createSession, finishSession, unique, type SessionMode } from "./fixtures";

const MODES: { mode: SessionMode; label: string; incorrect: number; accuracy: string }[] = [
  { mode: "INTERLEAVED_PRACTICE", label: "Interleaved practice", incorrect: 0, accuracy: "100%" },
  // Exam simulation scores after the last answer, so a wrong score adds no repair question.
  { mode: "EXAM_SIM", label: "Exam simulation", incorrect: 1, accuracy: "67%" },
];

for (const { mode, label, incorrect, accuracy } of MODES) {
  test(`a finished ${label} session shows its results`, async ({ page, request }) => {
    const session = await createSession(request, { course_name: unique(`E2E ${label}`), mode });
    await finishSession(request, session.id, { incorrect });

    await page.goto(session.url);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1, name: "Session complete" })).toBeVisible();
    await expect(main.getByText(`${label}: End-to-end testing`, { exact: true })).toBeVisible();
    await expect(main.getByText(session.course)).toBeVisible();
    await expect(main.getByRole("region", { name: "Session stats" })).toMatchAriaSnapshot(`
      - term: Accuracy
      - definition: ${accuracy}
    `);
    await expect(page).toHaveTitle(`Session complete · ${session.course} · Study Bot`);
  });
}

test("an Error repair session retests the course's unresolved errors", async ({ page, request }) => {
  // Two sessions finished through the API plus two page loads.
  test.slow();
  const course = unique("E2E Repair");
  // One wrong answer leaves an unresolved error: it resolves only after
  // correct answers on 2 different days.
  const retrieval = await createSession(request, { course_name: course, questions: 2 });
  await finishSession(request, retrieval.id, { incorrect: 1 });

  const repair = await createSession(request, { course_name: course, mode: "ERROR_REPAIR", topic_scope: "Unresolved errors" });
  await page.goto(repair.url);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Error repair: Unresolved errors");
  await page.getByRole("button", { name: "Start session" }).click();
  await expect(page.getByRole("main").getByText(/^Question 1 of 1\b/)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("From memory");

  await finishSession(request, repair.id);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Session complete" })).toBeVisible();
  await expect(page.getByRole("main").getByText("Error repair: Unresolved errors", { exact: true })).toBeVisible();
});
