/**
 * Test data through the app's own HTTP API. Every helper takes the
 * APIRequestContext of the user who should own the data: the fixture
 * `request` (the signed-in e2e account) or `testUser.api` (a fresh
 * X-User-Id identity).
 *
 * Give each test its own course name (see `unique`), so tests never see
 * each other's sessions, errors or plans and can run in parallel.
 */
import { randomBytes } from "node:crypto";
import { expect, type APIRequestContext } from "@playwright/test";

/** "E2E 101 k3f9a2": a label no other test or run will reuse. */
export function unique(label: string): string {
  return `${label} ${randomBytes(3).toString("hex")}`;
}

/** A calendar day `days` from today, as the API's YYYY-MM-DD. */
export function isoDay(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export type SessionMode = "RETRIEVAL" | "INTERLEAVED_PRACTICE" | "EXAM_SIM" | "ERROR_REPAIR" | "WORKED_EXAMPLES";

export interface SessionInput {
  course_name: string;
  exam_name?: string;
  mode?: SessionMode;
  topic_scope?: string;
  planned_minutes?: number;
  /**
   * Topics the deck draws from. A topic with no mastery yet gets a pretest
   * question at the start of the deck (up to 2), which has no error log.
   * Leave this out for a predictable deck of `questions` plain questions.
   */
  objectives?: { id: string; title: string }[];
  questions?: number;
  target_accuracy?: number;
}

export interface CreatedSession {
  id: string;
  url: string;
  course: string;
  exam: string;
  topic: string;
}

/**
 * Create a study session. Defaults: Retrieval, 3 questions, one block (so a
 * break never starts), no topics (so no pretest questions).
 */
export async function createSession(api: APIRequestContext, input: SessionInput): Promise<CreatedSession> {
  const exam = input.exam_name ?? "Final exam";
  const topic = input.topic_scope ?? "End-to-end testing";
  const response = await api.post("/api/sessions", {
    data: {
      course_name: input.course_name,
      exam_name: exam,
      mode: input.mode ?? "RETRIEVAL",
      topic_scope: topic,
      planned_minutes: input.planned_minutes ?? 30,
      ...(input.objectives ? { objectives: input.objectives } : {}),
      target_outcome: {
        prompt_count: input.questions ?? 3,
        ...(input.target_accuracy != null ? { target_accuracy: input.target_accuracy } : {}),
      },
      break_protocol: { type: "TEST_3_2", cycles: 1 },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const body = await response.json();
  return { id: body.session_id, url: `/s/${body.session_id}`, course: input.course_name, exam, topic };
}

export interface StartedRun {
  run_id: string;
  status: string;
  phase: string;
  current_index: number;
  prompts: { text: string; objective_id?: string; meta?: Record<string, unknown> }[];
  [key: string]: unknown;
}

/** Start (or resume) the session's run. */
export async function startRun(api: APIRequestContext, sessionId: string): Promise<StartedRun> {
  const response = await api.post(`/api/sessions/${sessionId}/runs/start`);
  expect([200, 201], await response.text()).toContain(response.status());
  return response.json();
}

export type SelfScore = "CORRECT" | "PARTIAL" | "INCORRECT";

/** Answer and score one question in a Retrieval-style run (immediate scoring). */
export async function answerQuestion(
  api: APIRequestContext,
  runId: string,
  index: number,
  score: SelfScore = "CORRECT",
): Promise<{ status: string; current_index: number; phase?: string; [key: string]: unknown }> {
  const response = await api.post(`/api/runs/${runId}/attempt`, {
    data: {
      prompt_index: index,
      user_answer: `Answer ${index + 1}`,
      self_score: score,
      time_to_answer_seconds: 10,
      ...(score === "CORRECT"
        ? {}
        : { error_log: { error_type: "MEMORY", correction_rule: `Correction rule ${index + 1}` } }),
    },
  });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

/**
 * Finish a session through the API: answer every question correctly (the
 * first `incorrect` ones wrong, with a correction rule), then answer any
 * repair questions those added. Exam simulation answers everything, then
 * scores it. Returns the finished run's id.
 */
export async function finishSession(
  api: APIRequestContext,
  sessionId: string,
  { incorrect = 0 }: { incorrect?: number } = {},
): Promise<string> {
  const run = await startRun(api, sessionId);
  const count = run.prompts.length;

  if (run.phase === "EXAM") {
    for (let i = 0; i < count; i++) {
      const answered = await api.post(`/api/runs/${run.run_id}/attempt`, {
        data: { prompt_index: i, kind: "ANSWER", user_answer: `Answer ${i + 1}`, time_to_answer_seconds: 10 },
      });
      expect(answered.status(), await answered.text()).toBe(200);
    }
    for (let i = 0; i < count; i++) {
      const wrong = i < incorrect;
      const scored = await api.post(`/api/runs/${run.run_id}/attempt`, {
        data: {
          prompt_index: i,
          kind: "SCORE",
          self_score: wrong ? "INCORRECT" : "CORRECT",
          ...(wrong ? { error_log: { error_type: "MEMORY", correction_rule: `Correction rule ${i + 1}` } } : {}),
        },
      });
      expect(scored.status(), await scored.text()).toBe(200);
    }
    return run.run_id;
  }

  let last = { status: run.status, current_index: run.current_index };
  for (let i = 0; i < count; i++) {
    last = await answerQuestion(api, run.run_id, i, i < incorrect ? "INCORRECT" : "CORRECT");
  }
  // A wrong answer adds a repair question to the end of the deck.
  while (last.status === "ACTIVE") {
    last = await answerQuestion(api, run.run_id, last.current_index, "CORRECT");
  }
  expect(last.status).toBe("COMPLETED");
  return run.run_id;
}

export interface PlanInput {
  course_name: string;
  exam_name?: string;
  /** Days from today. Defaults to 14. */
  exam_in_days?: number;
  objectives?: string[];
}

export interface CreatedPlan {
  id: string;
  course: string;
  exam: string;
  items: { session_id: string; mode: string; [key: string]: unknown }[];
}

/** Create a plan with free time 9:00 to 17:00 every day. */
export async function createPlan(api: APIRequestContext, input: PlanInput): Promise<CreatedPlan> {
  const exam = input.exam_name ?? "Final exam";
  const response = await api.post("/api/plans", {
    data: {
      course_name: input.course_name,
      exam_name: exam,
      exam_date: isoDay(input.exam_in_days ?? 14),
      timezone: "America/New_York",
      objectives: input.objectives ?? ["Recursion", "Linked lists", "Hash tables", "Sorting", "Graphs"],
      availability: Array.from({ length: 7 }, () => ({ start: "09:00", end: "17:00" })),
      daily_study_cap_minutes: 180,
      break_protocol_default: "50_10",
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const body = await response.json();
  return { id: body.plan_id, course: input.course_name, exam, items: body.items };
}

/**
 * Upload a text file as course material and process it, so feedback,
 * decks, guides and chat have something to cite.
 */
export async function uploadMaterial(
  api: APIRequestContext,
  { course, fileName = "notes.txt", text }: { course: string; fileName?: string; text: string },
): Promise<string> {
  const upload = await api.post("/api/content/documents", {
    multipart: {
      file: { name: fileName, mimeType: "text/plain", buffer: Buffer.from(text) },
      namespace: "COURSE",
      course_name: course,
    },
  });
  expect([200, 201], await upload.text()).toContain(upload.status());
  const { document_id: documentId } = await upload.json();

  const processed = await api.post(`/api/content/documents/${documentId}/process`);
  expect(processed.status(), await processed.text()).toBe(200);
  return documentId;
}
