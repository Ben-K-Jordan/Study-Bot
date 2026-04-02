/**
 * Shared client-side utilities for browser pages.
 * Must only be imported from "use client" components.
 */

export { MODE_LABELS } from "./calendar";

const USER_ID_KEY = "study_bot_user_id";

export function getOrCreateUserId(): string {
  if (typeof window === "undefined") return "anonymous";
  let uid = localStorage.getItem(USER_ID_KEY);
  if (!uid) {
    uid = "user_" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(USER_ID_KEY, uid);
  }
  return uid;
}
