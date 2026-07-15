/**
 * Shared client-side utilities for browser pages.
 * Must only be imported from "use client" components.
 */

export { MODE_LABELS } from "./calendar";

const COURSE_KEY = "study_bot_active_course";

/**
 * @deprecated Use useSession() from next-auth/react instead.
 * Kept for backward compatibility during migration.
 */
export function getOrCreateUserId(): string {
  if (typeof window === "undefined") return "anonymous";
  const USER_ID_KEY = "study_bot_user_id";
  let uid = localStorage.getItem(USER_ID_KEY);
  if (!uid) {
    uid = "user_" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(USER_ID_KEY, uid);
  }
  return uid;
}

/** Persist the active course across pages (e.g. "Biology 101" or "Bio||Midterm"). */
export function getActiveCourse(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(COURSE_KEY) || "";
}

export function setActiveCourse(course: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(COURSE_KEY, course);
}
