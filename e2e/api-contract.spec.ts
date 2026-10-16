/**
 * HTTP answers the screens rely on that the service-level integration tests
 * can't see: status codes for out-of-order answers, request bounds, no answer
 * key before an answer, and the calendar file's headers. API only, no
 * browser page.
 */
import {
  test,
  expect,
  QUESTIONS,
  answerQuestion,
  createPlan,
  createSession,
  getJson,
  startRun,
  unique,
} from "./fixtures";

/** Fields that would give the answer away, in either spelling the code uses. */
const ANSWER_FIELDS = new Set([
  "correctIndex",
  "correct_index",
  "model_answer",
  "modelAnswer",
  "key_points",
  "keyPoints",
  "distractorRationales",
  "distractor_rationales",
  "excerpts",
]);

/** Paths of every answer field anywhere in a JSON body. */
function answerFields(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((item, i) => answerFields(item, `${path}[${i}]`));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) =>
    ANSWER_FIELDS.has(key) && child != null ? [`${path}.${key}`] : answerFields(child, `${path}.${key}`)
  );
}

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

test("a question reaches the browser without its answer until it is answered", async ({ request, seedSession }) => {
  const { overflow, recursiveCase } = QUESTIONS;
  const session = await seedSession({ course_name: unique("E2E Answer key"), deck: [overflow, recursiveCase] });
  const secrets = [
    overflow.modelAnswer,
    ...overflow.rationales,
    ...overflow.keyPoints,
    recursiveCase.modelAnswer,
    ...recursiveCase.keyPoints,
  ];

  // Every way the browser reads a question before answering it: resuming
  // the run, the run itself, and the question on its own.
  const bodies = {
    "start (resume)": await startRun(request, session.id),
    run: await getJson<unknown>(request, `/api/runs/${session.runId}`),
    prompt: await getJson<unknown>(request, `/api/runs/${session.runId}/prompt?index=0`),
  };
  for (const [label, body] of Object.entries(bodies)) {
    expect(answerFields(body), label).toEqual([]);
    const text = JSON.stringify(body);
    for (const secret of secrets) expect(text, `${label} leaks "${secret}"`).not.toContain(secret);
  }
  // The question itself is there.
  expect(JSON.stringify(bodies.prompt)).toContain(overflow.text);
});

test("a session holds 1 to 60 questions", async ({ testUser }) => {
  // The run builds the whole deck in memory, so an unbounded count could take
  // the server down for everyone; 0 left a run with no first question.
  const session = {
    course_name: unique("E2E Bounds"),
    exam_name: "Final exam",
    mode: "RETRIEVAL",
    topic_scope: "End-to-end testing",
    planned_minutes: 30,
  };
  for (const prompt_count of [0, -1, 2.5, 61, 50_000_000]) {
    const response = await testUser.api.post("/api/sessions", { data: { ...session, target_outcome: { prompt_count } } });
    expect(response.status(), `prompt_count ${prompt_count}`).toBe(400);
    expect(await response.json()).toMatchObject({ issues: [{ path: ["target_outcome", "prompt_count"] }] });
  }

  const atLimit = await testUser.api.post("/api/sessions", { data: { ...session, target_outcome: { prompt_count: 60 } } });
  expect(atLimit.status(), await atLimit.text()).toBe(201);
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
