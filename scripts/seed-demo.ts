#!/usr/bin/env tsx
/**
 * Demo account seed.
 *
 * Creates (or recreates) one demo user with three weeks of realistic,
 * internally consistent study history placed relative to today, so
 * screenshots and reviews never go stale:
 *
 * - 4 courses with exams 7, 17, 22 and 60 days out
 * - 9 lecture notes run through the real upload and chunking pipeline
 * - 4 plans; INFO 1300 has 6 sessions done, 1 missed yesterday, 1 today at
 *   2:00 PM and 3 more before Prelim 2
 * - completed sessions replayed with the app's own rules: deck injection
 *   (pretest, review, repair questions), variant retries after misses, error
 *   logs that resolve after correct answers on 2 different days, SM-2
 *   mastery, follow-ups, XP and plan completion
 * - 2 flashcard decks with SM-2 review history and cards due today
 * - 3 study guides, a short chat history with sources, and the achievements
 *   the app would have awarded for this activity
 *
 * Only the demo user's rows are deleted and recreated, so running it twice
 * gives the same shape of data. It refuses to run unless the database name
 * contains "demo" (or --force is passed), and never when NODE_ENV=production.
 *
 * Usage:
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/studybot_demo \
 *     npx tsx scripts/seed-demo.ts [--force] [--verbose]
 *
 * Run it from the repository root: uploads are written under UPLOAD_DIR
 * (default ./data/uploads), the same place the app reads them from.
 */
import { randomUUID } from "crypto";
import { rm } from "fs/promises";
import type { Prisma } from "../generated/prisma/client";
import {
  CHATS,
  COURSES,
  DECKS,
  GUIDES,
  type DemoCourse,
  type DemoObjective,
  type DemoQuestion,
  type When,
} from "./seed-demo-content";

// ---------------------------------------------------------------------------
// Demo identity
// ---------------------------------------------------------------------------

/** Fixed so the screenshot harness and test-auth header can rely on it. */
const DEMO_USER_ID = "5eed0000-de70-4000-8000-000000000001";
const DEMO_EMAIL = "demo@studybot.local";
const DEMO_PASSWORD = "study-bot-demo";
const DEMO_NAME = "Ben";
const TZ = "America/New_York";

// ---------------------------------------------------------------------------
// Plans and session history
// ---------------------------------------------------------------------------

type Mode = "RETRIEVAL" | "INTERLEAVED_PRACTICE" | "EXAM_SIM" | "ERROR_REPAIR" | "WORKED_EXAMPLES";

/**
 * Outcome shorthand: score letter plus optional confidence.
 * "C3" = correct, rated Unsure; "I5" = incorrect, rated Sure; "P" = partly
 * correct, not rated. Confidence uses the app's 1 / 3 / 5 scale.
 */
type Outcome = string;

interface RunSpec {
  /** Question keys for the generated part of the deck, in deck order. */
  base: string[];
  /** Outcome per base question key (required for every base question used). */
  out: Record<string, Outcome>;
  /** Pretest outcomes by objective code (default "P1"). */
  pretest?: Record<string, Outcome>;
  /** Review question outcomes by objective code (default "C3"). */
  warmup?: Record<string, Outcome>;
  /** Repair question outcomes by the source error's question key (default "C3"). */
  repair?: Record<string, Outcome>;
  /** Retry question outcomes in order of appearance, by source question key (default "C3"). */
  variants?: Record<string, Outcome[]>;
}

interface SessionSpec {
  mode: Mode;
  objs: string[];
  at: When;
  minutes: number;
  prompts: number;
  type?: string;
  status: "DONE" | "MISSED" | "SCHEDULED";
  missedMarkedAt?: When;
  run?: RunSpec;
}

interface PlanSpec {
  course: keyof typeof COURSES;
  created: When;
  window: { start: string; end: string };
  chronotype: "morning" | "evening" | "flexible";
  sessions: SessionSpec[];
}

