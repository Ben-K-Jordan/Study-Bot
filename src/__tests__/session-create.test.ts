import { afterEach, describe, it, expect, vi } from "vitest";
import { z } from "zod";

/**
 * POST /api/sessions: the test break patterns (seconds-long work blocks)
 * exist for the test suites only. A deployment rejects them, and treats any
 * already stored as the default pattern. Prisma is mocked.
 */
const db = vi.hoisted(() => ({ session: { create: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/services/run", () => ({ getDeckPreview: vi.fn() }));

import { getBreakConfig, initBreakState, isAllowedBreakType, MAX_BREAK_CYCLES } from "@/lib/breaks";
import { createSession } from "@/services/session";

function body(breakProtocol: { type?: string; cycles?: number }) {
  return {
    course_name: "CS 2110",
    exam_name: "Prelim 1",
    mode: "RETRIEVAL",
    topic_scope: "Recursion",
    planned_minutes: 30,
    break_protocol: breakProtocol,
  };
}

/** A production server, with or without the e2e suite's test auth. */
function production(testAuth: boolean) {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("ALLOW_TEST_AUTH", testAuth ? "true" : "");
  vi.stubEnv("CI", testAuth ? "true" : "");
  vi.stubEnv("NEXTAUTH_URL", "http://localhost:3300");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("break patterns on new sessions", () => {
  it("rejects a test pattern in production", async () => {
    production(false);
    const error = await createSession("user-1", body({ type: "TEST_1_1", cycles: 2 })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(z.ZodError);
    expect((error as z.ZodError).issues[0]).toMatchObject({ path: ["break_protocol", "type"] });
    expect(db.session.create).not.toHaveBeenCalled();
  });

  it("rejects an unknown pattern anywhere", async () => {
    await expect(createSession("user-1", body({ type: "1_1" }))).rejects.toBeInstanceOf(z.ZodError);
  });

  it("accepts the real patterns in production", async () => {
    production(false);
    db.session.create.mockResolvedValue({ sessionId: "s1" });
    await expect(createSession("user-1", body({ type: "25_5", cycles: 2 }))).resolves.toMatchObject({ session_id: "s1" });
  });

  it("accepts a test pattern while the e2e suite's test auth is on", async () => {
    production(true);
    db.session.create.mockResolvedValue({ sessionId: "s2" });
    await expect(createSession("user-1", body({ type: "TEST_3_2", cycles: 1 }))).resolves.toMatchObject({ session_id: "s2" });
  });
});

describe("break pattern lookup", () => {
  it("honours the test patterns in development and unit tests", () => {
    expect(isAllowedBreakType("TEST_1_1")).toBe(true);
    expect(getBreakConfig("TEST_1_1").workMinutes).toBeCloseTo(1 / 60, 5);
  });

  it("treats a stored test pattern as the default in production", () => {
    production(false);
    expect(isAllowedBreakType("TEST_1_1")).toBe(false);
    expect(getBreakConfig("TEST_1_1")).toEqual({ workMinutes: 50, breakMinutes: 10 });
    expect(initBreakState({ type: "TEST_3_2", cycles: 2 }).work_duration_seconds).toBe(50 * 60);
  });

  it("caps a stored cycle count", () => {
    expect(initBreakState({ type: "25_5", cycles: 1_000_000_000 }).total_cycles).toBe(MAX_BREAK_CYCLES);
    expect(initBreakState({ type: "25_5", cycles: 0 }).total_cycles).toBe(1);
  });
});
