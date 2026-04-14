import { createHash } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { join, dirname, resolve } from "path";

const UPLOAD_DIR = resolve(process.env.UPLOAD_DIR || "./data/uploads");

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
  const fullPath = resolve(join(UPLOAD_DIR, key));
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
  const fullPath = resolve(join(UPLOAD_DIR, storageKey));
  if (!fullPath.startsWith(UPLOAD_DIR)) {
    throw new Error("Invalid storage path");
  }
  return fullPath;
}
