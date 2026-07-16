/**
 * Mastery-driven study recommendations service.
 *
 * Synthesizes SM-2 mastery data, error logs, active study plans, and
 * session history to produce a single actionable recommendation for
 * what a student should study next — and why.
 */

import { prisma } from "@/lib/db";
import { getDueObjectives, getMasterySummary } from "@/lib/mastery";
import { logger } from "@/lib/logger";
import { dayKey, getUserTimezone } from "@/lib/timezone";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SessionMode =
  | "ERROR_REPAIR"
  | "RETRIEVAL"
  | "INTERLEAVED_PRACTICE"
  | "EXAM_SIM";

interface RecommendedSession {
  mode: SessionMode;
  objectives: string[];
  topic_scope: string;
  reason: string;
}

interface OverdueObjective {
  objective_key: string;
  next_due_at: string | null;
  last_accuracy: number | null;
  days_overdue: number;
}

interface WeakObjective {
  objective_key: string;
  last_accuracy: number | null;
  ease_factor: number;
  repetitions: number;
}

interface UnresolvedErrorsSummary {
  count: number;
  recent_error_types: string[];
}

interface PlanNudge {
  plan_id: string;
  items: {
    session_id: string;
    start_time: string;
    end_time: string;
    message: string;
  }[];
}

export interface StudyRecommendations {
  next_session: RecommendedSession;
  overdue_objectives: OverdueObjective[];
  weak_objectives: WeakObjective[];
  unresolved_errors: UnresolvedErrorsSummary;
  streak: number;
  plan_nudge: PlanNudge | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildTopicScope(objectiveKeys: string[]): string {
  if (objectiveKeys.length === 0) return "General review";
  if (objectiveKeys.length === 1) return objectiveKeys[0];
  // Join the first few objectives into a readable scope
  const display = objectiveKeys.slice(0, 3).join(", ");
  if (objectiveKeys.length > 3) {
    return `${display} (+${objectiveKeys.length - 3} more)`;
  }
  return display;
}

/**
 * Compute the student's current study streak from session run completions.
 * A streak day counts when at least one SessionRun was completed on that calendar day.
 *
 * Calendar days follow the user's timezone (UserGameState.timezone); a null
 * timezone means UTC day keys — identical to the historical behavior.
 */
async function computeStudyStreak(userId: string): Promise<number> {
  // Fetch the last 365 completed run dates (should be plenty) and the user's
  // timezone in parallel
  const [completedRuns, tz] = await Promise.all([
    prisma.sessionRun.findMany({
      where: {
        userId,
        status: "COMPLETED",
        endedAt: { not: null },
      },
      select: { endedAt: true },
      orderBy: { endedAt: "desc" },
      take: 365,
    }),
    getUserTimezone(userId),
  ]);

  if (completedRuns.length === 0) return 0;

  // Collect unique calendar days (keyed in the user's timezone; UTC when null)
  const activeDays = new Set<string>();
  for (const run of completedRuns) {
    if (run.endedAt) {
      activeDays.add(dayKey(run.endedAt, tz));
    }
  }

  // Walk backward from today counting consecutive days, using the SAME day
  // keys as activeDays: subtract 24h from a timestamp and re-key with dayKey.
  // Local-midnight arithmetic would start the walk on the wrong day on
  // servers with a non-zero UTC offset, dropping today's activity.
  const DAY_MS = 86_400_000;
  const now = new Date();
  const todayKey = dayKey(now, tz);
  const [year, month, day] = todayKey.split("-").map(Number);
  // Anchor the cursor mid-day (12:00 UTC of today's key) so 24h steps never
  // skip or repeat a key across DST transitions. For extreme offsets
  // (UTC+13/+14) 12:00 UTC already keys to tomorrow — step back once.
  let cursor = Date.UTC(year, month - 1, day, 12);
  if (dayKey(new Date(cursor), tz) !== todayKey) cursor -= DAY_MS / 2;
  const yesterdayKey = dayKey(new Date(cursor - DAY_MS), tz);

  // Streak starts from today or yesterday
  if (!activeDays.has(todayKey) && !activeDays.has(yesterdayKey)) return 0;

  // If no activity today, start counting from yesterday
  if (!activeDays.has(todayKey)) {
    cursor -= DAY_MS;
  }

  let streak = 0;
  while (activeDays.has(dayKey(new Date(cursor), tz))) {
    streak++;
    cursor -= DAY_MS;
  }

  return streak;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function getStudyRecommendations(
  userId: string,
  courseName: string,
): Promise<StudyRecommendations> {
  const now = new Date();

  // Fetch all data in parallel
  const [
    dueObjectives,
    masterySummary,
    unresolvedErrors,
    activePlan,
    streak,
  ] = await Promise.all([
    getDueObjectives(userId, courseName, 50, now),
    getMasterySummary(userId, courseName),
    prisma.sessionErrorLog.findMany({
      where: { userId, resolvedAt: null },
      orderBy: { createdAt: "desc" },
      include: {
        run: {
          select: {
            session: { select: { courseName: true } },
          },
        },
      },
    }),
    prisma.studyPlan.findFirst({
      where: { userId, courseName, endDate: { gte: now } },
      include: { items: { orderBy: [{ dayIndex: "asc" }, { startTime: "asc" }] } },
      orderBy: { createdAt: "desc" },
    }),
    computeStudyStreak(userId),
  ]);

  // Filter unresolved errors to this course
  const courseErrors = unresolvedErrors.filter(
    (e) => e.run.session.courseName === courseName,
  );

  // ── Overdue objectives ──────────────────────────────────────────
  const overdueObjectives: OverdueObjective[] = dueObjectives.map((o) => {
    const daysOverdue = o.nextDueAt
      ? Math.max(0, Math.floor((now.getTime() - o.nextDueAt.getTime()) / (1000 * 60 * 60 * 24)))
      : 0;
    return {
      objective_key: o.objectiveKey,
      next_due_at: o.nextDueAt?.toISOString() ?? null,
      last_accuracy: o.lastAccuracy,
      days_overdue: daysOverdue,
    };
  });

  // ── Weak objectives (lastAccuracy < 0.7, worst first) ──────────
  const weakObjectives: WeakObjective[] = masterySummary.objectives
    .filter((o) => o.last_accuracy !== null && o.last_accuracy < 0.7)
    .sort((a, b) => (a.last_accuracy ?? 0) - (b.last_accuracy ?? 0))
    .map((o) => ({
      objective_key: o.objective_key,
      last_accuracy: o.last_accuracy,
      ease_factor: o.ease_factor,
      repetitions: o.repetitions,
    }));

  // ── Unresolved errors summary ──────────────────────────────────
  const recentErrorTypes = [
    ...new Set(courseErrors.slice(0, 10).map((e) => e.errorType)),
  ];
  const unresolvedErrorsSummary: UnresolvedErrorsSummary = {
    count: courseErrors.length,
    recent_error_types: recentErrorTypes,
  };

  // ── Check for upcoming exam ────────────────────────────────────
  const examWithinThreeDays = activePlan
    ? (activePlan.examDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24) <= 3
    : false;

  // ── Determine whether all objectives have been studied at least once
  const allStudiedOnce =
    masterySummary.total > 0 &&
    masterySummary.objectives.every((o) => o.repetitions >= 1);

  // ── Build next_session recommendation ──────────────────────────
  let nextSession: RecommendedSession;

  if (courseErrors.length >= 3) {
    // ERROR_REPAIR: 3+ unresolved errors
    const errorObjectives = [
      ...new Set(
        courseErrors
          .slice(0, 5)
          .map((e) => e.correctionRule)
          .filter(Boolean),
      ),
    ].slice(0, 5);
    const objectives =
      errorObjectives.length > 0
        ? errorObjectives
        : overdueObjectives.slice(0, 5).map((o) => o.objective_key);

    nextSession = {
      mode: "ERROR_REPAIR",
      objectives,
      topic_scope: buildTopicScope(objectives),
      reason: `You have ${courseErrors.length} unresolved error${courseErrors.length === 1 ? "" : "s"} (types: ${recentErrorTypes.join(", ")}). Targeted error repair closes knowledge gaps faster than re-studying — research on deliberate practice shows correcting specific mistakes strengthens long-term retention.`,
    };
  } else if (overdueObjectives.length >= 5) {
    // RETRIEVAL on most overdue
    const targets = overdueObjectives.slice(0, 5).map((o) => o.objective_key);
    const maxOverdue = overdueObjectives[0]?.days_overdue ?? 0;

    nextSession = {
      mode: "RETRIEVAL",
      objectives: targets,
      topic_scope: buildTopicScope(targets),
      reason: `${overdueObjectives.length} objective${overdueObjectives.length === 1 ? " is" : "s are"} overdue for review (up to ${maxOverdue} day${maxOverdue === 1 ? "" : "s"} overdue) — spaced repetition research shows reviewing at optimal intervals maximizes long-term retention.`,
    };
  } else if (examWithinThreeDays) {
    // EXAM_SIM: exam within 3 days
    const targets = weakObjectives.length > 0
      ? weakObjectives.slice(0, 5).map((o) => o.objective_key)
      : overdueObjectives.length > 0
        ? overdueObjectives.slice(0, 5).map((o) => o.objective_key)
        : masterySummary.objectives.slice(0, 5).map((o) => o.objective_key);

    nextSession = {
      mode: "EXAM_SIM",
      objectives: targets,
      topic_scope: buildTopicScope(targets),
      reason: `Your exam is within 3 days. A timed exam simulation under test-like conditions activates retrieval under pressure — research on testing effect shows practice tests improve exam performance more than additional study.`,
    };
  } else if (allStudiedOnce) {
    // INTERLEAVED_PRACTICE: all objectives studied at least once
    // Mix weak + due objectives for interleaving
    const dueKeys = overdueObjectives.slice(0, 3).map((o) => o.objective_key);
    const weakKeys = weakObjectives.slice(0, 3).map((o) => o.objective_key);
    const targets = [...new Set([...weakKeys, ...dueKeys])].slice(0, 5);
    const fallbackTargets =
      targets.length > 0
        ? targets
        : masterySummary.objectives.slice(0, 5).map((o) => o.objective_key);

    nextSession = {
      mode: "INTERLEAVED_PRACTICE",
      objectives: fallbackTargets,
      topic_scope: buildTopicScope(fallbackTargets),
      reason: `You've studied all objectives at least once. Interleaved practice — mixing different topics in one session — produces stronger discrimination between concepts and better long-term retention than blocked practice (Rohrer & Taylor, 2007).`,
    };
  } else {
    // Default: RETRIEVAL on least-mastered objectives
    const leastMastered = masterySummary.objectives
      .sort((a, b) => {
        // Unstudied first, then by accuracy ascending, then repetitions ascending
        if (a.repetitions === 0 && b.repetitions !== 0) return -1;
        if (a.repetitions !== 0 && b.repetitions === 0) return 1;
        const accA = a.last_accuracy ?? 0;
        const accB = b.last_accuracy ?? 0;
        if (accA !== accB) return accA - accB;
        return a.repetitions - b.repetitions;
      })
      .slice(0, 5)
      .map((o) => o.objective_key);

    const targets = leastMastered.length > 0
      ? leastMastered
      : overdueObjectives.slice(0, 5).map((o) => o.objective_key);

    nextSession = {
      mode: "RETRIEVAL",
      objectives: targets,
      topic_scope: buildTopicScope(targets),
      reason:
        targets.length > 0
          ? `Focusing on your least-mastered objectives first. Active retrieval practice strengthens memory traces more effectively than passive review — the testing effect is one of the most robust findings in learning science.`
          : `No mastery data yet. Start with retrieval practice to build initial memory traces — even a single retrieval attempt significantly improves later recall.`,
    };
  }

  // ── Plan nudge ─────────────────────────────────────────────────
  let planNudge: PlanNudge | null = null;

  if (activePlan) {
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    const todayItems = activePlan.items.filter((item) => {
      const itemDate = new Date(item.startTime);
      return (
        item.status === "SCHEDULED" &&
        itemDate >= todayStart &&
        itemDate <= todayEnd
      );
    });

    if (todayItems.length > 0) {
      // Fetch linked sessions to get mode and topic info for nudge messages
      const todaySessionIds = todayItems.map((item) => item.sessionId);
      const todaySessions = await prisma.session.findMany({
        where: { sessionId: { in: todaySessionIds } },
        select: { sessionId: true, mode: true, topicScope: true },
      });
      const sessionMap = new Map(
        todaySessions.map((s) => [s.sessionId, s]),
      );

      planNudge = {
        plan_id: activePlan.planId,
        items: todayItems.map((item) => {
          const session = sessionMap.get(item.sessionId);
          const mode = session?.mode ?? "study";
          const topic = session?.topicScope ?? "your course material";
          return {
            session_id: item.sessionId,
            start_time: item.startTime.toISOString(),
            end_time: item.endTime.toISOString(),
            message: `You have a planned session: ${mode} on ${topic}`,
          };
        }),
      };
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
    next_session: nextSession,
    overdue_objectives: overdueObjectives,
    weak_objectives: weakObjectives,
    unresolved_errors: unresolvedErrorsSummary,
    streak,
    plan_nudge: planNudge,
  };
}
