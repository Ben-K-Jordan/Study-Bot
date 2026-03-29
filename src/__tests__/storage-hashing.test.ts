import { describe, it, expect } from "vitest";
import { sha256, buildStorageKey } from "@/lib/storage";

describe("sha256", () => {
  it("returns 64-char hex string", () => {
    const hash = sha256(Buffer.from("test"));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("same bytes produce same hash", () => {
    const data = Buffer.from("identical content");
    expect(sha256(data)).toBe(sha256(data));
  });

  it("different bytes produce different hash", () => {
    const a = sha256(Buffer.from("content A"));
    const b = sha256(Buffer.from("content B"));
    expect(a).not.toBe(b);
  });

  it("empty buffer has a consistent hash", () => {
    const hash = sha256(Buffer.from(""));
    expect(hash).toBe(sha256(Buffer.from("")));
    expect(hash.length).toBe(64);
  });
});

describe("buildStorageKey", () => {
  it("builds path from user/doc/filename", () => {
    const key = buildStorageKey("user_1", "doc_abc", "notes.pdf");
    expect(key).toContain("user_1");
    expect(key).toContain("doc_abc");
    expect(key).toContain("notes.pdf");
  });
});
