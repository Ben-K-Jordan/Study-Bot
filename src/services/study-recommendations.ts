/**
 * Study recommendations: what the student should run next for a course,
 * and why.
 *
 * Synthesizes SM-2 mastery, the error log, the active plan and session
 * history into one recommended session. Every string this file returns is
 * shown on screen, so it follows VOICE.md: topic titles instead of mastery
 * keys, mode labels instead of enums, and plain reasons with no citations.
 */

import { prisma } from "@/lib/db";
import { getDueObjectives, getMasterySummary } from "@/lib/mastery";
import { logger } from "@/lib/logger";
import { dayKey, daysBetween } from "@/lib/timezone";
import { dateColumnKey, dateColumnValue } from "@/lib/plan-dates";
import { buildObjectiveIdMap } from "@/lib/plan-generator";
import { humanizeObjectiveKey } from "@/lib/objective-keys";
import { formatList, formatTime, formatTopicList, plural } from "@/lib/format";
import { getStreak, resolveTimeZone } from "@/services/gamification";
import { createSession } from "@/services/session";
import { endOfToday } from "@/services/spaced-repetition";
import { isOpenPlanStatus, isUnstartedPlanStatus } from "@/lib/home-model";
import {
  breakProtocolFor,
  questionCountFor,
  studyModeLabel,
  type SessionLength,
  type StudyModeKey,
} from "@/lib/study-modes";
import { examCountdown } from "@/lib/study-copy";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RecommendedMode = Exclude<StudyModeKey, "WORKED_EXAMPLES">;

/** A topic (learning objective) with the title the student knows it by. */
export interface StudyTopic {
  key: string;
  title: string;
}

interface RecommendedSession {
  mode: RecommendedMode;
  /** Mastery keys, in priority order. */
  objectives: string[];
  /** The same topics with readable titles. */
  topics: StudyTopic[];
  /** Titles as one line: "Specificity, Box sizing, and 2 more". */
  topic_scope: string;
  /** Why this mode, in one or two plain sentences. Rule-based, not AI. */
  reason: string;
  /**
   * The reason without the error count, for Error repair under a line that
   * already gives it ("Retests your 9 unresolved errors, …"). The same as
   * `reason` for every other mode.
   */
  reason_without_count: string;
}

interface OverdueObjective {
  objective_key: string;
  title: string;
  next_due_at: string | null;
  last_accuracy: number | null;
  days_overdue: number;
}

interface WeakObjective {
  objective_key: string;
  title: string;
  last_accuracy: number | null;
  ease_factor: number;
  repetitions: number;
}

interface UnresolvedErrorsSummary {
  count: number;
  recent_error_types: string[];
}

export interface PlannedSessionRef {
  session_id: string;
  start_time: string;
  end_time: string;
  /** SCHEDULED or RESCHEDULED, or IN_PROGRESS once a run has started. */
  status: string;
  mode: string;
  mode_label: string;
  topic_scope: string;
  /** "Today at 2:30 PM: Retrieval on Photosynthesis light reactions" */
  message: string;
}

interface PlanNudge {
  plan_id: string;
  items: PlannedSessionRef[];
}

export interface ExamRef {
  name: string;
  /** Calendar date of the exam, YYYY-MM-DD. */
  date: string;
  /** Whole days from today in the student's time zone (0 = today). */
  days_until: number;
}

export interface StudyRecommendations {
  course_name: string;
  next_session: RecommendedSession;
  overdue_objectives: OverdueObjective[];
  weak_objectives: WeakObjective[];
  unresolved_errors: UnresolvedErrorsSummary;
  streak: number;
  /** Sessions planned for today that haven't been done. */
  plan_nudge: PlanNudge | null;
  /** The next planned session after today, when nothing is left to start today. */
  next_planned: PlannedSessionRef | null;
  /**
   * Sessions of the active plan on today's date in any status (done,
   * missed and skipped included), so the screen can tell "none planned
   * today" from "none left today".
   */
  today_planned: number;
  /** How many of those are done. */
  today_done: number;
  /**
   * The exam of the course's active plan: the plan for the chosen exam when
   * it is still ahead, else the nearest exam that hasn't passed.
   */
  exam: ExamRef | null;
  /** The zone used for "today" and the times above (Settings, else the newest plan's, else UTC). */
  time_zone: string;
}

// ---------------------------------------------------------------------------
// Topic titles
// ---------------------------------------------------------------------------

