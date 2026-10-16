/**
 * Test data through the app's own HTTP API. Every helper takes the
 * APIRequestContext of the user who should own the data: the fixture
 * `request` (the signed-in e2e account), `testUser.api` (a fresh X-User-Id
 * identity) or `account.api` (a real account of the test's own).
 *
 * Give each test its own course name (see `unique`), so tests never see
 * each other's sessions, errors or plans and can run in parallel.
 */
import { randomBytes } from "node:crypto";
import { expect, type APIRequestContext } from "@playwright/test";
import { TIME_ZONE } from "./env";
import { dayIn } from "./time";

/** "E2E 101 k3f9a2": a label no other test or run will reuse. */
export function unique(label: string): string {
  return `${label} ${randomBytes(3).toString("hex")}`;
}

/**
 * GET an API route as JSON, retried until it answers 200. A request
 * context's keep-alive connection can be reset by the server after the
 * seconds a test spends in the browser (ECONNRESET), which says nothing about
 * the app. Use it for reads after browser steps; never for writes.
 */
export async function getJson<T>(api: APIRequestContext, path: string): Promise<T> {
  let body: T | undefined;
  await expect(async () => {
    const response = await api.get(path);
    expect(response.status(), path).toBe(200);
    body = (await response.json()) as T;
  }).toPass({ timeout: 10_000 });
  return body as T;
}

export type SessionMode = "RETRIEVAL" | "INTERLEAVED_PRACTICE" | "EXAM_SIM" | "ERROR_REPAIR" | "WORKED_EXAMPLES";

/** Each mode as the screens name it. */
export const MODE_LABELS: Record<SessionMode, string> = {
  RETRIEVAL: "Retrieval",
  INTERLEAVED_PRACTICE: "Interleaved practice",
  EXAM_SIM: "Exam simulation",
  ERROR_REPAIR: "Error repair",
  WORKED_EXAMPLES: "Worked examples",
};

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

/** How sure the student was: Guessing, Unsure and Sure are stored as 1, 3 and 5. */
export type Confidence = 1 | 3 | 5;

export interface RunAnswer {
  score: Exclude<SelfScore, "PARTIAL">;
  confidence?: Confidence;
}

/**
 * Answer a whole Retrieval-style run through the API, including the pretest
 * questions a session with `objectives` opens with and the repair questions
 * wrong answers add. The deck's own questions take `answers` in order (the
 * last one repeats); pretest and repair questions are answered correctly,
 * with no rating. Unlike finishSession, this can rate confidence and handles
 * pretest questions. Returns the finished run's id.
 */
export async function answerRun(api: APIRequestContext, sessionId: string, answers: RunAnswer[]): Promise<string> {
  const run = await startRun(api, sessionId);
  let state = { status: run.status, current_index: run.current_index };
  let own = 0;
  while (state.status === "ACTIVE") {
    const index = state.current_index;
    const pretest = run.prompts[index]?.meta?.pack === "PRE_TEST";
    const repair = index >= run.prompts.length;
    const answer: RunAnswer = pretest || repair ? { score: "CORRECT" } : answers[Math.min(own++, answers.length - 1)];
    const wrong = answer.score === "INCORRECT";
    const response = await api.post(`/api/runs/${run.run_id}/attempt`, {
      data: {
        prompt_index: index,
        user_answer: `Answer ${index + 1}`,
        self_score: answer.score,
        time_to_answer_seconds: 10,
        ...(answer.confidence ? { confidence_rating: answer.confidence } : {}),
        ...(pretest ? { is_pretest: true } : {}),
        ...(wrong ? { error_log: { error_type: "MEMORY", correction_rule: `Correction rule ${index + 1}` } } : {}),
      },
    });
    expect(response.status(), await response.text()).toBe(200);
    state = await response.json();
  }
  expect(state.status).toBe("COMPLETED");
  return run.run_id;
}

export interface PlanInput {
  course_name: string;
  exam_name?: string;
  /** Days from today in the plan's zone. Defaults to 14. */
  exam_in_days?: number;
  objectives?: string[];
  /** The plan's zone. Defaults to the suite's (America/New_York). */
  time_zone?: string;
  /** Free all day (00:00 to 23:45) instead of 9:00 to 17:00. */
  all_day?: boolean;
}

export interface PlanItem {
  id: string;
  session_id: string;
  start_time: string;
  end_time: string;
  status: string;
  mode: SessionMode;
}

