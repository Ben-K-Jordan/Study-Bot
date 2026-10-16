/**
 * Topics (learning objectives) as the student sees them: a readable title,
 * a mastery value and a status. Pure, so Home and Progress agree and the
 * rules are unit-tested.
 */
import { humanizeObjectiveKey, slugifyObjectiveTitle } from "@/lib/objective-keys";

/** Below this last accuracy a practiced topic counts as a weak spot. */
export const WEAK_TOPIC_THRESHOLD = 0.7;

/** Same rule as the server's mastery summary (lib/mastery.ts). */
const MASTERED_REPETITIONS = 3;
const MASTERED_EASE = 2.0;

export type TopicStatus = "mastered" | "due" | "practiced" | "not-practiced";

export interface MasteryRow {
  courseName: string;
  objectiveKey: string;
  lastAccuracy: number | null;
  repetitions: number;
  easeFactor: number;
  lastStudiedAt: Date | null;
  nextDueAt: Date | null;
}

export interface Topic {
  courseName: string;
  key: string;
  title: string;
  /** Last accuracy on the topic from 0 to 1, or null when never practiced. */
  value: number | null;
  status: TopicStatus;
  lastStudiedAt: string | null;
}

export function topicStatus(row: Pick<MasteryRow, "lastAccuracy" | "repetitions" | "easeFactor" | "nextDueAt" | "lastStudiedAt">, now: Date): TopicStatus {
  if (row.lastAccuracy === null && !row.lastStudiedAt) return "not-practiced";
  if (row.repetitions >= MASTERED_REPETITIONS && row.easeFactor >= MASTERED_EASE) return "mastered";
  if (row.nextDueAt && row.nextDueAt <= now) return "due";
  return "practiced";
}

/** The status word printed beside the percentage, when there is one. */
export function topicStatusLabel(status: TopicStatus): string | undefined {
  switch (status) {
    case "mastered":
      return "Mastered";
    case "due":
      return "Due for review";
    case "not-practiced":
      return "Not practiced";
    default:
      return undefined;
  }
}

/**
 * Every topic per course: the topics named in the student's plans plus any
 * topic with mastery data, titled from the plans where possible.
 */
export function buildTopics(
  rows: readonly MasteryRow[],
  planTopics: readonly { courseName: string; titles: readonly string[] }[],
  now: Date,
): Topic[] {
  const titles = new Map<string, string>();
  const named = new Map<string, Set<string>>();
  for (const plan of planTopics) {
    let keys = named.get(plan.courseName);
    if (!keys) {
      keys = new Set();
      named.set(plan.courseName, keys);
    }
    for (const title of plan.titles) {
      const key = slugifyObjectiveTitle(title);
      titles.set(`${plan.courseName}\u0000${key}`, title);
      keys.add(key);
    }
  }

  const topics: Topic[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const id = `${row.courseName}\u0000${row.objectiveKey}`;
    seen.add(id);
    topics.push({
      courseName: row.courseName,
      key: row.objectiveKey,
      title: titles.get(id) ?? humanizeObjectiveKey(row.objectiveKey),
      value: row.lastAccuracy,
      status: topicStatus(row, now),
      lastStudiedAt: row.lastStudiedAt?.toISOString() ?? null,
    });
  }
  for (const [courseName, keys] of named) {
    for (const key of keys) {
      const id = `${courseName}\u0000${key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      topics.push({
        courseName,
        key,
        title: titles.get(id) ?? humanizeObjectiveKey(key),
        value: null,
        status: "not-practiced",
        lastStudiedAt: null,
      });
    }
  }
  return topics;
}

/** Weakest first: practiced topics by value, then topics never practiced. */
export function compareWeakestFirst(a: Topic, b: Topic): number {
  if (a.value === null && b.value !== null) return 1;
  if (a.value !== null && b.value === null) return -1;
  if (a.value !== null && b.value !== null && a.value !== b.value) return a.value - b.value;
  return a.title.localeCompare(b.title, "en-US");
}

export function compareByTitle(a: Topic, b: Topic): number {
  return a.title.localeCompare(b.title, "en-US", { sensitivity: "base" });
}

/** Practiced, not mastered, and under the threshold: the weak spots. */
export function isWeakTopic(topic: Topic): boolean {
  return (
    topic.value !== null &&
    topic.status !== "mastered" &&
    topic.value < WEAK_TOPIC_THRESHOLD
  );
}
