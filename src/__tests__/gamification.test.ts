/**
 * Unit tests for the gamification service — streak freezes and streak computation.
 *
 * Uses an in-memory Prisma mock that faithfully reproduces the query semantics
 * the service relies on (including Prisma's NULL-excluding scalar `not:` filter).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Run under a positive UTC offset so local-midnight bugs would surface:
// at the fixed test time (2026-07-15T10:00:00Z) local Tokyo time is 19:00,
// but local midnight serializes to the PREVIOUS UTC day.
process.env.TZ = "Asia/Tokyo";

interface XpEventRow {
  id: string;
  userId: string;
  action: string;
  xpAmount: number;
  sourceId: string | null;
  createdAt: Date;
}

interface GameStateRow {
  userId: string;
  dailyXpGoal: number;
  streakFreezes: number;
  streakFreezeUsedDate: string | null;
  timezone: string | null;
}

type Where = Record<string, unknown>;

// Mock prisma before importing the service
vi.mock("@/lib/db", () => {
  const xpEvents: XpEventRow[] = [];
  const gameStates = new Map<string, GameStateRow>();
  let nextId = 1;

  // Prisma's scalar `not:` filter is NULL-excluding — reproduce that here so
  // the tests exercise the real semantics.
  function matchesStringFilter(value: string | null, cond: unknown): boolean {
    if (cond === undefined) return true;
    if (cond === null) return value === null;
    if (typeof cond === "object" && cond !== null && "not" in cond) {
      return value !== null && value !== (cond as { not: string }).not;
    }
    return value === cond;
  }

  function matchesGameStateWhere(row: GameStateRow, where: Where): boolean {
    if (where.userId !== undefined && row.userId !== where.userId) return false;
    if (where.streakFreezes !== undefined) {
      const cond = where.streakFreezes as { gt?: number; lt?: number } | number;
      if (typeof cond === "object") {
        if (cond.gt !== undefined && !(row.streakFreezes > cond.gt)) return false;
        if (cond.lt !== undefined && !(row.streakFreezes < cond.lt)) return false;
      } else if (row.streakFreezes !== cond) {
        return false;
      }
    }
    if (
      where.streakFreezeUsedDate !== undefined &&
      !matchesStringFilter(row.streakFreezeUsedDate, where.streakFreezeUsedDate)
    ) {
      return false;
    }
    if (where.OR !== undefined) {
      const branches = where.OR as Where[];
      if (!branches.some((sub) => matchesGameStateWhere(row, sub))) return false;
    }
    return true;
  }

  function matchesXpWhere(row: XpEventRow, where: Where): boolean {
    if (where.userId !== undefined && row.userId !== where.userId) return false;
    if (where.action !== undefined && row.action !== where.action) return false;
    if (where.sourceId !== undefined && row.sourceId !== where.sourceId) return false;
    if (where.createdAt !== undefined) {
      const cond = where.createdAt as { gte?: Date };
      if (cond.gte !== undefined && row.createdAt < cond.gte) return false;
    }
    return true;
  }

  return {
    prisma: {
      xpEvent: {
        create: vi.fn(
          async ({
            data,
          }: {
            data: { userId: string; action: string; xpAmount: number; sourceId?: string | null };
          }) => {
            const row: XpEventRow = {
              id: `xp-${nextId++}`,
              createdAt: new Date(),
              ...data,
              sourceId: data.sourceId ?? null,
            };
            xpEvents.push(row);
            return row;
          },
        ),
        findMany: vi.fn(async ({ where }: { where: Where }) =>
          xpEvents.filter((row) => matchesXpWhere(row, where)),
        ),
        findFirst: vi.fn(async ({ where }: { where: Where }) =>
          xpEvents.find((row) => matchesXpWhere(row, where)) ?? null,
        ),
        aggregate: vi.fn(async ({ where }: { where: Where }) => ({
          _sum: {
            xpAmount: xpEvents
              .filter((row) => matchesXpWhere(row, where))
              .reduce((sum, row) => sum + row.xpAmount, 0),
          },
        })),
        count: vi.fn(async ({ where }: { where: Where }) =>
          xpEvents.filter((row) => matchesXpWhere(row, where)).length,
        ),
      },
      userGameState: {
        upsert: vi.fn(async ({ where }: { where: { userId: string } }) => {
          const existing = gameStates.get(where.userId);
          if (existing) return existing;
          const row: GameStateRow = {
            userId: where.userId,
            dailyXpGoal: 50,
            streakFreezes: 0,
            streakFreezeUsedDate: null,
            timezone: null,
          };
          gameStates.set(where.userId, row);
          return row;
        }),
        findUnique: vi.fn(async ({ where }: { where: { userId: string } }) =>
          gameStates.get(where.userId) ?? null,
        ),
        updateMany: vi.fn(
          async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
            let count = 0;
            for (const row of gameStates.values()) {
              if (!matchesGameStateWhere(row, where)) continue;
              count++;
              const freezes = data.streakFreezes as
                | { increment?: number; decrement?: number }
                | undefined;
              if (freezes?.increment) row.streakFreezes += freezes.increment;
              if (freezes?.decrement) row.streakFreezes -= freezes.decrement;
              if (typeof data.streakFreezeUsedDate === "string") {
                row.streakFreezeUsedDate = data.streakFreezeUsedDate;
              }
            }
            return { count };
          },
        ),
      },
      studyPlanItem: {
        findMany: vi.fn(async () => []),
      },
      achievement: {
        findMany: vi.fn(async () => []),
        createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })),
      },
      cardReview: {
        count: vi.fn(async () => 0),
      },
      _test: { xpEvents, gameStates },
    },
  };
});

import { consumeStreakFreeze, computeStreak, getGameState } from "@/services/gamification";
import { prisma } from "@/lib/db";

const testPrisma = (
  prisma as unknown as {
    _test: { xpEvents: XpEventRow[]; gameStates: Map<string, GameStateRow> };
  }
)._test;

const NOW = new Date("2026-07-15T10:00:00Z"); // UTC day 2026-07-15, Tokyo 19:00

function addXpEvent(overrides: Partial<XpEventRow> & { createdAt: Date }): void {
  testPrisma.xpEvents.push({
    id: `seed-${testPrisma.xpEvents.length + 1}`,
    userId: "user1",
    action: "FLASHCARD_REVIEW",
    xpAmount: 2,
    sourceId: null,
    ...overrides,
  });
}

function setGameState(overrides: Partial<GameStateRow> = {}): void {
  testPrisma.gameStates.set("user1", {
    userId: "user1",
    dailyXpGoal: 50,
    streakFreezes: 0,
    streakFreezeUsedDate: null,
    timezone: null,
    ...overrides,
  });
}

const NO_FREEZE_STATE = { streakFreezeUsedDate: null, streakFreezes: 0 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  testPrisma.xpEvents.length = 0;
  testPrisma.gameStates.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("consumeStreakFreeze", () => {
  it("consumes a freeze when streakFreezeUsedDate is NULL (never used before)", async () => {
    setGameState({ streakFreezes: 2, streakFreezeUsedDate: null });

    const result = await consumeStreakFreeze("user1");

    expect(result).toEqual({ success: true, freezesRemaining: 1 });
    expect(testPrisma.gameStates.get("user1")?.streakFreezeUsedDate).toBe("2026-07-15");
  });

  it("consumes a freeze when last used on a previous day", async () => {
    setGameState({ streakFreezes: 3, streakFreezeUsedDate: "2026-07-10" });

    const result = await consumeStreakFreeze("user1");

    expect(result).toEqual({ success: true, freezesRemaining: 2 });
  });

  it("refuses a second freeze on the same day", async () => {
    setGameState({ streakFreezes: 2, streakFreezeUsedDate: "2026-07-15" });

    const result = await consumeStreakFreeze("user1");

    expect(result).toEqual({ success: false, freezesRemaining: 2 });
    expect(testPrisma.xpEvents).toHaveLength(0);
  });

  it("refuses when no freezes are available", async () => {
    setGameState({ streakFreezes: 0, streakFreezeUsedDate: null });

    const result = await consumeStreakFreeze("user1");

    expect(result).toEqual({ success: false, freezesRemaining: 0 });
    expect(testPrisma.xpEvents).toHaveLength(0);
  });

  it("records the bridged day as a durable zero-XP STREAK_FREEZE_USED event", async () => {
    setGameState({ streakFreezes: 2, streakFreezeUsedDate: null });

    await consumeStreakFreeze("user1");

    const used = testPrisma.xpEvents.filter((e) => e.action === "STREAK_FREEZE_USED");
    expect(used).toHaveLength(1);
    expect(used[0].xpAmount).toBe(0);
    expect(used[0].sourceId).toBe("2026-07-15");
  });
});

describe("computeStreak", () => {
  it("counts today's activity even under a positive UTC offset", async () => {
    // Regression: the walk previously started from LOCAL midnight, which
    // serializes to yesterday's UTC key in Tokyo — streak showed 0 right
    // after studying.
    addXpEvent({ createdAt: new Date("2026-07-15T09:00:00Z") });

    expect(await computeStreak("user1", NO_FREEZE_STATE)).toBe(1);
  });

  it("counts consecutive UTC days", async () => {
    addXpEvent({ createdAt: new Date("2026-07-15T09:00:00Z") });
    addXpEvent({ createdAt: new Date("2026-07-14T23:30:00Z") });
    addXpEvent({ createdAt: new Date("2026-07-13T01:00:00Z") });

    expect(await computeStreak("user1", NO_FREEZE_STATE)).toBe(3);
  });

  it("stops at a gap", async () => {
    addXpEvent({ createdAt: new Date("2026-07-15T09:00:00Z") });
    addXpEvent({ createdAt: new Date("2026-07-13T09:00:00Z") });

    expect(await computeStreak("user1", NO_FREEZE_STATE)).toBe(1);
  });

  it("starts from yesterday when today has no activity", async () => {
    addXpEvent({ createdAt: new Date("2026-07-14T09:00:00Z") });
    addXpEvent({ createdAt: new Date("2026-07-13T09:00:00Z") });

    expect(await computeStreak("user1", NO_FREEZE_STATE)).toBe(2);
  });

  it("returns 0 when neither today nor yesterday is active", async () => {
    addXpEvent({ createdAt: new Date("2026-07-12T09:00:00Z") });

    expect(await computeStreak("user1", NO_FREEZE_STATE)).toBe(0);
  });

  it("bridges gaps using durable STREAK_FREEZE_USED events (sourceId = bridged date)", async () => {
    addXpEvent({ createdAt: new Date("2026-07-15T09:00:00Z") });
    addXpEvent({ createdAt: new Date("2026-07-13T09:00:00Z") });
    addXpEvent({
      action: "STREAK_FREEZE_USED",
      xpAmount: 0,
      sourceId: "2026-07-14",
      createdAt: new Date("2026-07-15T08:00:00Z"),
    });

    expect(await computeStreak("user1", NO_FREEZE_STATE)).toBe(3);
  });

  it("keeps honoring the legacy streakFreezeUsedDate field", async () => {
    addXpEvent({ createdAt: new Date("2026-07-15T09:00:00Z") });
    addXpEvent({ createdAt: new Date("2026-07-13T09:00:00Z") });

    const streak = await computeStreak("user1", {
      streakFreezeUsedDate: "2026-07-14",
      streakFreezes: 1,
    });

    expect(streak).toBe(3);
  });

  it("preserves days bridged by earlier freezes when a second freeze is consumed", async () => {
    // Freeze bridged 2026-07-13; user studied on the 14th; a second freeze
    // was consumed on the 15th, overwriting streakFreezeUsedDate. The durable
    // event keeps the 13th active.
    addXpEvent({ createdAt: new Date("2026-07-14T09:00:00Z") });
    addXpEvent({ createdAt: new Date("2026-07-12T09:00:00Z") });
    addXpEvent({
      action: "STREAK_FREEZE_USED",
      xpAmount: 0,
      sourceId: "2026-07-13",
      createdAt: new Date("2026-07-13T08:00:00Z"),
    });

    const streak = await computeStreak("user1", {
      streakFreezeUsedDate: "2026-07-15",
      streakFreezes: 0,
    });

    expect(streak).toBe(4);
  });

  it("does not treat STREAK_FREEZE_AWARD marker events as study activity", async () => {
    addXpEvent({ createdAt: new Date("2026-07-14T09:00:00Z") });
    addXpEvent({
      action: "STREAK_FREEZE_AWARD",
      xpAmount: 0,
      sourceId: "7",
      createdAt: new Date("2026-07-15T09:00:00Z"),
    });

    // Only yesterday is genuinely active — the award marker must not extend it
    expect(await computeStreak("user1", NO_FREEZE_STATE)).toBe(1);
  });
});

describe("computeStreak with a user timezone", () => {
  const NY_STATE = { ...NO_FREEZE_STATE, timezone: "America/New_York" };

  it("keys a 9pm ET session to the local day 2026-07-15, not the UTC day 2026-07-16", async () => {
    // 2026-07-16T01:00:00Z is 9pm on July 15 in New York. At NOW (July 15
    // UTC/ET) the ET user sees today's activity; UTC keys file the same
    // event under the 16th — tomorrow — so the streak would read 0.
    addXpEvent({ createdAt: new Date("2026-07-16T01:00:00Z") });

    expect(await computeStreak("user1", NY_STATE)).toBe(1);
    expect(await computeStreak("user1", NO_FREEZE_STATE)).toBe(0);
  });

  it("keeps a two-day local streak unbroken when a late-night session crosses the UTC boundary", async () => {
    vi.setSystemTime(new Date("2026-07-16T01:30:00Z")); // 9:30pm July 15 ET

    addXpEvent({ createdAt: new Date("2026-07-16T01:00:00Z") }); // 9pm Jul 15 ET (UTC day Jul 16)
    addXpEvent({ createdAt: new Date("2026-07-14T15:00:00Z") }); // 11am Jul 14 ET (UTC day Jul 14)

    // ET days: Jul 14 + Jul 15 — consecutive
    expect(await computeStreak("user1", NY_STATE)).toBe(2);
    // UTC days: Jul 14 + Jul 16 — broken at Jul 15
    expect(await computeStreak("user1", NO_FREEZE_STATE)).toBe(1);
  });

  it("reads the timezone from the game state row when none is passed in", async () => {
    setGameState({ timezone: "America/New_York" });
    addXpEvent({ createdAt: new Date("2026-07-16T01:00:00Z") }); // 9pm Jul 15 ET

    expect(await computeStreak("user1")).toBe(1);
  });
});

describe("consumeStreakFreeze with a user timezone", () => {
  it("stamps the bridged day in the user's local day, not the UTC day", async () => {
    vi.setSystemTime(new Date("2026-07-16T01:00:00Z")); // 9pm July 15 ET
    setGameState({ streakFreezes: 2, timezone: "America/New_York" });

    const result = await consumeStreakFreeze("user1");

    expect(result).toEqual({ success: true, freezesRemaining: 1 });
    expect(testPrisma.gameStates.get("user1")?.streakFreezeUsedDate).toBe("2026-07-15");

    const used = testPrisma.xpEvents.filter((e) => e.action === "STREAK_FREEZE_USED");
    expect(used).toHaveLength(1);
    expect(used[0].sourceId).toBe("2026-07-15");
  });

  it("refuses a second freeze on the same LOCAL day even after the UTC date rolls over", async () => {
    vi.setSystemTime(new Date("2026-07-16T01:00:00Z")); // still July 15 in ET
    setGameState({ streakFreezes: 2, streakFreezeUsedDate: "2026-07-15", timezone: "America/New_York" });

    const result = await consumeStreakFreeze("user1");

    expect(result).toEqual({ success: false, freezesRemaining: 2 });
    expect(testPrisma.xpEvents).toHaveLength(0);
  });
});

describe("streak freeze milestone award (via getGameState)", () => {
  function seedSevenDayStreak(): void {
    for (let i = 0; i < 7; i++) {
      addXpEvent({ createdAt: new Date(NOW.getTime() - i * 86_400_000) });
    }
  }

  it("awards exactly one freeze per milestone across repeated calls", async () => {
    seedSevenDayStreak();
    setGameState({ streakFreezes: 0 });

    const first = await getGameState("user1");
    expect(first.streak).toBe(7);
    expect(first.streakFreezes).toBe(1);

    const awards = () => testPrisma.xpEvents.filter((e) => e.action === "STREAK_FREEZE_AWARD");
    expect(awards()).toHaveLength(1);
    expect(awards()[0]).toMatchObject({ xpAmount: 0, sourceId: "7" });

    // Opening the dashboard again on the same milestone day must not re-award
    const second = await getGameState("user1");
    expect(second.streak).toBe(7);
    expect(second.streakFreezes).toBe(1);
    expect(awards()).toHaveLength(1);

    const third = await getGameState("user1");
    expect(third.streakFreezes).toBe(1);
    expect(awards()).toHaveLength(1);
  });

  it("does not award on non-milestone days", async () => {
    for (let i = 0; i < 5; i++) {
      addXpEvent({ createdAt: new Date(NOW.getTime() - i * 86_400_000) });
    }
    setGameState({ streakFreezes: 0 });

    const state = await getGameState("user1");
    expect(state.streak).toBe(5);
    expect(state.streakFreezes).toBe(0);
    expect(testPrisma.xpEvents.filter((e) => e.action === "STREAK_FREEZE_AWARD")).toHaveLength(0);
  });

  it("does not award beyond the cap of 3", async () => {
    seedSevenDayStreak();
    setGameState({ streakFreezes: 3 });

    const state = await getGameState("user1");
    expect(state.streakFreezes).toBe(3);
    expect(testPrisma.xpEvents.filter((e) => e.action === "STREAK_FREEZE_AWARD")).toHaveLength(0);
  });
});
