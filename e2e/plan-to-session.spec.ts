/**
 * A plan's sessions open from the Plan page. Plan scheduling and the .ics
 * file are covered by src/__tests__/integration/plan-flow.test.ts and
 * api-contract.spec.ts.
 */
import { test, expect, createPlan, unique } from "./fixtures";

test("a session in a plan opens from the Plan page", { tag: "@mobile" }, async ({ page, request }) => {
  const plan = await createPlan(request, { course_name: unique("E2E Plan"), exam_name: "Prelim 1", exam_in_days: 14 });

  await page.goto(`/plan?plan=${plan.id}`);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 2, name: `${plan.course} Prelim 1` })).toBeVisible();
  await expect(main.getByText("Prelim 1 is in 14 days", { exact: false })).toBeVisible();

  const sessions = main.getByRole("list", { name: "Prelim 1 sessions by day" });
  const firstSession = sessions.getByRole("link").first();
  const mode = (await firstSession.innerText()).trim();
  await firstSession.click();

  await expect(page).toHaveURL(/\/s\/[\w-]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(`${mode}:`);
  await expect(page.getByRole("main").getByText(plan.course)).toBeVisible();
  await expect(page.getByRole("button", { name: "Start session" })).toBeEnabled();
});
