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

const MAX_STORED_NAME = 120;

/**
 * The name a file is stored under: the last segment of the client's name
 * (browsers and Node keep "../" and folder parts in multipart filenames),
 * limited to letters, digits, dot, dash and underscore, with no leading
 * dots. The original name is kept only in the database.
 */
export function storedFileName(filename: string): string {
  const last = filename.split(/[\\/]/).pop() ?? "";
  const safe = last
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(-MAX_STORED_NAME);
  return safe || "file";
}

/**
 * Build the storage key for a document file: <user>/<document>/<safe name>.
 */
export function buildStorageKey(
  userId: string,
  documentId: string,
  filename: string
): string {
  return join(/*turbopackIgnore: true*/ userId, documentId, storedFileName(filename));
}

/** Whether a resolved path is inside UPLOAD_DIR (not the folder itself, not a sibling like uploads-x). */
function insideUploadDir(fullPath: string): boolean {
  return fullPath.startsWith(UPLOAD_DIR + sep);
}

/**
 * Save file bytes to disk under UPLOAD_DIR/<user>/<document>/.
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
  // The file must land in this document's own folder, whatever the ids hold
  const folder = resolve(join(/*turbopackIgnore: true*/ UPLOAD_DIR, userId, documentId));
  if (!insideUploadDir(fullPath) || dirname(fullPath) !== folder) {
    throw new Error("Invalid storage path");
  }
  await mkdir(folder, { recursive: true });
  await writeFile(fullPath, data);
  return key;
}

/**
 * Resolve absolute path from storage key.
 */
export function resolveStoragePath(storageKey: string): string {
  const fullPath = resolve(join(/*turbopackIgnore: true*/ UPLOAD_DIR, storageKey));
  if (!insideUploadDir(fullPath)) {
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
  if (!insideUploadDir(folder) || basename(folder) !== documentId) {
    throw new Error("Invalid storage path");
  }
  await rm(folder, { recursive: true, force: true });
}