const KEY_PATTERN = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;

/**
 * Titles for mastery keys, from the plan's objective list (whose ids are
 * slugs of the titles) and from the objectives stored on recent sessions.
 */
export function buildTopicTitleMap(
  planConfig: unknown,
  sessions: readonly { objectives: unknown }[],
): Map<string, string> {
  const titles = new Map<string, string>();

  const planObjectives = (planConfig as { objectives?: unknown } | null)?.objectives;
  if (Array.isArray(planObjectives)) {
    const planTitles = planObjectives.filter((t): t is string => typeof t === "string" && t.trim() !== "");
    for (const [title, id] of buildObjectiveIdMap(planTitles)) titles.set(id, title);
  }

  for (const session of sessions) {
    if (!Array.isArray(session.objectives)) continue;
    for (const entry of session.objectives) {
      const id = (entry as { id?: unknown })?.id;
      const title = (entry as { title?: unknown })?.title;
      if (typeof id !== "string" || typeof title !== "string" || !title.trim()) continue;
      // A title that is itself a key carries no information.
      if (title === id && KEY_PATTERN.test(title)) continue;
      if (!titles.has(id)) titles.set(id, title.trim());
    }
  }

  return titles;
}

function topicFor(key: string, titles: Map<string, string>): StudyTopic {
  return { key, title: titles.get(key) ?? humanizeObjectiveKey(key) };
}

/** "General review", "A", "A and B", "A, B, and C", "A, B, C, and 2 more". */
export function buildTopicScope(titles: readonly string[]): string {
  if (titles.length === 0) return "General review";
  if (titles.length <= 3) return formatList(titles);
  const more = plural(titles.length - 3, { one: "# more", other: "# more" });
  return formatList([...titles.slice(0, 3), more]);
}

/**
 * A stored topic scope as one Intl list, the way Home and Plan list a
 * session's topics. Plans store titles comma-joined ("CSS specificity, The
 * box model"); sessions created before titles were mapped hold raw keys
 * ("photosynthesis_light_reactions, cell_cycle"), possibly with a
 * "(+2 more)" tail. A scope that is already a list ("A, B, and C") stays
 * the same.
 */
export function readableTopicScope(scope: string, titles: Map<string, string>): string {
  const trimmed = scope.trim();
  if (!trimmed) return "General review";
  const tail = trimmed.match(/\s*\(\+(\d+) more\)$/);
  const body = tail ? trimmed.slice(0, tail.index) : trimmed;
  const parts = body
    .split(/,\s*/)
    .map((p, i, all) => (i > 0 && i === all.length - 1 ? p.replace(/^and\s+/, "") : p).trim())
    .filter(Boolean);
  const readable = parts.map((p) =>
    titles.get(p) ?? (KEY_PATTERN.test(p) && /[_-]/.test(p) ? humanizeObjectiveKey(p) : p),
  );
  if (tail) readable.push(plural(Number(tail[1]), { one: "# more", other: "# more" }));
  return readable.length > 0 ? formatList(readable) : "General review";
}

/**
 * A session's topics as one Intl list: the titles stored on the session
 * (what Home and Plan list), else its stored scope.
 */
export function sessionTopicLine(
  objectives: unknown,
  scope: string,
  titles: Map<string, string>,
): string {
  if (Array.isArray(objectives)) {
    const named = objectives
      .map((entry) => {
        // Entries are { id, title }; older sessions may hold plain titles.
        if (typeof entry === "string") return entry.trim() || null;
        const id = (entry as { id?: unknown })?.id;
        const title = (entry as { title?: unknown })?.title;
        if (typeof title !== "string" || !title.trim()) return null;
        // A title that is itself a key reads better through the title map.
        if (typeof id === "string" && title === id && KEY_PATTERN.test(title)) return topicFor(id, titles).title;
        return title.trim();
      })
      .filter((t): t is string => t !== null);
    if (named.length > 0) return formatTopicList(named);
  }
  return readableTopicScope(scope, titles);
}

// ---------------------------------------------------------------------------
// Reasons (VOICE.md, "Dashboard and Learn")
// ---------------------------------------------------------------------------

const ERROR_TYPE_PLURALS: Record<string, string> = {
  MISCONCEPTION: "misconceptions",
  PROCEDURE: "wrong steps",
  CARELESS: "careless slips",
  MEMORY: "memory gaps",
};

