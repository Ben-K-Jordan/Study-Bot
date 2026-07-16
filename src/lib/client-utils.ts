/**
 * Shared client-side utilities for browser pages.
 * Must only be imported from "use client" components.
 */

export { MODE_LABELS } from "./calendar";

const COURSE_KEY = "study_bot_active_course";

/** Persist the active course across pages (e.g. "Biology 101" or "Bio||Midterm"). */
export function getActiveCourse(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(COURSE_KEY) || "";
}

export function setActiveCourse(course: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(COURSE_KEY, course);
}
