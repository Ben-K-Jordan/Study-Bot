/**
 * HTTP answers the screens rely on that the service-level integration tests
 * can't see: status codes for out-of-order answers and the calendar file's
 * headers. API only, no browser page.
 */
import { test, expect, answerQuestion, createPlan, createSession, startRun, unique } from "./fixtures";

test("answers out of order or after the end answer 409", async ({ testUser }) => {
  const session = await createSession(testUser.api, { course_name: unique("E2E State"), questions: 2 });
  const run = await startRun(testUser.api, session.id);

  const skipAhead = await testUser.api.post(`/api/runs/${run.run_id}/attempt`, {
    data: { prompt_index: 1, user_answer: "Out of order", self_score: "CORRECT" },
  });
  expect(skipAhead.status()).toBe(409);

  await answerQuestion(testUser.api, run.run_id, 0);
  const last = await answerQuestion(testUser.api, run.run_id, 1);
  expect(last.status).toBe("COMPLETED");

  const afterEnd = await testUser.api.post(`/api/runs/${run.run_id}/attempt`, {
    data: { prompt_index: 2, user_answer: "Too late", self_score: "CORRECT" },
  });
  expect(afterEnd.status()).toBe(409);
});

test("the plan's calendar file downloads as .ics with a link to every session", async ({ testUser }) => {
  const plan = await createPlan(testUser.api, { course_name: unique("E2E Calendar") });

  const response = await testUser.api.get(`/api/plans/${plan.id}/ics`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/calendar");
  expect(response.headers()["content-disposition"]).toMatch(/^attachment; filename=".+\.ics"$/);

  // Unfold the 75-octet lines so links can be matched whole.
  const body = (await response.text()).replace(/\r\n[ \t]/g, "");
  expect(body).toMatch(/^BEGIN:VCALENDAR/);
  expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(plan.items.length);
  for (const item of plan.items) expect(body).toContain(`/s/${item.session_id}`);
});
