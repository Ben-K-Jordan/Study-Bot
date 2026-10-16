/**
 * deleteUserFiles: account deletion removes the student's upload folder and
 * nothing else.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdir, mkdtemp, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

let base: string;
let root: string;
let storage: typeof import("@/lib/storage");
let account: typeof import("@/services/account");

async function exists(path: string) {
  return stat(path).then(
    () => true,
    () => false,
  );
}

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "sb-account-files-"));
  root = join(base, "uploads");
  await mkdir(root, { recursive: true });
  vi.stubEnv("UPLOAD_DIR", root);
  vi.resetModules();
  storage = await import("@/lib/storage");
  account = await import("@/services/account");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(base, { recursive: true, force: true });
});

describe("deleteUserFiles", () => {
  it("removes the student's folder with every document in it, and leaves other students alone", async () => {
    await storage.saveFile("user-a", "doc-1", "lecture-1.pdf", Buffer.from("a"));
    await storage.saveFile("user-a", "doc-2", "notes.md", Buffer.from("b"));
    await storage.saveFile("user-b", "doc-3", "notes.md", Buffer.from("c"));

    await account.deleteUserFiles("user-a");

    expect(await exists(join(root, "user-a"))).toBe(false);
    expect(await exists(join(root, "user-b", "doc-3", "notes.md"))).toBe(true);
    expect(await exists(root)).toBe(true);
  });

  it("is fine when the student never uploaded anything", async () => {
    await expect(account.deleteUserFiles("user-without-files")).resolves.toBeUndefined();
  });

  it("refuses ids that would reach outside the student's own folder", async () => {
    await writeFile(join(base, "outside.txt"), "keep me");
    await storage.saveFile("user-c", "doc-4", "notes.md", Buffer.from("d"));

    for (const id of ["", ".", "..", "../uploads", "user-c/doc-4", "user-c\\doc-4"]) {
      await expect(account.deleteUserFiles(id)).rejects.toThrow();
    }

    expect(await exists(join(base, "outside.txt"))).toBe(true);
    expect(await exists(join(root, "user-c", "doc-4", "notes.md"))).toBe(true);
  });
});