export interface CreatedPlan {
  id: string;
  course: string;
  exam: string;
  /** The exam's calendar day, YYYY-MM-DD. */
  examDate: string;
  timeZone: string;
  /** The plan's sessions, earliest first. */
  items: PlanItem[];
}

/** A plan's sessions, earliest first, with their ids and statuses. */
export async function planItems(api: APIRequestContext, planId: string): Promise<PlanItem[]> {
  const { items } = await getJson<{ items: PlanItem[] }>(api, `/api/plans/${planId}`);
  return [...items].sort((a, b) => a.start_time.localeCompare(b.start_time));
}

/**
 * Create a plan with free time every day (9:00 to 17:00 unless `all_day`).
 * The exam date is counted in the plan's own zone.
 */
export async function createPlan(api: APIRequestContext, input: PlanInput): Promise<CreatedPlan> {
  const exam = input.exam_name ?? "Final exam";
  const timeZone = input.time_zone ?? TIME_ZONE;
  const examDate = dayIn(timeZone, input.exam_in_days ?? 14);
  const window = input.all_day ? { start: "00:00", end: "23:45" } : { start: "09:00", end: "17:00" };
  const response = await api.post("/api/plans", {
    data: {
      course_name: input.course_name,
      exam_name: exam,
      exam_date: examDate,
      timezone: timeZone,
      objectives: input.objectives ?? ["Recursion", "Linked lists", "Hash tables", "Sorting", "Graphs"],
      availability: Array.from({ length: 7 }, () => window),
      daily_study_cap_minutes: 180,
      break_protocol_default: "50_10",
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const { plan_id: id } = await response.json();
  const items = await planItems(api, id);
  expect(items.length, "the plan has sessions").toBeGreaterThan(0);
  return { id, course: input.course_name, exam, examDate, timeZone, items };
}

/** Mark one of a plan's sessions done or missed. */
export async function setItemStatus(api: APIRequestContext, planId: string, itemId: string, status: "DONE" | "MISSED") {
  const response = await api.post(`/api/plans/${planId}/items/${itemId}/status`, { data: { status } });
  expect(response.status(), await response.text()).toBe(200);
}

/**
 * Upload a text file as course material and process it, so feedback,
 * decks, guides and chat have something to cite. With `process: false` the
 * file stays "Uploaded". Returns the document id.
 */
export async function uploadMaterial(
  api: APIRequestContext,
  {
    course,
    fileName = "notes.txt",
    text,
    process = true,
  }: { course: string; fileName?: string; text: string; process?: boolean },
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

  if (process) {
    const processed = await api.post(`/api/content/documents/${documentId}/process`);
    expect(processed.status(), await processed.text()).toBe(200);
  }
  return documentId;
}

export type GuideType = "KEY_CONCEPTS" | "FAQ" | "CHEAT_SHEET";

/** Generate a study guide for a course that has materials (the mock AI writes 2 sections). */
export async function createGuide(api: APIRequestContext, course: string, type: GuideType = "KEY_CONCEPTS") {
  const response = await api.post("/api/guides", { data: { course_name: course, guide_type: type } });
  expect(response.status(), await response.text()).toBe(201);
}

export interface CreatedDeck {
  id: string;
  title: string;
  course: string;
  /** The cards in review order (new cards by position). */
  cards: { id: string; front: string; back: string }[];
}

const DECK_NOTES = [
  "Recursion: a function that calls itself on a smaller input.",
  "A base case stops the recursion before the call stack overflows.",
  "Each recursive call gets its own frame on the call stack.",
].join("\n\n");

/** Upload one file (recursion.txt) to a new course and generate its deck; the mock AI writes 3 cards. */
export async function createDeck(api: APIRequestContext, course = unique("E2E Cards")): Promise<CreatedDeck> {
  await uploadMaterial(api, { course, fileName: "recursion.txt", text: DECK_NOTES });
  const response = await api.post("/api/flashcards", { data: { course_name: course } });
  expect(response.status(), await response.text()).toBe(201);
  const { id, title } = (await response.json()) as { id: string; title: string };
  const { cards } = await getJson<{ cards: CreatedDeck["cards"] }>(api, `/api/flashcards/${id}/study?scope=all`);
  expect(cards).toHaveLength(3);
  return { id, title, course, cards };
}
