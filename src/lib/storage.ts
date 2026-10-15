import { createHash } from "crypto";
import { mkdir, rm, writeFile } from "fs/promises";
import { basename, join, dirname, resolve, sep } from "path";

// Uploads are runtime data, so the turbopackIgnore comments keep the build from
// tracing them (and with them the whole project) into the server output.
const UPLOAD_DIR = resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_DIR || "./data/uploads");

/**
 * Compute SHA-256 hash of a buffer.
 */
export function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Build the storage key for a document file.
 */
export function buildStorageKey(
  userId: string,
  documentId: string,
  filename: string
): string {
  return join(userId, documentId, filename);
}

/**
 * Save file bytes to disk under UPLOAD_DIR.
 * Returns the storage key (relative path).
 */
export async function saveFile(
  userId: string,
  documentId: string,
  filename: string,
  data: Buffer
): Promise<string> {
  const key = buildStorageKey(userId, documentId, filename);
  const fullPath = resolve(join(/*turbopackIgnore: true*/ UPLOAD_DIR, key));
  if (!fullPath.startsWith(UPLOAD_DIR)) {
    throw new Error("Invalid storage path");
  }
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, data);
  return key;
}

/**
 * Resolve absolute path from storage key.
 */
export function resolveStoragePath(storageKey: string): string {
  const fullPath = resolve(join(/*turbopackIgnore: true*/ UPLOAD_DIR, storageKey));
  if (!fullPath.startsWith(UPLOAD_DIR)) {
    throw new Error("Invalid storage path");
  }
  return fullPath;
}

/**
 * Delete a stored document's folder (UPLOAD_DIR/<user>/<document>/). Missing
 * files are fine: the database row is what the app reads. Refuses any key
 * whose folder isn't that document's own folder, so a malformed key can never
 * remove a user's other files.
 */
export async function deleteStoredFile(storageKey: string, documentId: string): Promise<void> {
  if (!storageKey || !documentId) return;
  const filePath = resolveStoragePath(storageKey);
  const folder = dirname(filePath);
  if (!folder.startsWith(UPLOAD_DIR + sep) || basename(folder) !== documentId) {
    throw new Error("Invalid storage path");
  }
  await rm(folder, { recursive: true, force: true });
}
