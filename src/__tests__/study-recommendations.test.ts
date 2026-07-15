/**
 * Unit tests for the study recommendations service — study streak computation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Run under a positive UTC offset so local-midnight bugs would surface:
// at the fixed test time (2026-07-15T10:00:00Z) local Tokyo time is 19:00,
// but local midnight serializes to the PREVIOUS UTC day.
process.env.TZ = "Asia/Tokyo";

interface RunRow {
  endedAt: Date | null;
}

// Mock prisma before importing the service
vi.mock("@/lib/db", () => {
  const completedRuns: RunRow[] = [];

  return {
    prisma: {
      sessionRun: {
        findMany: vi.fn(async () => completedRuns),
      },
      sessionErrorLog: {
        findMany: vi.fn(async () => []),
      },
      studyPlan: {
        findFirst: vi.fn(async () => null),
      },
      _test: { completedRuns },
    },
  };
});

vi.mock("@/lib/mastery", () => ({
  getDueObjectives: vi.fn(async () => []),
  getMasterySummary: vi.fn(async () => ({ total: 0, objectives: [] })),
}));

import { getStudyRecommendations } from "@/services/study-recommendations";
import { prisma } from "@/lib/db";

const testPrisma = (prisma as unknown as { _test: { completedRuns: RunRow[] } })._test;

const NOW = new Date("2026-07-15T10:00:00Z"); // UTC day 2026-07-15, Tokyo 19:00

function addCompletedRun(endedAt: Date): void {
  testPrisma.completedRuns.push({ endedAt });
}

async function getStreak(): Promise<number> {
  const result = await getStudyRecommendations("user1", "Biology");
  return result.streak;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  testPrisma.completedRuns.length = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("study streak (via getStudyRecommendations)", () => {
  it("returns 0 with no completed runs", async () => {
    expect(await getStreak()).toBe(0);
  });

  it("counts today's completed run even under a positive UTC offset", async () => {
    // Regression: the walk previously started from LOCAL midnight, which
    // serializes to yesterday's UTC key in Tokyo — a run completed today
    // produced a streak of 0.
    addCompletedRun(new Date("2026-07-15T09:00:00Z"));

    expect(await getStreak()).toBe(1);
  });

  it("counts consecutive UTC days", async () => {
    addCompletedRun(new Date("2026-07-15T09:00:00Z"));
    addCompletedRun(new Date("2026-07-14T23:30:00Z"));
    addCompletedRun(new Date("2026-07-13T01:00:00Z"));

    expect(await getStreak()).toBe(3);
  });

  it("stops at a gap", async () => {
    addCompletedRun(new Date("2026-07-15T09:00:00Z"));
    addCompletedRun(new Date("2026-07-13T09:00:00Z"));

    expect(await getStreak()).toBe(1);
  });

  it("starts from yesterday when today has no completed run", async () => {
    addCompletedRun(new Date("2026-07-14T09:00:00Z"));
    addCompletedRun(new Date("2026-07-13T09:00:00Z"));

    expect(await getStreak()).toBe(2);
  });

  it("returns 0 when neither today nor yesterday has a completed run", async () => {
    addCompletedRun(new Date("2026-07-12T09:00:00Z"));

    expect(await getStreak()).toBe(0);
  });
});
