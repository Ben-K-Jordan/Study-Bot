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

describe("saveFile", () => {
  it("stores the file under its own folder with a safe name", async () => {
    const key = await storage.saveFile("user-4", "doc-4", "Lecture 3 (final).pdf", Buffer.from("x"));
    expect(key).toBe(join("user-4", "doc-4", "Lecture_3__final_.pdf"));
    expect(await exists(join(root, "user-4", "doc-4", "Lecture_3__final_.pdf"))).toBe(true);
  });

  it("drops folder parts of the name, so ../ can't write outside the document's folder", async () => {
    const key = await storage.saveFile("user-5", "doc-5", "../../victim/doc/notes.txt", Buffer.from("x"));
    expect(key).toBe(join("user-5", "doc-5", "notes.txt"));
    expect(await exists(join(root, "victim"))).toBe(false);
    const windowsKey = await storage.saveFile("user-5", "doc-6", "..\\..\\..\\uploads-x\\a.txt", Buffer.from("x"));
    expect(windowsKey).toBe(join("user-5", "doc-6", "a.txt"));
  });

  it("refuses ids that would leave the upload folder", async () => {
    await expect(storage.saveFile("..", "..", "a.txt", Buffer.from("x"))).rejects.toThrow();
    await expect(storage.saveFile("user-6", "../../outside", "a.txt", Buffer.from("x"))).rejects.toThrow();
  });
});

describe("storedFileName", () => {
  it("keeps a plain name and never returns an empty or dot name", () => {
    expect(storage.storedFileName("notes.md")).toBe("notes.md");
    expect(storage.storedFileName("..")).toBe("file");
    expect(storage.storedFileName(".env")).toBe("env");
    expect(storage.storedFileName("a/")).toBe("file");
  });

  it("keeps the end of a very long name, extension included", () => {
    const name = storage.storedFileName(`${"x".repeat(300)}.pdf`);
    expect(name.length).toBe(120);
    expect(name.endsWith(".pdf")).toBe(true);
  });
});

describe("resolveStoragePath", () => {
  it("refuses keys outside the upload folder, sibling folders included", () => {
    expect(() => storage.resolveStoragePath("../uploads-x/a.txt")).toThrow();
    expect(() => storage.resolveStoragePath("")).toThrow();
  });
});
