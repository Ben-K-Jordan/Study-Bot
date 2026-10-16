import { rm } from "fs/promises";
import { basename } from "path";
import { createRateLimiter } from "@/lib/rate-limit";
import { resolveStoragePath } from "@/lib/storage";

/**
 * Account deletion attempts per student: each one checks the password, so
 * the cap keeps a borrowed session from guessing it. Development is looser
 * so test runs don't lock the developer out.
 */
export const accountDeleteLimiter = createRateLimiter("account-delete", {
  maxRequests: process.env.NODE_ENV === "production" ? 5 : 50,
  windowMs: 15 * 60 * 1000,
});

/** User ids are UUIDs; test fixtures use short slugs. Nothing else is a folder name. */
const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Removes every file the student uploaded: UPLOAD_DIR/<userId>/, with each
 * document's folder inside it. Missing folders are fine. Refuses any id that
 * isn't a plain folder name (no separators, no dots), so a malformed id can
 * never remove another student's files or the upload root itself.
 */
export async function deleteUserFiles(userId: string): Promise<void> {
  if (!USER_ID_PATTERN.test(userId)) {
    throw new Error("Invalid user id");
  }
  // resolveStoragePath refuses anything outside UPLOAD_DIR (the root included).
  const folder = resolveStoragePath(userId);
  if (basename(folder) !== userId) {
    throw new Error("Invalid storage path");
  }
  await rm(folder, { recursive: true, force: true });
}
