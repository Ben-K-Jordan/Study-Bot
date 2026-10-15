import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtemp, mkdir, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

let root: string;
let storage: typeof import("@/lib/storage");

async function exists(path: string) {
  return stat(path).then(
    () => true,
    () => false,
  );
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "sb-storage-"));
  vi.stubEnv("UPLOAD_DIR", root);
  vi.resetModules();
  storage = await import("@/lib/storage");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe("deleteStoredFile", () => {
  it("removes the document's own folder", async () => {
    const key = await storage.saveFile("user-1", "doc-1", "notes.md", Buffer.from("x"));
    await storage.deleteStoredFile(key, "doc-1");
    expect(await exists(join(root, "user-1", "doc-1"))).toBe(false);
    expect(await exists(join(root, "user-1"))).toBe(true);
  });

  it("refuses a key whose folder isn't that document's", async () => {
    await mkdir(join(root, "user-2"), { recursive: true });
    await writeFile(join(root, "user-2", "other.md"), "keep me");
    await expect(storage.deleteStoredFile(join("user-2", "other.md"), "doc-9")).rejects.toThrow();
    await expect(storage.deleteStoredFile("../outside/doc-9/x.md", "doc-9")).rejects.toThrow();
    expect(await exists(join(root, "user-2", "other.md"))).toBe(true);
  });

  it("ignores a missing folder", async () => {
    await expect(storage.deleteStoredFile(join("user-3", "doc-3", "gone.pdf"), "doc-3")).resolves.toBeUndefined();
  });
});
