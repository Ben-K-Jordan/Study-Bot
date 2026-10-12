"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * The course (and exam) the student is working on, shared by every screen
 * and kept across visits. Values use the "Course||Exam" format the server
 * expects ("CS 2110||Prelim 1"), or just "Course" when there is no exam.
 */

export const ACTIVE_COURSE_KEY = "study-bot:active-course:v1";
/** The unversioned key used before v1; read once, then removed. */
export const LEGACY_ACTIVE_COURSE_KEY = "study_bot_active_course";

const SEPARATOR = "||";

export interface CourseRef {
  courseName: string;
  examName: string | null;
}

/** "CS 2110||Prelim 1" for a course with an exam, "CS 2110" without. */
export function courseKey(courseName: string, examName?: string | null): string {
  return examName ? `${courseName}${SEPARATOR}${examName}` : courseName;
}

/** Splits a stored value back into course and exam. */
export function parseCourseKey(key: string): CourseRef {
  const index = key.indexOf(SEPARATOR);
  if (index === -1) return { courseName: key, examName: null };
  return {
    courseName: key.slice(0, index),
    examName: key.slice(index + SEPARATOR.length) || null,
  };
}

type Stored = { course: string };

function readStorage(): string | null {
  try {
    const raw = window.localStorage.getItem(ACTIVE_COURSE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<Stored> | null;
      return typeof parsed?.course === "string" && parsed.course ? parsed.course : null;
    }
    // One-time migration from the old plain-string key.
    const legacy = window.localStorage.getItem(LEGACY_ACTIVE_COURSE_KEY);
    if (legacy) {
      window.localStorage.setItem(ACTIVE_COURSE_KEY, JSON.stringify({ course: legacy } satisfies Stored));
      window.localStorage.removeItem(LEGACY_ACTIVE_COURSE_KEY);
      return legacy;
    }
  } catch {
    // Storage blocked or corrupt: behave as if nothing was chosen.
  }
  return null;
}

function writeStorage(course: string | null) {
  try {
    if (course) {
      window.localStorage.setItem(ACTIVE_COURSE_KEY, JSON.stringify({ course } satisfies Stored));
    } else {
      window.localStorage.removeItem(ACTIVE_COURSE_KEY);
    }
  } catch {
    // Storage blocked: the choice lasts for this page view only.
  }
}

// In-memory copy plus listeners, so every component using the hook updates
// together and other tabs follow through the storage event.
let current: string | null | undefined;
const listeners = new Set<() => void>();

function getSnapshot(): string | null {
  if (current === undefined) current = readStorage();
  return current;
}

function getServerSnapshot(): string | null {
  return null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === ACTIVE_COURSE_KEY || event.key === null) {
      current = readStorage();
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function setActive(course: string | null) {
  current = course;
  writeStorage(course);
  for (const listener of listeners) listener();
}

/** Reads the stored course outside React (legacy screens). */
export function getStoredActiveCourse(): string | null {
  if (typeof window === "undefined") return null;
  return getSnapshot();
}

/** Stores the course outside React; hook users update too. */
export function storeActiveCourse(course: string | null): void {
  if (typeof window === "undefined") return;
  setActive(course);
}

/**
 * Returns the active course key and a setter. Pass the available keys (from
 * useCourseOptions) to fall back to the first one when the stored course no
 * longer exists; `activeCourse` is null until something is available.
 */
export function useActiveCourse(availableKeys?: readonly string[]) {
  const stored = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const activeCourse = useMemo(() => {
    if (!availableKeys) return stored;
    if (stored && availableKeys.includes(stored)) return stored;
    return availableKeys[0] ?? null;
  }, [availableKeys, stored]);

  const setActiveCourse = useCallback((course: string | null) => setActive(course), []);

  const parsed = useMemo(() => (activeCourse ? parseCourseKey(activeCourse) : null), [activeCourse]);

  return { activeCourse, setActiveCourse, course: parsed } as const;
}
