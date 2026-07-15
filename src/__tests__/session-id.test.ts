import { describe, it, expect } from "vitest";
import { generateSessionId } from "@/lib/session-id";

describe("generateSessionId", () => {
  it("generates a 21-character string", () => {
    const id = generateSessionId();
    expect(id).toHaveLength(21);
  });

  it("generates URL-safe characters only", () => {
    const id = generateSessionId();
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateSessionId()));
    expect(ids.size).toBe(1000);
  });
});