/** "mostly misconceptions" when one type is more than half; "all wrong steps" when it is every one. */
export function dominantErrorPhrase(types: readonly string[]): string | null {
  if (types.length === 0) return null;
  const counts = new Map<string, number>();
  for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);
  let top: string | null = null;
  let topCount = 0;
  for (const [type, count] of counts) {
    if (count > topCount) {
      top = type;
      topCount = count;
    }
  }
  const label = top ? ERROR_TYPE_PLURALS[top] : undefined;
  if (!label || topCount * 2 <= types.length) return null;
  return topCount === types.length ? `all ${label}` : `mostly ${label}`;
}

const RESOLVED_RULE = "An error is resolved after you answer it correctly on 2 different days.";

/**
 * Why Error repair: "4 unresolved errors, mostly misconceptions. An error
 * is resolved …". With `withCount: false`, for a screen that already gives
 * the count: "Most are misconceptions. An error is resolved …".
 */
export function errorRepairReason(
  errorTypes: readonly string[],
  { withCount = true }: { withCount?: boolean } = {},
): string {
  const phrase = dominantErrorPhrase(errorTypes);
  if (!withCount) {
    // "All are" needs at least two; Error repair is only recommended from 3.
    if (!phrase || errorTypes.length < 2) return RESOLVED_RULE;
    const [share, ...label] = phrase.split(" ");
    return `${share === "all" ? "All" : "Most"} are ${label.join(" ")}. ${RESOLVED_RULE}`;
  }
  const count = plural(errorTypes.length, {
    one: "# unresolved error",
    other: "# unresolved errors",
  });
  return `${count}${phrase ? `, ${phrase}` : ""}. ${RESOLVED_RULE}`;
}

export function overdueReason(overdueCount: number, maxDaysOverdue: number): string {
  const due = plural(overdueCount, {
    one: "# topic is due for review",
    other: "# topics are due for review",
  });
  if (maxDaysOverdue <= 0) return `${due} today.`;
  const oldest = plural(maxDaysOverdue, { one: "# day", other: "# days" });
  return overdueCount === 1 ? `${due}, ${oldest} late.` : `${due}, the oldest by ${oldest}.`;
}

export function examSimReason(examName: string, daysUntil: number): string {
  return `${examCountdown(examName, daysUntil)}. A full practice exam now shows what you still miss while there's time to fix it.`;
}

export const INTERLEAVED_REASON =
  "You've practiced every topic at least once. Mixing topics helps you tell similar problems apart.";

export const LOWEST_MASTERY_REASON =
  "Starting with your lowest-mastery topics. Answering from memory builds recall better than rereading.";

export function firstSessionReason(courseName: string): string {
  return `You haven't practiced ${courseName} yet. A first session from memory shows where you stand.`;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * The course's active plan: the one for `examName` when its exam is still
 * ahead, else the nearest exam that hasn't passed (newest plan first on a
 * tie), the way Home picks a course's exam. The exam date decides, not
 * endDate: plans store endDate as 7 days from the start, which in zones
 * west of UTC stops counting during the evening of day 5 and would drop
 * the plan before its last sessions.
 */
async function findActivePlan(
  userId: string,
  courseName: string,
  examName: string | null,
  todayKey: string,
) {
  const plans = await prisma.studyPlan.findMany({
    where: { userId, courseName, examDate: { gte: dateColumnValue(todayKey) } },
    include: { items: { orderBy: [{ dayIndex: "asc" }, { startTime: "asc" }] } },
    orderBy: [{ examDate: "asc" }, { createdAt: "desc" }],
    take: 10,
  });
  return (examName ? plans.find((p) => p.examName === examName) : undefined) ?? plans[0] ?? null;
}

/**
 * @param examName The exam chosen in the course switcher, if any. It picks
 *   which plan's exam and sessions show; topics and errors stay course-wide.
 */
