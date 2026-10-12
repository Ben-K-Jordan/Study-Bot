/**
 * Shared client-side utilities for browser pages.
 * Must only be imported from "use client" components.
 */

import { getStoredActiveCourse, storeActiveCourse } from "@/hooks/use-active-course";

export { MODE_LABELS } from "./calendar";

/** Persist the active course across pages (e.g. "Biology 101" or "Bio||Midterm"). */
export function getActiveCourse(): string {
  return getStoredActiveCourse() ?? "";
}

export function setActiveCourse(course: string): void {
  storeActiveCourse(course || null);
}
