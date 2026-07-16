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

interface GameStateHolder {
  row: { timezone: string | null } | null;
}

// Mock prisma before importing the service
vi.mock("@/lib/db", () => {
  const completedRuns: RunRow[] = [];
  const gameState: GameStateHolder = { row: null };

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
      userGameState: {
        // getUserTimezone reads UserGameState.timezone; null row = no timezone (UTC)
        findUnique: vi.fn(async () => gameState.row),
      },
      _test: { completedRuns, gameState },
    },
  };
});

vi.mock("@/lib/mastery", () => ({
  getDueObjectives: vi.fn(async () => []),
  getMasterySummary: vi.fn(async () => ({ total: 0, objectives: [] })),
}));

import { getStudyRecommendations } from "@/services/study-recommendations";
import { prisma } from "@/lib/db";

const testPrisma = (
  prisma as unknown as {
    _test: { completedRuns: RunRow[]; gameState: GameStateHolder };
  }
)._test;

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
  testPrisma.gameState.row = null;
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

describe("study streak with a user timezone", () => {
  it("keys a 9pm ET run to the local day 2026-07-15, not the UTC day 2026-07-16", async () => {
    // 2026-07-16T01:00:00Z is 9pm on July 15 in New York. At NOW (July 15
    // UTC/ET) the ET user sees today's activity; UTC keys file the same run
    // under the 16th — tomorrow — so the streak would read 0.
    addCompletedRun(new Date("2026-07-16T01:00:00Z"));

    testPrisma.gameState.row = { timezone: "America/New_York" };
    expect(await getStreak()).toBe(1);

    testPrisma.gameState.row = null; // UTC day keys
    expect(await getStreak()).toBe(0);
  });

  it("keeps a two-day local streak unbroken when a late-night run crosses the UTC boundary", async () => {
    vi.setSystemTime(new Date("2026-07-16T01:30:00Z")); // 9:30pm July 15 ET

    addCompletedRun(new Date("2026-07-16T01:00:00Z")); // 9pm Jul 15 ET (UTC day Jul 16)
    addCompletedRun(new Date("2026-07-14T15:00:00Z")); // 11am Jul 14 ET (UTC day Jul 14)

    // ET days: Jul 14 + Jul 15 — consecutive
    testPrisma.gameState.row = { timezone: "America/New_York" };
    expect(await getStreak()).toBe(2);

    // UTC days: Jul 14 + Jul 16 — broken at Jul 15
    testPrisma.gameState.row = null;
    expect(await getStreak()).toBe(1);
  });
});