export async function getStudyRecommendations(
  userId: string,
  courseName: string,
  examName: string | null = null,
): Promise<StudyRecommendations> {
  const now = new Date();
  // The same "today" as Home, Cards and Progress.
  const zonePromise = resolveTimeZone(userId);
  const planPromise = zonePromise.then((zone) =>
    findActivePlan(userId, courseName, examName, dayKey(now, zone)),
  );

  const [dueObjectives, masterySummary, courseErrors, activePlan, recentSessions, zone, streak] =
    await Promise.all([
      getDueObjectives(userId, courseName, 200, now),
      getMasterySummary(userId, courseName),
      // Same order as the Error repair deck: confident errors first, then newest.
      prisma.sessionErrorLog.findMany({
        where: { userId, resolvedAt: null, run: { session: { courseName } } },
        orderBy: [{ confidenceRating: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        select: { runId: true, promptIndex: true, errorType: true },
      }),
      planPromise,
      prisma.session.findMany({
        where: { userId, courseName },
        select: { objectives: true },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      zonePromise,
      // The same streak Home and Progress show
      getStreak(userId),
    ]);

  const todayKey = dayKey(now, zone);
  const titles = buildTopicTitleMap(activePlan?.config ?? null, recentSessions);

  // ── Overdue topics ─────────────────────────────────────────────
  const overdueObjectives: OverdueObjective[] = dueObjectives.map((o) => {
    const daysOverdue = o.nextDueAt
      ? Math.max(0, Math.floor((now.getTime() - o.nextDueAt.getTime()) / 86_400_000))
      : 0;
    return {
      objective_key: o.objectiveKey,
      title: topicFor(o.objectiveKey, titles).title,
      next_due_at: o.nextDueAt?.toISOString() ?? null,
      last_accuracy: o.lastAccuracy,
      days_overdue: daysOverdue,
    };
  });

  // ── Weak topics (accuracy under 70%, worst first) ──────────────
  const weakObjectives: WeakObjective[] = masterySummary.objectives
    .filter((o) => o.last_accuracy !== null && o.last_accuracy < 0.7)
    .sort((a, b) => (a.last_accuracy ?? 0) - (b.last_accuracy ?? 0))
    .map((o) => ({
      objective_key: o.objective_key,
      title: topicFor(o.objective_key, titles).title,
      last_accuracy: o.last_accuracy,
      ease_factor: o.ease_factor,
      repetitions: o.repetitions,
    }));

  // ── Unresolved errors ──────────────────────────────────────────
  const unresolvedErrorsSummary: UnresolvedErrorsSummary = {
    count: courseErrors.length,
    recent_error_types: [...new Set(courseErrors.slice(0, 10).map((e) => e.errorType))],
  };

  // ── Exam of the active plan ────────────────────────────────────
  let exam: ExamRef | null = null;
  if (activePlan) {
    const examKey = dateColumnKey(activePlan.examDate);
    exam = { name: activePlan.examName, date: examKey, days_until: daysBetween(todayKey, examKey) };
  }
  const examSoon = exam !== null && exam.days_until >= 0 && exam.days_until <= 3;

  const allStudiedOnce =
    masterySummary.total > 0 && masterySummary.objectives.every((o) => o.repetitions >= 1);

  // ── Recommended session ────────────────────────────────────────
  let mode: RecommendedMode;
  let keys: string[];
  let reason: string;
  let reasonWithoutCount: string | null = null;

  if (courseErrors.length >= 3) {
    mode = "ERROR_REPAIR";
    keys = await errorTopicKeys(courseErrors.slice(0, 10));
    if (keys.length === 0) keys = overdueObjectives.slice(0, 5).map((o) => o.objective_key);
    reason = errorRepairReason(courseErrors.map((e) => e.errorType));
    reasonWithoutCount = errorRepairReason(
      courseErrors.map((e) => e.errorType),
      { withCount: false },
    );
  } else if (overdueObjectives.length >= 5) {
    mode = "RETRIEVAL";
    keys = overdueObjectives.slice(0, 5).map((o) => o.objective_key);
    reason = overdueReason(overdueObjectives.length, overdueObjectives[0]?.days_overdue ?? 0);
  } else if (examSoon && exam) {
    mode = "EXAM_SIM";
    keys =
      weakObjectives.length > 0
        ? weakObjectives.slice(0, 5).map((o) => o.objective_key)
        : overdueObjectives.length > 0
          ? overdueObjectives.slice(0, 5).map((o) => o.objective_key)
          : masterySummary.objectives.slice(0, 5).map((o) => o.objective_key);
    reason = examSimReason(exam.name, exam.days_until);
  } else if (allStudiedOnce) {
    mode = "INTERLEAVED_PRACTICE";
    const weakKeys = weakObjectives.slice(0, 3).map((o) => o.objective_key);
    const dueKeys = overdueObjectives.slice(0, 3).map((o) => o.objective_key);
    keys = [...new Set([...weakKeys, ...dueKeys])].slice(0, 5);
    if (keys.length === 0) keys = masterySummary.objectives.slice(0, 5).map((o) => o.objective_key);
    reason = INTERLEAVED_REASON;
  } else {
    mode = "RETRIEVAL";
    keys = [...masterySummary.objectives]
      .sort((a, b) => {
        // Unpracticed first, then by accuracy, then by repetitions.
        if (a.repetitions === 0 && b.repetitions !== 0) return -1;
        if (a.repetitions !== 0 && b.repetitions === 0) return 1;
        const accA = a.last_accuracy ?? 0;
        const accB = b.last_accuracy ?? 0;
        if (accA !== accB) return accA - accB;
        return a.repetitions - b.repetitions;
      })
      .slice(0, 5)
      .map((o) => o.objective_key);
    if (keys.length === 0) keys = overdueObjectives.slice(0, 5).map((o) => o.objective_key);
    reason = keys.length > 0 ? LOWEST_MASTERY_REASON : firstSessionReason(courseName);
  }

  const topics = keys.map((key) => topicFor(key, titles));
  const nextSession: RecommendedSession = {
    mode,
    objectives: keys,
    topics,
    topic_scope: buildTopicScope(topics.map((t) => t.title)),
    reason,
    reason_without_count: reasonWithoutCount ?? reason,
  };

  // ── Planned sessions: today's, else the next one ───────────────
  let planNudge: PlanNudge | null = null;
  let nextPlanned: PlannedSessionRef | null = null;
  let todayPlanned = 0;
  let todayDone = 0;

  if (activePlan) {
    for (const item of activePlan.items) {
      if (dayKey(item.startTime, zone) !== todayKey) continue;
      todayPlanned++;
      if (item.status === "DONE") todayDone++;
    }
    // Sessions moved by Reschedule (RESCHEDULED) are still to do, as on Home and Plan.
    const open = activePlan.items.filter((item) => isOpenPlanStatus(item.status));
    const todayItems = open
      .filter((item) => dayKey(item.startTime, zone) === todayKey)
      .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    const laterItem =
      todayItems.length === 0
        ? open
            .filter((item) => isUnstartedPlanStatus(item.status) && dayKey(item.startTime, zone) > todayKey)
            .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())[0]
        : undefined;

    const wanted = laterItem ? [...todayItems, laterItem] : todayItems;
    if (wanted.length > 0) {
      const sessions = await prisma.session.findMany({
        where: { userId, sessionId: { in: wanted.map((item) => item.sessionId) } },
        select: { sessionId: true, mode: true, topicScope: true, objectives: true },
      });
      const bySessionId = new Map(sessions.map((s) => [s.sessionId, s]));
      const timeZone = zone;

      const toRef = (item: (typeof wanted)[number], when: "today" | "later"): PlannedSessionRef => {
        const session = bySessionId.get(item.sessionId);
        const modeLabel = session ? studyModeLabel(session.mode) : "Session";
        const scope = session ? sessionTopicLine(session.objectives, session.topicScope, titles) : "";
        const time = formatTime(item.startTime, { timeZone });
        const what = scope ? `${modeLabel} on ${scope}` : modeLabel;
        return {
          session_id: item.sessionId,
          start_time: item.startTime.toISOString(),
          end_time: item.endTime.toISOString(),
          status: item.status,
          mode: session?.mode ?? "RETRIEVAL",
          mode_label: modeLabel,
          topic_scope: scope,
          message: when === "today" ? `Today at ${time}: ${what}` : what,
        };
      };

      if (todayItems.length > 0) {
        planNudge = { plan_id: activePlan.planId, items: todayItems.map((item) => toRef(item, "today")) };
      }
      if (laterItem) nextPlanned = toRef(laterItem, "later");
    }
  }

  logger.info("recommendations.generated", {
    user_id: userId,
    course_name: courseName,
    mode: nextSession.mode,
    overdue_count: overdueObjectives.length,
    weak_count: weakObjectives.length,
    unresolved_error_count: courseErrors.length,
    streak,
    has_plan_nudge: planNudge !== null,
  });

  return {
    course_name: courseName,
    next_session: nextSession,
    overdue_objectives: overdueObjectives,
    weak_objectives: weakObjectives,
    unresolved_errors: unresolvedErrorsSummary,
    streak,
    plan_nudge: planNudge,
    next_planned: nextPlanned,
    today_planned: todayPlanned,
    today_done: todayDone,
    exam,
    time_zone: zone,
  };
}

/** The topics the given errors came from, in error priority order, up to 5. */
async function errorTopicKeys(
  errors: readonly { runId: string; promptIndex: number }[],
): Promise<string[]> {
  if (errors.length === 0) return [];
  const prompts = await prisma.sessionRunPrompt.findMany({
    where: { OR: errors.map((e) => ({ runId: e.runId, promptIndex: e.promptIndex })) },
    select: { runId: true, promptIndex: true, objectiveId: true },
  });
  const objectiveByPrompt = new Map(prompts.map((p) => [`${p.runId}:${p.promptIndex}`, p.objectiveId]));
  const keys: string[] = [];
  for (const e of errors) {
    const key = objectiveByPrompt.get(`${e.runId}:${e.promptIndex}`);
    if (key && !keys.includes(key)) keys.push(key);
    if (keys.length === 5) break;
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Courses on the Study screen
// ---------------------------------------------------------------------------

export interface StudyCourseSummary {
  courseName: string;
  examNames: string[];
  docCount: number;
  processedDocCount: number;
  processingDocCount: number;
  failedDocCount: number;
  deckCount: number;
  /** Reviewed cards due before the student's day ends, as Cards counts "due today". */
  dueReviewCount: number;
  /** Cards never reviewed. */
  newCardCount: number;
  /** dueReviewCount + newCardCount: the Cards screen's "due today". */
  dueCardCount: number;
  guideCount: number;
}

/**
 * Per-course counts for the Study screen's course tools. Pass the student's
 * zone (resolveTimeZone) when it is already known, to skip the lookup.
 */
export async function getStudyCourses(userId: string, timeZone?: string): Promise<StudyCourseSummary[]> {
  const now = new Date();
  const [docs, zone] = await Promise.all([
    prisma.contentDocument.findMany({
      where: { userId, namespace: "COURSE", courseName: { not: null } },
      select: { courseName: true, examName: true, status: true },
    }),
    timeZone ?? resolveTimeZone(userId),
  ]);

  const byCourse = new Map<
    string,
    { examNames: Set<string>; docCount: number; processed: number; failed: number }
  >();
  for (const doc of docs) {
    if (!doc.courseName) continue;
    const entry = byCourse.get(doc.courseName) ?? { examNames: new Set(), docCount: 0, processed: 0, failed: 0 };
    entry.docCount++;
    if (doc.status === "PROCESSED") entry.processed++;
    if (doc.status === "FAILED") entry.failed++;
    if (doc.examName) entry.examNames.add(doc.examName);
    byCourse.set(doc.courseName, entry);
  }
  if (byCourse.size === 0) return [];

  const courseNames = [...byCourse.keys()];
  // One definition of "due today" with the Cards screen (spaced-repetition
  // isDueToday): reviewed cards due before midnight on the student's clock.
  const todayEnds = endOfToday(zone, now);
  const [decks, newCards, dueCards, guides] = await Promise.all([
    prisma.flashcardDeck.findMany({
      where: { userId, courseName: { in: courseNames } },
      select: { id: true, courseName: true },
    }),
    prisma.flashcard.groupBy({
      by: ["deckId"],
      where: { deck: { userId, courseName: { in: courseNames } }, nextDueAt: null, repetitions: 0 },
      _count: { id: true },
    }),
    prisma.flashcard.groupBy({
      by: ["deckId"],
      where: { deck: { userId, courseName: { in: courseNames } }, nextDueAt: { lt: todayEnds } },
      _count: { id: true },
    }),
    prisma.studyGuide.groupBy({
      by: ["courseName"],
      where: { userId, courseName: { in: courseNames } },
      _count: { id: true },
    }),
  ]);

  const courseByDeck = new Map(decks.map((d) => [d.id, d.courseName]));
  const deckCount = new Map<string, number>();
  for (const d of decks) deckCount.set(d.courseName, (deckCount.get(d.courseName) ?? 0) + 1);
  const tally = (rows: { deckId: string; _count: { id: number } }[]) => {
    const totals = new Map<string, number>();
    for (const row of rows) {
      const course = courseByDeck.get(row.deckId);
      if (course) totals.set(course, (totals.get(course) ?? 0) + row._count.id);
    }
    return totals;
  };
  const newByCourse = tally(newCards);
  const dueByCourse = tally(dueCards);
  const guideCount = new Map(guides.map((g) => [g.courseName, g._count.id]));

  return courseNames
    .map((name) => {
      const info = byCourse.get(name)!;
      const dueReviewCount = dueByCourse.get(name) ?? 0;
      const newCardCount = newByCourse.get(name) ?? 0;
      return {
        courseName: name,
        examNames: [...info.examNames].sort((a, b) => a.localeCompare(b)),
        docCount: info.docCount,
        processedDocCount: info.processed,
        processingDocCount: info.docCount - info.processed - info.failed,
        failedDocCount: info.failed,
        deckCount: deckCount.get(name) ?? 0,
        dueReviewCount,
        newCardCount,
        dueCardCount: dueReviewCount + newCardCount,
        guideCount: guideCount.get(name) ?? 0,
      };
    })
    .sort((a, b) => a.courseName.localeCompare(b.courseName));
}

// ---------------------------------------------------------------------------
// Starting a session from the Study screen
// ---------------------------------------------------------------------------

export type StudyStartErrorCode = "COURSE_NOT_FOUND" | "NO_MATERIALS";

export class StudyStartError extends Error {
  constructor(
    readonly code: StudyStartErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StudyStartError";
  }
}

export interface StartStudySessionInput {
  courseName: string;
  examName?: string;
  mode: StudyModeKey;
  minutes: SessionLength;
}

export interface StartStudySessionResult {
  session_id: string;
  /** Relative, so it always stays on the current origin. */
  url: string;
  /** True when an identical session from the last few hours that was never started is reused. */
  reused: boolean;
}

/** An unstarted session this recent, with the same settings, is reused instead of duplicated. */
const REUSE_WINDOW_MS = 6 * 60 * 60 * 1000;

export async function startStudySession(
  userId: string,
  input: StartStudySessionInput,
): Promise<StartStudySessionResult> {
  const { courseName, mode, minutes } = input;

  const [docs, recs] = await Promise.all([
    prisma.contentDocument.findMany({
      where: { userId, namespace: "COURSE", courseName },
      select: { examName: true, status: true },
    }),
    getStudyRecommendations(userId, courseName, input.examName?.trim() || null),
  ]);

  if (docs.length === 0) {
    throw new StudyStartError(
      "COURSE_NOT_FOUND",
      `${courseName} has no materials. Upload them on Plan, then start a session.`,
    );
  }
  if (!docs.some((d) => d.status === "PROCESSED")) {
    throw new StudyStartError(
      "NO_MATERIALS",
      `Your ${courseName} files are still processing. Start a session once one is ready.`,
    );
  }

  const docExams = docs
    .map((d) => d.examName)
    .filter((name): name is string => !!name)
    .sort((a, b) => a.localeCompare(b));
  const examName = input.examName?.trim() || recs.exam?.name || docExams[0] || "General";

  const { topics, topic_scope: topicScope } = recs.next_session;

  const existing = await prisma.session.findFirst({
    where: {
      userId,
      courseName,
      examName,
      mode,
      plannedMinutes: minutes,
      topicScope,
      createdAt: { gte: new Date(Date.now() - REUSE_WINDOW_MS) },
      runs: { none: {} },
    },
    orderBy: { createdAt: "desc" },
    select: { sessionId: true },
  });
  if (existing) {
    // Planned sessions belong to the plan; never hand one out as a fresh start.
    const planned = await prisma.studyPlanItem.findFirst({
      where: { sessionId: existing.sessionId },
      select: { id: true },
    });
    if (!planned) {
      return { session_id: existing.sessionId, url: `/s/${existing.sessionId}`, reused: true };
    }
  }

  const created = await createSession(userId, {
    course_name: courseName,
    exam_name: examName,
    mode,
    topic_scope: topicScope,
    planned_minutes: minutes,
    // Ids reuse the mastery keys so spaced repetition, warm-ups and pretest
    // gating stay continuous with earlier sessions.
    objectives: topics.length > 0 ? topics.map((t) => ({ id: t.key, title: t.title })) : undefined,
    target_outcome: { prompt_count: questionCountFor(minutes) },
    break_protocol: breakProtocolFor(minutes),
  });

  logger.info("study.session_started", { user_id: userId, session_id: created.session_id, mode, minutes });

  return { session_id: created.session_id, url: `/s/${created.session_id}`, reused: false };
}
