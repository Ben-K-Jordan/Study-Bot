import { createHash } from "crypto";
import { mkdir, writeFile, readFile } from "fs/promises";
import { join, dirname } from "path";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./data/uploads";

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
  const fullPath = join(UPLOAD_DIR, key);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, data);
  return key;
}

/**
 * Read a file from disk by its storage key.
 */
export async function readStoredFile(storageKey: string): Promise<Buffer> {
  return readFile(join(UPLOAD_DIR, storageKey));
}

/**
 * Resolve absolute path from storage key.
 */
export function resolveStoragePath(storageKey: string): string {
  return join(UPLOAD_DIR, storageKey);
}