const PLANS: PlanSpec[] = [
  {
    course: "INFO1300",
    created: [-12, "09:05"],
    window: { start: "14:00", end: "22:00" },
    chronotype: "evening",
    sessions: [
      {
        mode: "RETRIEVAL", objs: ["S", "B"], at: [-12, "16:00"], minutes: 30, prompts: 6, type: "diagnostic", status: "DONE",
        run: {
          base: ["s1", "b1", "s2", "b2", "s5", "b4"],
          out: { s1: "C3", b1: "C5", s2: "I3", b2: "C" },
          pretest: { S: "P1", B: "C3" },
          variants: { s2: ["C3"] },
        },
      },
      {
        mode: "RETRIEVAL", objs: ["F", "G"], at: [-10, "16:00"], minutes: 40, prompts: 8, status: "DONE",
        run: {
          base: ["f1", "g1", "f2", "g2", "f3", "g3", "f4", "g4"],
          out: { f1: "C5", g1: "I3", f2: "C5", g2: "C3", f3: "C5", g3: "P1" },
          pretest: { F: "C3" },
          repair: { s2: "C3" },
          variants: { g1: ["C3"], g3: ["C3"] },
        },
      },
      {
        mode: "INTERLEAVED_PRACTICE", objs: ["S", "B", "F", "G"], at: [-8, "16:30"], minutes: 40, prompts: 8, status: "DONE",
        run: {
          base: ["s3", "f4", "b3", "g4", "s4", "b4", "f2", "g5"],
          out: { s3: "C5", f4: "C5", b3: "P3", g4: "C", s4: "I3", b4: "C5" },
          repair: { g1: "C3", g3: "C3" },
          variants: { b3: ["C3"], s4: ["I3", "C3"] },
        },
      },
      {
        mode: "RETRIEVAL", objs: ["G"], at: [-4, "16:30"], minutes: 45, prompts: 10, status: "DONE",
        run: {
          base: ["g1", "g2", "g3", "g4", "g5", "g6", "g7"],
          out: { g1: "C3", g2: "C3", g3: "I3", g4: "P3", g5: "C5", g6: "I1", g7: "I3" },
          repair: { s4: "C3", b3: "C3" },
          warmup: { S: "C3" },
          variants: { g3: ["C3"], g4: ["I3"], g6: ["C3"], g7: ["I3"] },
        },
      },
      {
        mode: "RETRIEVAL", objs: ["R"], at: [-3, "16:00"], minutes: 30, prompts: 6, status: "DONE",
        run: {
          base: ["r1", "r2", "r3", "r4", "r5"],
          out: { r1: "C", r2: "I3", r3: "I5", r4: "P3" },
          variants: { r2: ["C3"], r3: ["I3", "I3"], r4: ["C3"] },
        },
      },
      {
        mode: "INTERLEAVED_PRACTICE", objs: ["S", "B", "F", "M"], at: [-2, "16:30"], minutes: 40, prompts: 8, status: "DONE",
        run: {
          base: ["s3", "m1", "b2", "s5", "f3", "m4", "b1", "m2"],
          out: { s3: "I5", m1: "C3", b2: "C5", s5: "I5", f3: "C5", m4: "I1" },
          variants: { s3: ["I3", "C3"], s5: ["I3"], m4: ["C3"] },
        },
      },
      {
        mode: "ERROR_REPAIR", objs: ["S", "B", "F", "G", "R", "M"], at: [-1, "16:00"], minutes: 30, prompts: 8,
        status: "MISSED", missedMarkedAt: [-1, "21:15"],
      },
      { mode: "RETRIEVAL", objs: ["S", "B"], at: [0, "14:00"], minutes: 40, prompts: 8, status: "SCHEDULED" },
      { mode: "INTERLEAVED_PRACTICE", objs: ["F", "G", "R", "M"], at: [2, "16:00"], minutes: 50, prompts: 10, status: "SCHEDULED" },
      { mode: "EXAM_SIM", objs: ["S", "B", "F", "G", "R", "M"], at: [4, "16:00"], minutes: 60, prompts: 12, status: "SCHEDULED" },
      { mode: "ERROR_REPAIR", objs: ["S", "B", "F", "G", "R", "M"], at: [6, "16:00"], minutes: 30, prompts: 8, status: "SCHEDULED" },
    ],
  },
  {
    course: "AEM2210",
    created: [-7, "20:30"],
    window: { start: "13:00", end: "21:00" },
    chronotype: "flexible",
    sessions: [
      {
        mode: "RETRIEVAL", objs: ["A", "RR"], at: [-6, "15:00"], minutes: 30, prompts: 6, type: "diagnostic", status: "DONE",
        run: {
          base: ["a1", "rr1", "a2", "rr2", "a3", "rr3"],
          out: { a1: "C3", rr1: "I5", a2: "C5", rr2: "C3" },
          pretest: { A: "C3", RR: "P1" },
          variants: { rr1: ["C3"] },
        },
      },
      {
        mode: "RETRIEVAL", objs: ["D", "J"], at: [-1, "15:00"], minutes: 30, prompts: 6, status: "DONE",
        run: {
          base: ["d1", "j1", "d2", "j2", "d3", "j3"],
          out: { d1: "C", j1: "I3", d2: "C5", j2: "P3" },
          pretest: { D: "C3" },
          repair: { rr1: "C5" },
          variants: { j1: ["C3"], j2: ["I3", "C3"] },
        },
      },
      { mode: "WORKED_EXAMPLES", objs: ["J"], at: [1, "15:00"], minutes: 30, prompts: 8, status: "SCHEDULED" },
      { mode: "INTERLEAVED_PRACTICE", objs: ["A", "RR", "D", "J"], at: [5, "15:00"], minutes: 40, prompts: 10, status: "SCHEDULED" },
      { mode: "RETRIEVAL", objs: ["RR", "J"], at: [10, "15:00"], minutes: 30, prompts: 8, status: "SCHEDULED" },
      { mode: "EXAM_SIM", objs: ["A", "RR", "D", "J"], at: [15, "15:00"], minutes: 60, prompts: 12, status: "SCHEDULED" },
    ],
  },
  {
    course: "INFO4340",
    created: [-10, "21:00"],
    window: { start: "17:00", end: "23:00" },
    chronotype: "evening",
    sessions: [
      {
        mode: "RETRIEVAL", objs: ["C", "P"], at: [-9, "17:00"], minutes: 30, prompts: 6, type: "diagnostic", status: "DONE",
        run: {
          base: ["c1", "p1", "c2", "p2", "c3", "p3"],
          out: { c1: "C3", p1: "I3", c2: "C5", p2: "C3" },
          pretest: { C: "C3", P: "P1" },
          variants: { p1: ["C3"] },
        },
      },
      { mode: "RETRIEVAL", objs: ["RF", "CW"], at: [3, "19:00"], minutes: 30, prompts: 6, status: "SCHEDULED" },
      { mode: "INTERLEAVED_PRACTICE", objs: ["C", "P", "RF", "CW"], at: [11, "19:00"], minutes: 40, prompts: 10, status: "SCHEDULED" },
      { mode: "EXAM_SIM", objs: ["C", "P", "RF", "CW"], at: [19, "19:00"], minutes: 60, prompts: 12, status: "SCHEDULED" },
    ],
  },
  {
    course: "ECON1110",
    created: [-2, "13:05"],
    window: { start: "10:00", end: "20:00" },
    chronotype: "morning",
    sessions: [
      { mode: "RETRIEVAL", objs: ["SM", "EQ"], at: [5, "11:00"], minutes: 30, prompts: 6, type: "diagnostic", status: "SCHEDULED" },
      { mode: "RETRIEVAL", objs: ["EL"], at: [19, "11:00"], minutes: 30, prompts: 6, status: "SCHEDULED" },
      { mode: "INTERLEAVED_PRACTICE", objs: ["SM", "EQ", "EL"], at: [40, "11:00"], minutes: 40, prompts: 10, status: "SCHEDULED" },
      { mode: "EXAM_SIM", objs: ["SM", "EQ", "EL"], at: [55, "11:00"], minutes: 60, prompts: 12, status: "SCHEDULED" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function fail(message: string): never {
  console.error(`seed-demo: ${message}`);
  process.exit(1);
}

/** Deterministic PRNG so answer times and card ratings repeat run to run. */
function rngFor(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseOutcome(o: string): { s: "CORRECT" | "PARTIAL" | "INCORRECT"; conf: number | null } {
  const letter = o[0];
  const s = letter === "C" ? "CORRECT" : letter === "P" ? "PARTIAL" : letter === "I" ? "INCORRECT" : null;
  if (!s) throw new Error(`Bad outcome "${o}"`);
  const c = o.slice(1);
  const conf = c === "" ? null : Number(c);
  if (conf !== null && ![1, 3, 5].includes(conf)) throw new Error(`Bad confidence in "${o}" (use 1, 3 or 5)`);
  return { s, conf };
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function checkSafety(): { dbName: string; host: string; verbose: boolean } {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const verbose = args.includes("--verbose");
  if (process.env.NODE_ENV === "production") {
    fail("refusing to run with NODE_ENV=production.");
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    fail(
      "DATABASE_URL is not set. Point it at the demo database, for example\n" +
        "  DATABASE_URL=postgresql://postgres:postgres@localhost:5433/studybot_demo npx tsx scripts/seed-demo.ts",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fail("DATABASE_URL is not a valid connection URL.");
  }
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!dbName.toLowerCase().includes("demo") && !force) {
    fail(
      `refusing to seed database "${dbName}" because its name doesn't contain "demo". ` +
        "Pass --force to seed it anyway.",
    );
  }
  return { dbName, host: parsed.host, verbose };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { dbName, host, verbose } = checkSafety();

  // The seed never needs a real AI provider: summaries and AI text are
  // written here, and processing must not call out to OpenAI.
  process.env.AI_PROVIDER = "mock";
  process.env.LOG_LEVEL ??= "warn";

  console.log(`Seeding demo data into ${dbName} on ${host}`);

  // Imported after the safety checks so nothing touches the database first.
  const { prisma } = await import("../src/lib/db");
  const bcrypt = (await import("bcryptjs")).default;
  const { addDays, dayKey, daysBetween, zonedTimeToUtc } = await import("../src/lib/timezone");
  const { generateSessionId } = await import("../src/lib/session-id");
  const { slugifyObjectiveTitle } = await import("../src/lib/plan-generator");
  const { accuracyToQuality, confidenceAdjustedQuality, sm2Next, getMasterySummary } = await import("../src/lib/mastery");
  const { computeFollowups, followupsFromDueDates } = await import("../src/lib/spacing");
  const { generateVariantQuestion, MAX_VARIANTS_PER_SESSION } = await import("../src/lib/variant-questions");
  const { initBreakState } = await import("../src/lib/breaks");
  const { buildFeedbackQuery, searchChunks } = await import("../src/lib/search");
  const { resolveStoragePath } = await import("../src/lib/storage");
  const { prependBudget, pretestQuestionText, reviewQuestionText, crossSessionRepairText, humanizeObjectiveKey } =
    await import("../src/services/run");
  const { uploadDocument, processDocument } = await import("../src/services/content");
  const { buildObjectiveAnchors } = await import("../src/services/anchors");
  const { computeSM2 } = await import("../src/services/spaced-repetition");
  const { XP_AMOUNTS, getGameState } = await import("../src/services/gamification");
  const { getStudyRecommendations } = await import("../src/services/study-recommendations");
  const { ALL_BADGES } = await import("../src/lib/badge-data");
  type Prompt = import("../src/lib/prompts").Prompt;

  const now = new Date();
  const todayKey = dayKey(now, TZ);
  const at = (w: When): Date => zonedTimeToUtc(addDays(todayKey, w[0]), w[1], TZ);
  const plusSeconds = (d: Date, s: number) => new Date(d.getTime() + s * 1000);
  /** A calendar date as Prisma stores @db.Date columns (UTC midnight). */
  const calendarDate = (offset: number) => new Date(`${addDays(todayKey, offset)}T00:00:00.000Z`);

  // -------------------------------------------------------------------------
  // 1. Remove the previous demo user and everything that belongs to it
  // -------------------------------------------------------------------------

  const existing = await prisma.user.findMany({
    where: { OR: [{ id: DEMO_USER_ID }, { email: DEMO_EMAIL }] },
    select: { id: true },
  });
  const staleIds = Array.from(new Set([DEMO_USER_ID, ...existing.map((u) => u.id)]));

  await prisma.$transaction(
    async (tx) => {
      const userId = { in: staleIds };
      await tx.attemptCitation.deleteMany({ where: { attempt: { run: { userId } } } });
      await tx.sessionAttempt.deleteMany({ where: { run: { userId } } });
      await tx.sessionRunPrompt.deleteMany({ where: { run: { userId } } });
      await tx.sessionErrorLog.deleteMany({ where: { userId } });
      await tx.sessionRun.deleteMany({ where: { userId } });
      await tx.session.deleteMany({ where: { userId } });
      await tx.planItemExternalEvent.deleteMany({ where: { userId } });
      await tx.planCalendarPublication.deleteMany({ where: { userId } });
      await tx.studyPlanItem.deleteMany({ where: { plan: { userId } } });
      await tx.studyPlan.deleteMany({ where: { userId } });
      await tx.planReflowAudit.deleteMany({ where: { userId } });
      await tx.objectiveAnchor.deleteMany({ where: { userId } });
      await tx.cardReview.deleteMany({ where: { userId } });
      await tx.flashcard.deleteMany({ where: { deck: { userId } } });
      await tx.flashcardDeck.deleteMany({ where: { userId } });
      await tx.evidenceCard.deleteMany({ where: { paper: { userId } } });
      await tx.evidencePaper.deleteMany({ where: { userId } });
      await tx.contentChunk.deleteMany({ where: { document: { userId } } });
      await tx.contentDocument.deleteMany({ where: { userId } });
      await tx.objectiveMastery.deleteMany({ where: { userId } });
      await tx.studyGuide.deleteMany({ where: { userId } });
      await tx.xpEvent.deleteMany({ where: { userId } });
      await tx.achievement.deleteMany({ where: { userId } });
      await tx.userGameState.deleteMany({ where: { userId } });
      await tx.chatMessage.deleteMany({ where: { userId } });
      await tx.verificationToken.deleteMany({ where: { userId } });
      await tx.googleIntegration.deleteMany({ where: { userId } });
      await tx.oAuthState.deleteMany({ where: { userId } });
      await tx.aiCallLog.deleteMany({ where: { userId } });
      await tx.$executeRawUnsafe(
        `DELETE FROM job_queue WHERE payload->>'userId' = ANY($1::text[])`,
        staleIds,
      );
      await tx.user.deleteMany({ where: { id: userId } });
    },
    { timeout: 60_000 },
  );
  for (const id of staleIds) {
    // Uploaded files live under UPLOAD_DIR/<userId>/; resolveStoragePath keeps
    // the path inside UPLOAD_DIR.
    await rm(resolveStoragePath(id), { recursive: true, force: true });
  }

  // -------------------------------------------------------------------------
  // 2. User and settings
  // -------------------------------------------------------------------------

  const accountCreated = at([-22, "19:30"]);
  await prisma.user.create({
    data: {
      id: DEMO_USER_ID,
      email: DEMO_EMAIL,
      name: DEMO_NAME,
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 12),
      emailVerified: plusSeconds(accountCreated, 240),
      createdAt: accountCreated,
      updatedAt: accountCreated,
    },
  });
  await prisma.userGameState.create({
    data: {
      userId: DEMO_USER_ID,
      dailyXpGoal: 50,
      studyStartTime: "14:00",
      studyEndTime: "22:00",
      dailyStudyCap: 120,
      onboardingComplete: true,
      timezone: TZ,
      createdAt: accountCreated,
      updatedAt: plusSeconds(accountCreated, 600),
    },
  });

  // -------------------------------------------------------------------------
  // 3. Materials through the real upload and processing pipeline
  // -------------------------------------------------------------------------

  const docIdByFile = new Map<string, string>();
  for (const course of Object.values(COURSES)) {
    for (const doc of course.docs) {
      const upload = await uploadDocument(
        DEMO_USER_ID,
        "COURSE",
        course.name,
        course.exam,
        doc.title,
        doc.file,
        "text/markdown",
        Buffer.from(doc.body, "utf-8"),
      );
      const processed = await processDocument(DEMO_USER_ID, upload.document_id);
      if ("error" in processed || processed.data.status !== "PROCESSED") {
        throw new Error(`Processing failed for ${doc.file}`);
      }
      const uploadedAt = at(doc.uploaded);
      await prisma.contentDocument.update({
        where: { id: upload.document_id },
        data: {
          summary: doc.summary,
          suggestedQuestions: doc.questions,
          createdAt: uploadedAt,
          updatedAt: plusSeconds(uploadedAt, 20),
        },
      });
      await prisma.contentChunk.updateMany({
        where: { documentId: upload.document_id },
        data: { createdAt: plusSeconds(uploadedAt, 5) },
      });
      docIdByFile.set(doc.file, upload.document_id);
    }
  }
  // Processing queues embedding jobs. The demo runs on full-text search, so
  // drop the jobs instead of leaving them for a worker that may hold a real
  // OpenAI key, and record the chunks as not embedded.
  await prisma.$executeRawUnsafe(`DELETE FROM job_queue WHERE payload->>'userId' = $1`, DEMO_USER_ID);
  await prisma.contentChunk.updateMany({
    where: { document: { userId: DEMO_USER_ID } },
    data: { embeddingStatus: "NONE" },
  });

  // -------------------------------------------------------------------------
  // 4. Replay the session history in memory with the app's rules
  // -------------------------------------------------------------------------

  interface ObjectiveInfo extends DemoObjective {
    id: string;
  }
  const objectiveInfo = (course: DemoCourse, code: string): ObjectiveInfo => {
    const o = course.objectives.find((x) => x.code === code);
    if (!o) throw new Error(`Unknown objective ${code} in ${course.name}`);
    return { ...o, id: slugifyObjectiveTitle(o.title) };
  };
  const questionByKey = (course: DemoCourse, key: string): DemoQuestion => {
    const q = course.questions.find((x) => x.key === key);
    if (!q) throw new Error(`Unknown question ${key} in ${course.name}`);
    return q;
  };

  interface MasteryState {
    courseName: string;
    key: string;
    easeFactor: number;
    intervalDays: number;
    repetitions: number;
    lastAccuracy: number | null;
    lastStudiedAt: Date | null;
    nextDueAt: Date | null;
    updatedAt: Date;
    order: number;
  }
  interface ErrorState {
    id: string;
    runId: string;
    promptIndex: number;
    errorType: string;
    correctionRule: string;
    confidenceRating: number | null;
    correctStreak: number;
    lastCorrectAt: Date | null;
    resolvedAt: Date | null;
    resolvedByRunId: string | null;
    createdAt: Date;
    courseName: string;
    qKey: string;
    promptText: string;
  }
  interface PromptRow {
    id: string;
    runId: string;
    promptIndex: number;
    objectiveId: string | null;
    text: string;
    difficulty: number;
    sourceType: string;
    sourceRefId: string | null;
    meta: Record<string, unknown> | null;
    createdAt: Date;
    prompt: Prompt;
    /** Question key the prompt traces back to (base, repair source, or retry source). */
    srcKey: string | null;
    kind: "BASE" | "PRE_TEST" | "WARMUP" | "CROSS_SESSION_REPAIR" | "VARIANT_REPAIR";
  }
  interface AttemptRow {
    id: string;
    runId: string;
    promptIndex: number;
    promptId: string;
    promptText: string;
    userAnswer: string;
    selfScore: string;
    timeToAnswerSeconds: number;
    confidenceRating: number | null;
    createdAt: Date;
    /** Feedback is written for misses on generated questions. */
    feedbackFor?: { question: DemoQuestion; objectiveId: string | null; course: DemoCourse; rule: string };
  }
  interface RunMetrics {
    attempts_count: number;
    correct_count: number;
    partial_count: number;
    incorrect_count: number;
    accuracy: number;
    time_spent_seconds: number;
    pretest_count?: number;
    pretest_correct?: number;
    recommended_followups?: unknown;
  }

  const mastery = new Map<string, MasteryState>(); // `${course}||${key}`
  const errors: ErrorState[] = [];
  const sessionRows: Prisma.SessionCreateManyInput[] = [];
  const planRows: Prisma.StudyPlanCreateManyInput[] = [];
  const itemRows: Prisma.StudyPlanItemCreateManyInput[] = [];
  const runRows: Prisma.SessionRunCreateManyInput[] = [];
  const promptRows: PromptRow[] = [];
  const attemptRows: AttemptRow[] = [];
  const xpRows: Prisma.XpEventCreateManyInput[] = [];
  const sessionIdByCourseDay = new Map<string, string>();
  let todaySession: { sessionId: string; course: string; time: Date } | null = null;

  // Schedule every DONE session across all plans in time order, since
  // mastery, errors and repair questions carry across sessions of a course.
  const allSessions: { plan: PlanSpec; spec: SessionSpec; sessionId: string; start: Date }[] = [];

  for (const plan of PLANS) {
    const course = COURSES[plan.course];
    const created = at(plan.created);
    const planId = generateSessionId();
    const startKey = dayKey(created, TZ);
    const lastSession = plan.sessions[plan.sessions.length - 1];
    planRows.push({
      planId,
      userId: DEMO_USER_ID,
      courseId: "",
      courseName: course.name,
      examId: "",
      examName: course.exam,
      examDate: calendarDate(course.examOffset),
      timezone: TZ,
      startDate: created,
      endDate: zonedTimeToUtc(addDays(todayKey, lastSession.at[0]), "23:59", TZ),
      config: json({
        objectives: course.objectives.map((o) => o.title),
        availability: Array.from({ length: 7 }, () => plan.window),
        daily_study_cap_minutes: 120,
        break_protocol_default: "50_10",
        chronotype: plan.chronotype,
        preferred_session_minutes: 45,
        study_style: "balanced",
      }),
      createdAt: created,
      updatedAt: created,
    });

    for (const spec of plan.sessions) {
      const sessionId = generateSessionId();
      const objectives = spec.objs.map((c) => objectiveInfo(course, c));
      const start = at(spec.at);
      sessionRows.push({
        sessionId,
        userId: DEMO_USER_ID,
        courseId: "",
        courseName: course.name,
        examId: "",
        examName: course.exam,
        mode: spec.mode,
        topicScope: objectives.map((o) => o.title).join(", "),
        objectives: json(objectives.map((o) => ({ id: o.id, title: o.title }))),
        targetOutcome: json({
          ...(spec.type ? { type: spec.type } : {}),
          prompt_count: spec.prompts,
          target_accuracy: spec.mode === "EXAM_SIM" ? 0.7 : 0.8,
          closed_book_required: spec.mode === "RETRIEVAL" || spec.mode === "EXAM_SIM",
        }),
        breakProtocol: json({ type: "50_10", cycles: 1 }),
        plannedMinutes: spec.minutes,
        createdAt: created,
        updatedAt: created,
      });
      itemRows.push({
        id: randomUUID(),
        planId,
        sessionId,
        dayIndex: daysBetween(startKey, addDays(todayKey, spec.at[0])),
        startTime: start,
        endTime: plusSeconds(start, spec.minutes * 60),
        status: spec.status === "MISSED" ? "MISSED" : "SCHEDULED",
        missedAt: spec.missedMarkedAt ? at(spec.missedMarkedAt) : null,
        createdAt: created,
      });
      sessionIdByCourseDay.set(`${plan.course}|${spec.at[0]}`, sessionId);
      if (spec.at[0] === 0 && spec.status === "SCHEDULED" && plan.course === "INFO1300") {
        todaySession = { sessionId, course: course.name, time: start };
      }
      if (spec.status === "DONE") allSessions.push({ plan, spec, sessionId, start });
    }
  }
  allSessions.sort((a, b) => a.start.getTime() - b.start.getTime());

  const DAY_MS = 86_400_000;

  for (const { plan, spec, sessionId, start } of allSessions) {
    const course = COURSES[plan.course];
    const run = spec.run;
    if (!run) throw new Error(`DONE session without a run spec (${course.name} day ${spec.at[0]})`);
    const rng = rngFor(`${plan.course}|${spec.at[0]}`);
    const runId = generateSessionId();
    const objectives = spec.objs.map((c) => objectiveInfo(course, c));
    const objCodeById = new Map(course.objectives.map((o) => [slugifyObjectiveTitle(o.title), o.code]));
    const objTitleById = new Map(course.objectives.map((o) => [slugifyObjectiveTitle(o.title), o.title]));
    const examDate = calendarDate(course.examOffset);
    const startedAt = plusSeconds(start, 60 + Math.floor(rng() * 120));

    // Generated part of the deck (what the content-aware generator returns).
    const basePrompts: { prompt: Prompt; q: DemoQuestion }[] = run.base.map((key, i) => {
      const q = questionByKey(course, key);
      const objectiveId = objectiveInfo(course, q.obj).id;
      const prompt: Prompt = {
        id: `p_${i}`,
        objective_id: objectiveId,
        text: q.text,
        difficulty: q.difficulty,
        format: q.mcq ? "MCQ" : "FREE_RECALL",
        ...(q.mcq ? { choices: q.mcq.choices, correctIndex: q.mcq.correct } : {}),
        meta: {
          model_answer: q.model,
          key_points: q.points,
          ...(q.mcq ? { distractorRationales: q.mcq.rationales } : {}),
        },
      };
      return { prompt, q };
    });

    // Deck injection, mirroring startOrResumeRun: repair > pretest > review
    // questions within the budget, ordered pretest, review, repair.
    type Injected = { prompt: Prompt; kind: PromptRow["kind"]; srcKey: string | null };
    let ordered: Injected[] = [];
    if (spec.mode !== "EXAM_SIM" && spec.mode !== "ERROR_REPAIR" && spec.mode !== "WORKED_EXAMPLES") {
      const budget = prependBudget(spec.prompts);
      if (budget > 0) {
        const courseMastery = [...mastery.values()].filter((m) => m.courseName === course.name);
        const masteredKeys = new Set(courseMastery.map((m) => m.key));
        const pretests: Injected[] = objectives
          .filter((o) => !masteredKeys.has(o.id))
          .slice(0, 2)
          .map((o, i) => ({
            kind: "PRE_TEST",
            srcKey: o.code,
            prompt: {
              id: `pretest_${i}`,
              objective_id: o.id,
              text: pretestQuestionText(o.title),
              difficulty: 2,
              meta: { pack: "PRE_TEST" },
            },
          }));
        const warmups: Injected[] = courseMastery
          .filter((m) => m.nextDueAt && m.nextDueAt <= startedAt)
          .sort((a, b) => a.nextDueAt!.getTime() - b.nextDueAt!.getTime() || a.order - b.order)
          .slice(0, 5)
          .slice(0, 3)
          .map((m, i) => {
            const daysSince = m.lastStudiedAt
              ? Math.floor((startedAt.getTime() - m.lastStudiedAt.getTime()) / DAY_MS)
              : null;
            // Same lookup order as generateWarmupPrompts: the course's own
            // topic title, and only then the key made readable.
            const title = objTitleById.get(m.key) ?? humanizeObjectiveKey(m.key);
            return {
              kind: "WARMUP",
              srcKey: objCodeById.get(m.key) ?? m.key,
              prompt: {
                id: `warmup_${i}`,
                objective_id: m.key,
                text: reviewQuestionText(title, daysSince),
                difficulty: Math.min(m.repetitions + 1, 3),
                meta: { pack: "WARMUP" },
              },
            };
          });
        const repairs: Injected[] = errors
          .filter((e) => e.courseName === course.name && !e.resolvedAt)
          .sort(
            (a, b) =>
              (b.confidenceRating ?? -1) - (a.confidenceRating ?? -1) ||
              b.createdAt.getTime() - a.createdAt.getTime(),
          )
          .slice(0, 4)
          .slice(0, 2)
          .map((e, i) => {
            const daysSince = Math.floor((startedAt.getTime() - e.createdAt.getTime()) / DAY_MS);
            return {
              kind: "CROSS_SESSION_REPAIR",
              srcKey: e.qKey,
              prompt: {
                id: `repair_${i}`,
                objective_id: undefined,
                text: crossSessionRepairText({ daysSince, originalText: e.promptText }),
                difficulty: 2,
                meta: {
                  pack: "CROSS_SESSION_REPAIR",
                  source_error_log_id: e.id,
                  original_prompt_text: e.promptText,
                  expected_correction_rule: e.correctionRule,
                },
              },
            };
          });
        const selected: Injected[] = [];
        for (const list of [repairs, pretests, warmups]) {
          for (const p of list) if (selected.length < budget) selected.push(p);
        }
        ordered = [
          ...selected.filter((p) => p.kind === "PRE_TEST"),
          ...selected.filter((p) => p.kind === "WARMUP"),
          ...selected.filter((p) => p.kind === "CROSS_SESSION_REPAIR"),
        ];
      }
    }
    const remainder = Math.max(1, spec.prompts - ordered.length);
    if (basePrompts.length < remainder) {
      throw new Error(
        `${course.name} day ${spec.at[0]}: deck needs ${remainder} generated questions but the spec lists ${basePrompts.length}`,
      );
    }
    const deck: Injected[] = [
      ...ordered,
      ...basePrompts.slice(0, remainder).map((b) => ({ prompt: b.prompt, kind: "BASE" as const, srcKey: b.q.key })),
    ];

    const rows: PromptRow[] = deck.map((d, i) => {
      const p = d.prompt;
      const storedMeta: Record<string, unknown> = p.meta ? { ...p.meta } : {};
      if (p.format === "MCQ" && p.choices && p.correctIndex != null) {
        storedMeta.format = p.format;
        storedMeta.choices = p.choices;
        storedMeta.correctIndex = p.correctIndex;
      }
      return {
        id: randomUUID(),
        runId,
        promptIndex: i,
        objectiveId: p.objective_id ?? null,
        text: p.text,
        difficulty: p.difficulty ?? 1,
        sourceType: p.meta?.source_error_log_id ? "ERROR_LOG" : "GENERATED",
        sourceRefId: p.meta?.source_error_log_id ?? null,
        meta: Object.keys(storedMeta).length > 0 ? storedMeta : null,
        createdAt: startedAt,
        prompt: p,
        srcKey: d.srcKey,
        kind: d.kind,
      };
    });

    // Answer the deck in order. Misses inject retry questions at the end.
    const metrics: RunMetrics = {
      attempts_count: 0,
      correct_count: 0,
      partial_count: 0,
      incorrect_count: 0,
      accuracy: 0,
      time_spent_seconds: 0,
    };
    const variantSeen = new Map<string, number>();
    const runAttempts: AttemptRow[] = [];
    let t = startedAt;
    let variantCount = 0;
    const trace: string[] = [];

    for (let idx = 0; idx < rows.length; idx++) {
      const row = rows[idx];
      const p = row.prompt;
      const srcKey = row.srcKey ?? "";
      let outcomeCode: string;
      switch (row.kind) {
        case "BASE":
          outcomeCode = run.out[srcKey] ?? fail(`${course.name} day ${spec.at[0]}: no outcome for question ${srcKey}`);
          break;
        case "PRE_TEST":
          outcomeCode = run.pretest?.[srcKey] ?? "P1";
          break;
        case "WARMUP":
          outcomeCode = run.warmup?.[srcKey] ?? "C3";
          break;
        case "CROSS_SESSION_REPAIR":
          outcomeCode = run.repair?.[srcKey] ?? "C3";
          break;
        case "VARIANT_REPAIR": {
          const n = variantSeen.get(srcKey) ?? 0;
          variantSeen.set(srcKey, n + 1);
          outcomeCode = run.variants?.[srcKey]?.[n] ?? "C3";
          break;
        }
      }
      const outcome = parseOutcome(outcomeCode);
      const q = srcKey && row.kind !== "PRE_TEST" && row.kind !== "WARMUP" ? questionByKey(course, srcKey) : null;
      const isMcq = row.kind === "BASE" && !!q?.mcq;
      let score = outcome.s;
      if (isMcq && score === "PARTIAL") score = "INCORRECT";
      const correct = score === "CORRECT";

      // Answer text and timing
      let userAnswer: string;
      let seconds: number;
      if (row.kind === "PRE_TEST" || row.kind === "WARMUP") {
        const obj = objectiveInfo(course, srcKey);
        userAnswer = correct ? obj.recall : obj.weak;
        seconds = 35 + Math.floor(rng() * 60);
      } else if (isMcq && q?.mcq) {
        const choice = correct ? q.mcq.correct : q.mcq.trap;
        userAnswer = `[${String.fromCharCode(65 + choice)}] ${q.mcq.choices[choice]}`;
        seconds = 12 + Math.floor(rng() * 35);
      } else {
        userAnswer = correct ? q!.good : score === "PARTIAL" ? q!.partial ?? q!.bad : q!.bad;
        seconds = 40 + Math.floor(rng() * (40 + 25 * (q?.difficulty ?? 2)));
      }
      t = plusSeconds(t, seconds + 8 + Math.floor(rng() * 20));

      const attemptId = randomUUID();
      const attempt: AttemptRow = {
        id: attemptId,
        runId,
        promptIndex: row.promptIndex,
        promptId: row.id,
        promptText: p.text,
        userAnswer,
        selfScore: score,
        timeToAnswerSeconds: seconds,
        confidenceRating: outcome.conf,
        createdAt: t,
      };

      // Metrics (pretest questions are tracked apart from accuracy)
      const isPretest = row.kind === "PRE_TEST";
      metrics.time_spent_seconds += seconds;
      if (isPretest) {
        metrics.pretest_count = (metrics.pretest_count ?? 0) + 1;
        metrics.pretest_correct = (metrics.pretest_correct ?? 0) + (correct ? 1 : 0);
      } else {
        metrics.attempts_count += 1;
        metrics.correct_count += correct ? 1 : 0;
        metrics.partial_count += score === "PARTIAL" ? 1 : 0;
        metrics.incorrect_count += score === "INCORRECT" ? 1 : 0;
        metrics.accuracy = metrics.correct_count / metrics.attempts_count;
      }

      // Error log for a miss on a generated question
      const sourceErrorLogId = p.meta?.source_error_log_id;
      let errorLog: { type: string; rule: string } | undefined;
      let newErrorId: string | undefined;
      if (!correct && !isPretest && row.kind === "BASE" && q) {
        if (isMcq && q.mcq) {
          const rationale = q.mcq.rationales[q.mcq.trap];
          errorLog = {
            type: "MISCONCEPTION",
            rule: `The correct answer is "${q.mcq.choices[q.mcq.correct]}".${rationale ? ` Common trap: ${rationale}` : ""}`,
          };
        } else {
          errorLog = { type: q.errorType, rule: q.rule };
        }
        newErrorId = randomUUID();
        errors.push({
          id: newErrorId,
          runId,
          promptIndex: row.promptIndex,
          errorType: errorLog.type,
          correctionRule: errorLog.rule,
          confidenceRating: outcome.conf,
          correctStreak: 0,
          lastCorrectAt: null,
          resolvedAt: null,
          resolvedByRunId: null,
          createdAt: t,
          courseName: course.name,
          qKey: q.key,
          promptText: p.text,
        });
        attempt.feedbackFor = { question: q, objectiveId: row.objectiveId, course, rule: errorLog.rule };
      }

      // Successive relearning: a source error resolves after correct answers
      // on 2 different days; a miss resets the streak.
      if (sourceErrorLogId && !isPretest) {
        const src = errors.find((e) => e.id === sourceErrorLogId);
        if (src && !src.resolvedAt) {
          if (correct) {
            const today = dayKey(t, TZ);
            const lastDay = src.lastCorrectAt ? dayKey(src.lastCorrectAt, TZ) : null;
            if (lastDay !== today) {
              src.correctStreak += 1;
              src.lastCorrectAt = t;
              if (src.correctStreak >= 2) {
                src.resolvedAt = t;
                src.resolvedByRunId = runId;
              }
            }
          } else {
            src.correctStreak = 0;
          }
        }
      }

      // In-session retry question after a miss
      if (!correct && (errorLog || sourceErrorLogId) && !isPretest && spec.mode !== "ERROR_REPAIR") {
        if (variantCount < MAX_VARIANTS_PER_SESSION) {
          const repairSourceId = sourceErrorLogId ?? newErrorId;
          const sourceText =
            isMcq && q?.mcq
              ? `${p.text} (Correct answer: "${q.mcq.choices[q.mcq.correct]}"; you chose "${q.mcq.choices[q.mcq.trap]}")`
              : p.text;
          const promptIndex = rows.length;
          const variant = generateVariantQuestion(
            promptIndex,
            sourceText,
            errorLog?.type ?? "MISCONCEPTION",
            errorLog?.rule ?? p.meta?.expected_correction_rule ?? "",
            p.objective_id,
            repairSourceId,
          );
          rows.push({
            id: randomUUID(),
            runId,
            promptIndex,
            objectiveId: variant.objective_id ?? null,
            text: variant.text,
            difficulty: variant.difficulty,
            sourceType: "VARIANT_REPAIR",
            sourceRefId: repairSourceId ?? null,
            meta: (variant.meta as Record<string, unknown>) ?? null,
            createdAt: t,
            prompt: variant,
            srcKey: srcKey || null,
            kind: "VARIANT_REPAIR",
          });
          variantCount += 1;
        }
      }

      runAttempts.push(attempt);
      trace.push(`${row.promptIndex}:${row.kind === "BASE" ? srcKey : `${row.kind}(${srcKey})`}=${score[0]}${outcome.conf ?? "-"}`);
    }

    const endedAt = plusSeconds(t, 15);

    // SM-2 mastery per objective, as updateObjectiveMastery does it
    const byObjective = new Map<string, { correct: number; total: number; confSum: number; confCount: number }>();
    for (const a of runAttempts) {
      const row = rows[a.promptIndex];
      if (!row.objectiveId || row.kind === "PRE_TEST") continue;
      const e = byObjective.get(row.objectiveId) ?? { correct: 0, total: 0, confSum: 0, confCount: 0 };
      e.total += 1;
      if (a.selfScore === "CORRECT") e.correct += 1;
      if (a.confidenceRating != null) {
        e.confSum += a.confidenceRating;
        e.confCount += 1;
      }
      byObjective.set(row.objectiveId, e);
    }
    for (const [key, e] of byObjective) {
      const mapKey = `${course.name}||${key}`;
      const current = mastery.get(mapKey);
      const accuracy = e.total > 0 ? e.correct / e.total : 0;
      const avgConfidence = e.confCount > 0 ? e.confSum / e.confCount : null;
      const quality = confidenceAdjustedQuality(accuracyToQuality(accuracy), accuracy, avgConfidence);
      const next = sm2Next(
        current
          ? { easeFactor: current.easeFactor, intervalDays: current.intervalDays, repetitions: current.repetitions }
          : { easeFactor: 2.5, intervalDays: 0, repetitions: 0 },
        quality,
        endedAt,
        examDate,
      );
      mastery.set(mapKey, {
        courseName: course.name,
        key,
        easeFactor: next.easeFactor,
        intervalDays: next.intervalDays,
        repetitions: next.repetitions,
        lastAccuracy: accuracy,
        lastStudiedAt: endedAt,
        nextDueAt: next.nextDueAt,
        updatedAt: endedAt,
        order: current?.order ?? mastery.size,
      });
    }

    // Follow-ups come from the SM-2 due dates, else the fixed ladder
    const dueDates = [...mastery.values()]
      .filter((m) => m.courseName === course.name && m.nextDueAt)
      .sort((a, b) => a.nextDueAt!.getTime() - b.nextDueAt!.getTime())
      .slice(0, 3)
      .map((m) => m.nextDueAt!);
    const followups = followupsFromDueDates(dueDates, endedAt);
    const finalMetrics: RunMetrics = {
      ...metrics,
      recommended_followups: followups.length > 0 ? followups : computeFollowups(metrics.accuracy, endedAt),
    };

    const breakState = initBreakState({ type: "50_10", cycles: 1 });
    runRows.push({
      runId,
      sessionId,
      userId: DEMO_USER_ID,
      mode: spec.mode,
      phase: "COMPLETE",
      status: "COMPLETED",
      startedAt,
      endedAt,
      currentIndex: rows.length,
      promptCount: rows.length,
      answeredCount: null,
      scoredCount: null,
      prompts: json(deck.map((d) => d.prompt)),
      policies: json({
        scoring: "IMMEDIATE",
        requiresErrorLogOn: ["PARTIAL", "INCORRECT"],
        allowHintsBeforeAnswer: false,
        allowEndBreakEarly: true,
      }),
      metrics: json(finalMetrics),
      breakState: json({ ...breakState, work_started_at: startedAt.toISOString() }),
      createdAt: startedAt,
      updatedAt: endedAt,
    });
    promptRows.push(...rows);
    attemptRows.push(...runAttempts);
    xpRows.push({
      userId: DEMO_USER_ID,
      action: "SESSION_COMPLETED",
      xpAmount: XP_AMOUNTS.SESSION_COMPLETED,
      sourceId: runId,
      createdAt: plusSeconds(endedAt, 1),
    });
    const item = itemRows.find((i) => i.sessionId === sessionId)!;
    item.status = "DONE";
    item.completedRunId = runId;
    item.completedAt = plusSeconds(endedAt, 1);

    if (verbose) {
      const perObjective = [...byObjective.entries()]
        .map(([k, e]) => `${k} ${e.correct}/${e.total}`)
        .join(", ");
      console.log(
        `  ${course.name} ${addDays(todayKey, spec.at[0])} ${spec.mode}: ${trace.join(" ")}\n` +
          `    accuracy ${Math.round(metrics.accuracy * 100)}% | ${perObjective}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // 5. Persist sessions, plans and history
  // -------------------------------------------------------------------------

  await prisma.session.createMany({ data: sessionRows });
  await prisma.studyPlan.createMany({ data: planRows });
  await prisma.studyPlanItem.createMany({ data: itemRows });
  await prisma.sessionRun.createMany({ data: runRows });
  await prisma.sessionRunPrompt.createMany({
    data: promptRows.map((r) => ({
      id: r.id,
      runId: r.runId,
      promptIndex: r.promptIndex,
      objectiveId: r.objectiveId,
      text: r.text,
      difficulty: r.difficulty,
      sourceType: r.sourceType,
      sourceRefId: r.sourceRefId,
      meta: r.meta ? json(r.meta) : undefined,
      createdAt: r.createdAt,
    })),
  });
  await prisma.sessionAttempt.createMany({
    data: attemptRows.map((a) => ({
      id: a.id,
      runId: a.runId,
      promptIndex: a.promptIndex,
      promptId: a.promptId,
      promptText: a.promptText,
      userAnswer: a.userAnswer,
      selfScore: a.selfScore,
      timeToAnswerSeconds: a.timeToAnswerSeconds,
      confidenceRating: a.confidenceRating,
      createdAt: a.createdAt,
    })),
  });
  await prisma.sessionErrorLog.createMany({
    data: errors.map((e) => ({
      id: e.id,
      runId: e.runId,
      userId: DEMO_USER_ID,
      promptIndex: e.promptIndex,
      errorType: e.errorType,
      correctionRule: e.correctionRule,
      confidenceRating: e.confidenceRating,
      correctStreak: e.correctStreak,
      lastCorrectAt: e.lastCorrectAt,
      resolvedAt: e.resolvedAt,
      resolvedByRunId: e.resolvedByRunId,
      createdAt: e.createdAt,
    })),
  });
  await prisma.objectiveMastery.createMany({
    data: [...mastery.values()].map((m) => ({
      userId: DEMO_USER_ID,
      courseName: m.courseName,
      objectiveKey: m.key,
      easeFactor: m.easeFactor,
      intervalDays: m.intervalDays,
      repetitions: m.repetitions,
      lastAccuracy: m.lastAccuracy,
      lastStudiedAt: m.lastStudiedAt,
      nextDueAt: m.nextDueAt,
      updatedAt: m.updatedAt,
    })),
  });

  // Objective anchors through the real service (full-text search per topic),
  // as plan creation does.
  for (const course of Object.values(COURSES)) {
    await buildObjectiveAnchors(
      DEMO_USER_ID,
      course.name,
      course.exam,
      course.objectives.map((o) => ({ id: slugifyObjectiveTitle(o.title), title: o.title })),
    );
  }

  // Stored feedback for misses: numbered sources from the anchors (or a
  // full-text fallback), the AI explanation, and the citation rows.
  let feedbackCount = 0;
  for (const a of attemptRows) {
    if (!a.feedbackFor) continue;
    const { question, objectiveId, course, rule } = a.feedbackFor;
    let sources: { chunk_id: string; doc_title: string; page_number: number | null; snippet: string }[] = [];
    if (objectiveId) {
      const anchors = await prisma.objectiveAnchor.findMany({
        where: { userId: DEMO_USER_ID, courseName: course.name, examName: course.exam, objectiveId },
        orderBy: { rank: "asc" },
        take: 5,
        include: { chunk: { include: { document: { select: { title: true } } } } },
      });
      sources = anchors.map((x) => ({
        chunk_id: x.chunkId,
        doc_title: x.chunk.document.title,
        page_number: x.chunk.pageNumber,
        snippet: x.chunk.text.slice(0, 300),
      }));
    }
    if (sources.length === 0) {
      const objective = course.objectives.find((o) => o.code === question.obj);
      sources = await searchChunks({
        userId: DEMO_USER_ID,
        q: buildFeedbackQuery(a.promptText, rule, objective?.title),
        namespace: "COURSE",
        courseName: course.name,
        examName: course.exam,
        topK: 5,
      });
    }
    const excerpts = sources.map((s, i) => ({ ...s, rank: i + 1 }));
    await prisma.sessionAttempt.update({
      where: { id: a.id },
      data: {
        feedbackStatus: "READY",
        feedbackJson: json({
          status: "OK",
          excerpts,
          ...(excerpts.length === 0 ? { no_sources: true } : {}),
          explanation: question.explain,
          key_takeaway: rule,
        }),
      },
    });
    if (excerpts.length > 0) {
      await prisma.attemptCitation.createMany({
        data: excerpts.map((x) => ({
          attemptId: a.id,
          chunkId: x.chunk_id,
          rank: x.rank,
          snippet: x.snippet,
          createdAt: a.createdAt,
        })),
      });
    }
    feedbackCount += 1;
  }

  // -------------------------------------------------------------------------
  // 6. Flashcards with SM-2 review history
  // -------------------------------------------------------------------------

  let reviewCount = 0;
  const dueByDeck: { title: string; due: number; total: number }[] = [];
  for (const deck of DECKS) {
    const course = COURSES[deck.course];
    const created = at(deck.created);
    const deckId = randomUUID();
    await prisma.flashcardDeck.create({
      data: {
        id: deckId,
        userId: DEMO_USER_ID,
        courseName: course.name,
        examName: course.exam,
        documentId: docIdByFile.get(deck.docFile) ?? null,
        title: deck.title,
        cardCount: deck.cards.length,
        createdAt: created,
      },
    });
    const cards = deck.cards.map((c, i) => ({
      ...c,
      id: randomUUID(),
      ordinal: i,
      easeFactor: 2.5,
      intervalDays: 0,
      repetitions: 0,
      nextDueAt: null as Date | null,
      introduced: false,
    }));
    const reviews: Prisma.CardReviewCreateManyInput[] = [];
    const rng = rngFor(`deck|${deck.title}`);
    const rate = (hardness: number): "AGAIN" | "HARD" | "GOOD" | "EASY" => {
      const r = rng();
      if (r < 0.3 * hardness) return "AGAIN";
      if (r < 0.65 * hardness) return "HARD";
      if (hardness < 0.35 && r > 0.8) return "EASY";
      return "GOOD";
    };
    const review = (card: (typeof cards)[number], rating: "AGAIN" | "HARD" | "GOOD" | "EASY", when: Date) => {
      const next = computeSM2(card.easeFactor, card.intervalDays, card.repetitions, rating);
      card.easeFactor = next.easeFactor;
      card.intervalDays = next.intervalDays;
      card.repetitions = next.repetitions;
      if (next.intervalDays === 0) {
        card.nextDueAt = new Date(when.getTime() + 10 * 60_000);
      } else {
        // Same rule as computeSM2, anchored at the review time: due at 4am
        // (server local time) the given number of days later.
        const due = new Date(when);
        due.setDate(due.getDate() + next.intervalDays);
        due.setHours(4, 0, 0, 0);
        card.nextDueAt = due;
      }
      reviews.push({
        cardId: card.id,
        userId: DEMO_USER_ID,
        rating,
        easeFactor: next.easeFactor,
        intervalDays: next.intervalDays,
        repetitions: next.repetitions,
        createdAt: when,
      });
      xpRows.push({
        userId: DEMO_USER_ID,
        action: "FLASHCARD_REVIEW",
        xpAmount: XP_AMOUNTS.FLASHCARD_REVIEW,
        sourceId: card.id,
        createdAt: when,
      });
    };

    for (const s of deck.sessions) {
      let when = at(s.at);
      const due = cards
        .filter((c) => c.introduced && c.nextDueAt && c.nextDueAt <= when)
        .sort((a, b) => a.nextDueAt!.getTime() - b.nextDueAt!.getTime())
        .slice(0, s.maxDue);
      const fresh = cards.filter((c) => !c.introduced).slice(0, s.newCards);
      // Never review a whole deck in one day: the app would award a perfect
      // deck bonus (and an achievement) that this history doesn't include.
      const queue = [...due, ...fresh].slice(0, cards.length - 1);
      const again: typeof cards = [];
      for (const card of queue) {
        card.introduced = true;
        const rating = rate(card.hardness);
        review(card, rating, when);
        if (rating === "AGAIN") again.push(card);
        when = plusSeconds(when, 15 + Math.floor(rng() * 25));
      }
      for (const card of again) {
        review(card, rng() < 0.6 ? "GOOD" : "HARD", when);
        when = plusSeconds(when, 15 + Math.floor(rng() * 20));
      }
    }

    await prisma.flashcard.createMany({
      data: cards.map((c) => ({
        id: c.id,
        deckId,
        front: c.front,
        back: c.back,
        tags: c.tags,
        ordinal: c.ordinal,
        easeFactor: c.easeFactor,
        intervalDays: c.intervalDays,
        repetitions: c.repetitions,
        nextDueAt: c.nextDueAt,
        createdAt: created,
      })),
    });
    await prisma.cardReview.createMany({ data: reviews });
    reviewCount += reviews.length;
    dueByDeck.push({
      title: deck.title,
      due: cards.filter((c) => (c.nextDueAt ? c.nextDueAt <= now : c.repetitions === 0)).length,
      total: cards.length,
    });
  }

  await prisma.xpEvent.createMany({ data: xpRows });

  // -------------------------------------------------------------------------
  // 7. Study guides and chat
  // -------------------------------------------------------------------------

  for (const g of GUIDES) {
    const course = COURSES[g.course];
    const created = at(g.created);
    await prisma.studyGuide.create({
      data: {
        userId: DEMO_USER_ID,
        courseName: course.name,
        examName: course.exam,
        guideType: g.type,
        title: g.title,
        content: json(g.sections),
        createdAt: created,
        updatedAt: created,
      },
    });
  }

  let chatCount = 0;
  for (const chat of CHATS) {
    const course = COURSES[chat.course];
    const courseKey = `${course.name}||${course.exam}`;
    let offset = 0;
    for (const m of chat.messages) {
      let citations: { chunk_id: string; reason: string; quote_snippet: string }[] | undefined;
      if (m.cites) {
        citations = [];
        for (const c of m.cites) {
          const documentId = docIdByFile.get(c.docFile);
          const chunk = documentId
            ? await prisma.contentChunk.findFirst({ where: { documentId, text: { contains: c.phrase } } })
            : null;
          if (!chunk) throw new Error(`Chat citation not found: "${c.phrase}" in ${c.docFile}`);
          const start = chunk.text.indexOf(c.phrase);
          const end = chunk.text.indexOf(".", start + c.phrase.length);
          const quote = chunk.text.slice(start, end > 0 ? Math.min(end + 1, start + 240) : start + 200);
          citations.push({ chunk_id: chunk.id, reason: c.reason, quote_snippet: quote });
        }
      }
      // Assistant replies land a few seconds after the question.
      offset = m.role === "assistant" ? offset + 6 : 0;
      await prisma.chatMessage.create({
        data: {
          userId: DEMO_USER_ID,
          courseKey,
          role: m.role,
          content: m.content,
          citations: citations ? json(citations) : undefined,
          createdAt: plusSeconds(at(m.at), offset),
        },
      });
      chatCount += 1;
    }
  }

  // -------------------------------------------------------------------------
  // 8. Achievements the app would have awarded for this activity
  // -------------------------------------------------------------------------

  const events = [...xpRows].sort((a, b) => (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime());
  const activeDays = new Set<string>();
  const earned = new Map<string, Date>();
  let totalXp = 0;
  let reviews = 0;
  for (const e of events) {
    const when = e.createdAt as Date;
    const day = dayKey(when, TZ);
    activeDays.add(day);
    totalXp += e.xpAmount;
    if (e.action === "FLASHCARD_REVIEW") reviews += 1;
    let streak = 0;
    for (let d = day; activeDays.has(d); d = addDays(d, -1)) streak += 1;
    for (const badge of ALL_BADGES) {
      if (earned.has(badge.key) || badge.key === "FIRST_PERFECT") continue;
      const value = badge.category === "streak" ? streak : badge.category === "xp" ? totalXp : reviews;
      if (value >= badge.threshold) earned.set(badge.key, when);
    }
  }
  await prisma.achievement.createMany({
    data: [...earned.entries()].map(([badgeType, earnedAt]) => ({ userId: DEMO_USER_ID, badgeType, earnedAt })),
  });

  // -------------------------------------------------------------------------
  // 9. Check the result through the app's own read paths and report
  // -------------------------------------------------------------------------

  const game = await getGameState(DEMO_USER_ID);
  if (game.newAchievements.length > 0) {
    console.warn(`  warning: the app awarded extra achievements on read: ${game.newAchievements.join(", ")}`);
  }
  const recs = await getStudyRecommendations(DEMO_USER_ID, COURSES.INFO1300.name);
  const masterySummary = await getMasterySummary(DEMO_USER_ID, COURSES.INFO1300.name);

  const counts = {
    documents: await prisma.contentDocument.count({ where: { userId: DEMO_USER_ID } }),
    chunks: await prisma.contentChunk.count({ where: { document: { userId: DEMO_USER_ID } } }),
    plans: await prisma.studyPlan.count({ where: { userId: DEMO_USER_ID } }),
    planItems: await prisma.studyPlanItem.count({ where: { plan: { userId: DEMO_USER_ID } } }),
    sessions: await prisma.session.count({ where: { userId: DEMO_USER_ID } }),
    completedRuns: await prisma.sessionRun.count({ where: { userId: DEMO_USER_ID } }),
    questions: await prisma.sessionRunPrompt.count({ where: { run: { userId: DEMO_USER_ID } } }),
    attempts: await prisma.sessionAttempt.count({ where: { run: { userId: DEMO_USER_ID } } }),
    citations: await prisma.attemptCitation.count({ where: { attempt: { run: { userId: DEMO_USER_ID } } } }),
    errorLogs: await prisma.sessionErrorLog.count({ where: { userId: DEMO_USER_ID } }),
    unresolvedErrors: await prisma.sessionErrorLog.count({ where: { userId: DEMO_USER_ID, resolvedAt: null } }),
    masteryRows: await prisma.objectiveMastery.count({ where: { userId: DEMO_USER_ID } }),
    anchors: await prisma.objectiveAnchor.count({ where: { userId: DEMO_USER_ID } }),
    decks: await prisma.flashcardDeck.count({ where: { userId: DEMO_USER_ID } }),
    cards: await prisma.flashcard.count({ where: { deck: { userId: DEMO_USER_ID } } }),
    cardReviews: await prisma.cardReview.count({ where: { userId: DEMO_USER_ID } }),
    guides: await prisma.studyGuide.count({ where: { userId: DEMO_USER_ID } }),
    chatMessages: await prisma.chatMessage.count({ where: { userId: DEMO_USER_ID } }),
    xpEvents: await prisma.xpEvent.count({ where: { userId: DEMO_USER_ID } }),
    achievements: await prisma.achievement.count({ where: { userId: DEMO_USER_ID } }),
  };

  const pct = (v: number | null) => (v == null ? "n/a" : `${Math.round(v * 100)}%`);
  console.log("");
  console.log("Demo data ready");
  console.log(`  Sign in:     ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  User id:     ${DEMO_USER_ID}`);
  console.log(`  Today:       ${todayKey} (${TZ})`);
  if (todaySession) {
    console.log(`  Today's session: /s/${todaySession.sessionId} (${todaySession.course}, 2:00 PM)`);
  }
  console.log("");
  console.log("  Counts");
  for (const [k, v] of Object.entries(counts)) console.log(`    ${k.padEnd(18)} ${v}`);
  console.log(`    feedback stored    ${feedbackCount}`);
  console.log(`    chat inserted      ${chatCount}`);
  console.log("");
  console.log("  Progress (read back through the app's services)");
  console.log(`    streak ${game.streak} days, ${game.xpTotal} XP total, ${game.xpToday} XP today, ${game.reviewCount} card reviews`);
  console.log(`    achievements: ${game.achievements.map((x) => x.badgeType).join(", ")}`);
  console.log(`    INFO 1300 recommendation: ${recs.next_session.mode}, ${recs.unresolved_errors.count} unresolved errors, plan nudge ${recs.plan_nudge ? "yes" : "no"}`);
  console.log(
    `    INFO 1300 mastery: ${masterySummary.objectives
      .map((o) => `${o.objective_key} ${pct(o.last_accuracy)}${o.is_due ? " (due)" : ""}`)
      .join(", ")}`,
  );
  for (const d of dueByDeck) console.log(`    deck "${d.title}": ${d.due} of ${d.total} cards due now`);
  console.log(`    total card reviews seeded: ${reviewCount}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    const { prisma } = await import("../src/lib/db");
    await prisma.$disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
