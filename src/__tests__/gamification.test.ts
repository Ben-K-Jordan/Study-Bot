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

// next/server's after() throws outside a request scope, as in scripts and
// tests. A test can switch `inRequest` on to collect the scheduled work.
const nextServer = vi.hoisted(() => ({ inRequest: false, tasks: [] as Array<() => Promise<void>> }));
vi.mock("next/server", () => ({
  after: (task: () => Promise<void>) => {
    if (!nextServer.inRequest) throw new Error("`after` was called outside a request scope.");
    nextServer.tasks.push(task);
  },
}));

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
  const planZones: string[] = [];
  const achievements: string[] = [];
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
    if (where.action !== undefined) {
      const cond = where.action as string | { notIn?: string[] };
      if (typeof cond === "string") {
        if (row.action !== cond) return false;
      } else if (cond.notIn?.includes(row.action)) {
        return false;
      }
    }
    if (where.sourceId !== undefined && row.sourceId !== where.sourceId) return false;
    if (where.createdAt !== undefined) {
      const cond = where.createdAt as { gte?: Date; lt?: Date };
      if (cond.gte !== undefined && row.createdAt < cond.gte) return false;
      if (cond.lt !== undefined && row.createdAt >= cond.lt) return false;
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
      studyPlan: {
        // Newest plan first, as the service asks for it.
        findFirst: vi.fn(async () => (planZones.length > 0 ? { timezone: planZones[0] } : null)),
      },
      achievement: {
        findMany: vi.fn(async () => achievements.map((badgeType) => ({ badgeType, earnedAt: new Date() }))),
        createMany: vi.fn(async ({ data }: { data: { badgeType: string }[] }) => {
          for (const row of data) if (!achievements.includes(row.badgeType)) achievements.push(row.badgeType);
          return { count: data.length };
        }),
      },
      cardReview: {
        count: vi.fn(async () => 0),
      },
      _test: { xpEvents, gameStates, planZones, achievements },
    },
  };
});

import {
  awardXp,
  bucketActivity,
  consumeStreakFreeze,
  computeStreak,
  getGameState,
  getStreak,
  resolveTimeZone,
  streakFromDays,
  syncProgress,
} from "@/services/gamification";
import { prisma } from "@/lib/db";

const testPrisma = (
  prisma as unknown as {
    _test: {
      xpEvents: XpEventRow[];
      gameStates: Map<string, GameStateRow>;
      planZones: string[];
      achievements: string[];
    };
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
  testPrisma.planZones.length = 0;
  testPrisma.achievements.length = 0;
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

    expect(result).toEqual({ success: false, freezesRemaining: 2, reason: "already_used_today" });
    expect(testPrisma.xpEvents).toHaveLength(0);
  });

  it("refuses when no freezes are available", async () => {
    setGameState({ streakFreezes: 0, streakFreezeUsedDate: null });

    const result = await consumeStreakFreeze("user1");

    expect(result).toEqual({ success: false, freezesRemaining: 0, reason: "no_freezes" });
    expect(testPrisma.xpEvents).toHaveLength(0);
  });

  it("refuses when the student already studied today, keeping the freeze", async () => {
    setGameState({ streakFreezes: 1 });
    addXpEvent({ createdAt: new Date("2026-07-15T08:00:00Z") });

    const result = await consumeStreakFreeze("user1");

    expect(result).toEqual({ success: false, freezesRemaining: 1, reason: "already_active" });
    expect(testPrisma.gameStates.get("user1")?.streakFreezes).toBe(1);
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

describe("streakFromDays", () => {
  it("counts back from today when today is active", () => {
    expect(streakFromDays(new Set(["2026-07-15", "2026-07-14", "2026-07-13"]), "2026-07-15")).toBe(3);
  });

  it("counts back from yesterday when today has no activity yet", () => {
    expect(streakFromDays(new Set(["2026-07-14", "2026-07-13"]), "2026-07-15")).toBe(2);
  });

  it("is 0 when neither today nor yesterday is active", () => {
    expect(streakFromDays(new Set(["2026-07-13"]), "2026-07-15")).toBe(0);
  });

  it("walks across month and daylight saving boundaries by calendar day", () => {
    // US clocks fall back on 2026-11-01.
    const days = new Set(["2026-11-02", "2026-11-01", "2026-10-31", "2026-10-30"]);
    expect(streakFromDays(days, "2026-11-02")).toBe(4);
  });
});

describe("computeStreak", () => {
  it("counts today's activity even under a positive UTC offset", async () => {
    // Regression: the walk previously started from LOCAL midnight, which
    // serializes to yesterday's UTC key in Tokyo, so the streak showed 0
    // right after studying.
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

  it("counts streaks longer than 90 days", async () => {
    for (let i = 0; i < 120; i++) {
      addXpEvent({ createdAt: new Date(NOW.getTime() - i * 86_400_000) });
    }

    expect(await computeStreak("user1", NO_FREEZE_STATE)).toBe(120);
  });

  it("reads only the recent window for a short streak", async () => {
    for (let i = 0; i < 5; i++) addXpEvent({ createdAt: new Date(NOW.getTime() - i * 86_400_000) });
    // An older run of study outside the short window doesn't matter here.
    for (let i = 60; i < 70; i++) addXpEvent({ createdAt: new Date(NOW.getTime() - i * 86_400_000) });

    expect(await computeStreak("user1", NO_FREEZE_STATE)).toBe(5);
    expect(prisma.xpEvent.findMany).toHaveBeenCalledTimes(1);
  });

  it("reads further back when the streak reaches the edge of the short window", async () => {
    for (let i = 0; i < 45; i++) addXpEvent({ createdAt: new Date(NOW.getTime() - i * 86_400_000) });

    expect(await computeStreak("user1", NO_FREEZE_STATE)).toBe(45);
    expect(prisma.xpEvent.findMany).toHaveBeenCalledTimes(2);
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

    expect(await computeStreak("user1", NO_FREEZE_STATE)).toBe(1);
  });
});

describe("computeStreak with a user timezone", () => {
  const NY_STATE = { ...NO_FREEZE_STATE, timezone: "America/New_York" };

  it("keys a 9pm ET session to the local day 2026-07-15, not the UTC day 2026-07-16", async () => {
    addXpEvent({ createdAt: new Date("2026-07-16T01:00:00Z") });

    expect(await computeStreak("user1", NY_STATE)).toBe(1);
    expect(await computeStreak("user1", NO_FREEZE_STATE)).toBe(0);
  });

  it("keeps a two-day local streak unbroken when a late-night session crosses the UTC boundary", async () => {
    vi.setSystemTime(new Date("2026-07-16T01:30:00Z")); // 9:30pm July 15 ET

    addXpEvent({ createdAt: new Date("2026-07-16T01:00:00Z") });
    addXpEvent({ createdAt: new Date("2026-07-14T15:00:00Z") });

    expect(await computeStreak("user1", NY_STATE)).toBe(2);
    expect(await computeStreak("user1", NO_FREEZE_STATE)).toBe(1);
  });

  it("reads the timezone from the game state row when none is passed in", async () => {
    setGameState({ timezone: "America/New_York" });
    addXpEvent({ createdAt: new Date("2026-07-16T01:00:00Z") });

    expect(await computeStreak("user1")).toBe(1);
  });
});

describe("getStreak", () => {
  it("counts days in the newest plan's zone when Settings has none, like getGameState", async () => {
    vi.setSystemTime(new Date("2026-07-16T01:30:00Z")); // 9:30pm July 15 ET
    setGameState({ timezone: null });
    testPrisma.planZones.push("America/New_York");
    addXpEvent({ createdAt: new Date("2026-07-16T01:00:00Z") }); // July 15 ET
    addXpEvent({ createdAt: new Date("2026-07-14T15:00:00Z") }); // July 14 ET

    expect(await getStreak("user1")).toBe(2);
    expect((await getGameState("user1")).streak).toBe(2);
  });

  it("is 0 for a student with no activity", async () => {
    expect(await getStreak("user1")).toBe(0);
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
    vi.setSystemTime(new Date("2026-07-16T01:00:00Z"));
    setGameState({ streakFreezes: 2, streakFreezeUsedDate: "2026-07-15", timezone: "America/New_York" });

    const result = await consumeStreakFreeze("user1");

    expect(result).toEqual({ success: false, freezesRemaining: 2, reason: "already_used_today" });
    expect(testPrisma.xpEvents).toHaveLength(0);
  });

  it("falls back to the newest plan's zone when Settings has none", async () => {
    vi.setSystemTime(new Date("2026-07-16T01:00:00Z")); // still July 15 in New York
    setGameState({ streakFreezes: 1, timezone: null });
    testPrisma.planZones.push("America/New_York");

    await consumeStreakFreeze("user1");

    expect(testPrisma.gameStates.get("user1")?.streakFreezeUsedDate).toBe("2026-07-15");
  });
});

describe("resolveTimeZone", () => {
  it("prefers the Settings zone", async () => {
    testPrisma.planZones.push("Europe/Paris");
    expect(await resolveTimeZone("user1", "America/Chicago")).toBe("America/Chicago");
  });

  it("uses the newest plan's zone when Settings has none", async () => {
    testPrisma.planZones.push("Europe/Paris");
    expect(await resolveTimeZone("user1", null)).toBe("Europe/Paris");
  });

  it("ignores an invalid zone and ends at UTC", async () => {
    expect(await resolveTimeZone("user1", "Not/AZone")).toBe("UTC");
  });
});

describe("getGameState", () => {
  it("counts XP today from the student's midnight, not the server's", async () => {
    // The server runs in Tokyo (TZ above). At 9:30pm July 15 in New York,
    // Tokyo midnight was 11am ET, so a server-local "today" would drop the
    // 8am ET review.
    vi.setSystemTime(new Date("2026-07-16T01:30:00Z"));
    setGameState({ timezone: "America/New_York" });
    addXpEvent({ createdAt: new Date("2026-07-15T12:00:00Z"), xpAmount: 2 }); // 8am ET Jul 15
    addXpEvent({ createdAt: new Date("2026-07-15T03:00:00Z"), xpAmount: 2 }); // 11pm ET Jul 14

    const state = await getGameState("user1");

    expect(state.timeZone).toBe("America/New_York");
    expect(state.xpToday).toBe(2);
    expect(state.xpTotal).toBe(4);
    expect(state.activeToday).toBe(true);
    expect(state.streak).toBe(2);
  });

  it("never writes: no game state row, freeze or achievement is created on read", async () => {
    for (let i = 0; i < 7; i++) {
      addXpEvent({ createdAt: new Date(NOW.getTime() - i * 86_400_000) });
    }

    const state = await getGameState("user1");

    expect(state.streak).toBe(7);
    expect(state.newAchievements).toEqual([]);
    expect(testPrisma.gameStates.size).toBe(0);
    expect(testPrisma.achievements).toEqual([]);
    expect(testPrisma.xpEvents.filter((e) => e.action === "STREAK_FREEZE_AWARD")).toHaveLength(0);
  });
});

describe("syncProgress (the write path)", () => {
  function seedDays(count: number): void {
    for (let i = 0; i < count; i++) {
      addXpEvent({ createdAt: new Date(NOW.getTime() - i * 86_400_000) });
    }
  }

  it("awards exactly one freeze per milestone across repeated calls", async () => {
    seedDays(7);
    setGameState({ streakFreezes: 0 });

    const first = await syncProgress("user1");
    expect(first.streak).toBe(7);
    expect(first.streakFreezes).toBe(1);

    const awards = () => testPrisma.xpEvents.filter((e) => e.action === "STREAK_FREEZE_AWARD");
    expect(awards()).toHaveLength(1);
    expect(awards()[0]).toMatchObject({ xpAmount: 0, sourceId: "7" });

    const second = await syncProgress("user1");
    expect(second.streakFreezes).toBe(1);
    expect(awards()).toHaveLength(1);
  });

  it("does not award a freeze on non-milestone days", async () => {
    seedDays(5);
    setGameState({ streakFreezes: 0 });

    const result = await syncProgress("user1");
    expect(result.streak).toBe(5);
    expect(result.streakFreezes).toBe(0);
  });

  it("does not award beyond the cap of 3", async () => {
    seedDays(7);
    setGameState({ streakFreezes: 3 });

    const result = await syncProgress("user1");
    expect(result.streakFreezes).toBe(3);
    expect(testPrisma.xpEvents.filter((e) => e.action === "STREAK_FREEZE_AWARD")).toHaveLength(0);
  });

  it("awards each reached achievement once", async () => {
    seedDays(3);

    const first = await syncProgress("user1");
    expect(first.newAchievements).toEqual(["STREAK_3"]);

    const second = await syncProgress("user1");
    expect(second.newAchievements).toEqual([]);
    expect(testPrisma.achievements).toEqual(["STREAK_3"]);
  });

  it("awards the perfect-deck achievement from PERFECT_DECK events, not review counts", async () => {
    addXpEvent({ action: "PERFECT_DECK", xpAmount: 3, createdAt: NOW });

    const result = await syncProgress("user1");
    expect(result.newAchievements).toContain("FIRST_PERFECT");
  });

  it("skips the streak work when the event isn't the first study of the day", async () => {
    // Six earlier days plus a review this morning: the 7-day milestone was
    // reached by this morning's review, so a second one changes nothing.
    for (let i = 1; i < 7; i++) addXpEvent({ createdAt: new Date(NOW.getTime() - i * 86_400_000) });
    addXpEvent({ createdAt: new Date(NOW.getTime() - 60 * 60_000) });
    addXpEvent({ createdAt: NOW });
    setGameState({ streakFreezes: 0 });

    const result = await syncProgress("user1", { createdAt: NOW });
    expect(result.streak).toBeNull();
    expect(result.streakFreezes).toBe(0);
    expect(result.newAchievements).not.toContain("STREAK_7");
    expect(prisma.studyPlanItem.findMany).not.toHaveBeenCalled();
  });

  it("checks the streak on the first study of the day", async () => {
    for (let i = 0; i < 7; i++) addXpEvent({ createdAt: new Date(NOW.getTime() - i * 86_400_000) });
    setGameState({ streakFreezes: 0 });

    const result = await syncProgress("user1", { createdAt: NOW });
    expect(result.streak).toBe(7);
    expect(result.streakFreezes).toBe(1);
    expect(result.newAchievements).toContain("STREAK_7");
  });

  it("still checks the streak when only a freeze came earlier today", async () => {
    addXpEvent({ action: "STREAK_FREEZE_USED", xpAmount: 0, sourceId: "2026-07-14", createdAt: new Date(NOW.getTime() - 86_400_000) });
    addXpEvent({ action: "STREAK_FREEZE_USED", xpAmount: 0, sourceId: "2026-07-15", createdAt: new Date(NOW.getTime() - 60 * 60_000) });
    addXpEvent({ createdAt: new Date(NOW.getTime() - 2 * 86_400_000) });
    addXpEvent({ createdAt: NOW });

    const result = await syncProgress("user1", { createdAt: NOW });
    expect(result.streak).toBe(3);
    expect(result.newAchievements).toContain("STREAK_3");
  });
});

describe("awardXp", () => {
  it("records the event and awards what it unlocks", async () => {
    addXpEvent({ createdAt: new Date(NOW.getTime() - 86_400_000) });
    addXpEvent({ createdAt: new Date(NOW.getTime() - 2 * 86_400_000) });

    // Outside a Next request there is no response to wait for, so the
    // awarding finishes before awardXp returns.
    await awardXp("user1", "FLASHCARD_REVIEW", undefined, "card-1");

    expect(testPrisma.xpEvents.filter((e) => e.sourceId === "card-1")).toHaveLength(1);
    expect(testPrisma.achievements).toContain("STREAK_3");
  });

  it("awards after the response when called inside a request", async () => {
    addXpEvent({ createdAt: new Date(NOW.getTime() - 86_400_000) });
    addXpEvent({ createdAt: new Date(NOW.getTime() - 2 * 86_400_000) });
    nextServer.inRequest = true;
    nextServer.tasks.length = 0;
    try {
      const result = await awardXp("user1", "FLASHCARD_REVIEW", undefined, "card-2");

      // The XP is recorded before the response; the awarding waits for after().
      expect(result.xpAmount).toBe(2);
      expect(testPrisma.xpEvents.filter((e) => e.sourceId === "card-2")).toHaveLength(1);
      expect(testPrisma.achievements).not.toContain("STREAK_3");
      expect(nextServer.tasks).toHaveLength(1);

      await nextServer.tasks[0]();
      expect(testPrisma.achievements).toContain("STREAK_3");
    } finally {
      nextServer.inRequest = false;
      nextServer.tasks.length = 0;
    }
  });

  it("gives no XP for guides or chat, which aren't practice", async () => {
    expect(await awardXp("user1", "GUIDE_GENERATED")).toEqual({ id: "", xpAmount: 0 });
    expect(await awardXp("user1", "CHAT_QUESTION")).toEqual({ id: "", xpAmount: 0 });
    expect(testPrisma.xpEvents).toHaveLength(0);
  });

  it("skips zero amounts", async () => {
    const result = await awardXp("user1", "STREAK_MILESTONE");
    expect(result).toEqual({ id: "", xpAmount: 0 });
    expect(testPrisma.xpEvents).toHaveLength(0);
  });
});

describe("bucketActivity", () => {
  const ZONE = "America/New_York";

  it("files each event under the student's day and counts what it is", () => {
    const days = bucketActivity(
      [
        { action: "SESSION_COMPLETED", xpAmount: 10, sourceId: "run-1", createdAt: new Date("2026-07-15T01:00:00Z") },
        { action: "FLASHCARD_REVIEW", xpAmount: 2, sourceId: "c1", createdAt: new Date("2026-07-15T02:00:00Z") },
        { action: "FLASHCARD_REVIEW", xpAmount: 2, sourceId: "c2", createdAt: new Date("2026-07-15T14:00:00Z") },
        { action: "STREAK_FREEZE_AWARD", xpAmount: 0, sourceId: "7", createdAt: new Date("2026-07-15T14:00:00Z") },
      ],
      [],
      ZONE,
    );

    // 9pm and 10pm ET on July 14; 10am ET on July 15
    expect(days.get("2026-07-14")).toMatchObject({ sessions: 1, reviews: 1, xp: 12 });
    expect(days.get("2026-07-15")).toMatchObject({ sessions: 0, reviews: 1, xp: 2 });
  });

  it("does not count a finished plan item twice when its run has an event", () => {
    const days = bucketActivity(
      [{ action: "SESSION_COMPLETED", xpAmount: 10, sourceId: "run-1", createdAt: new Date("2026-07-15T15:00:00Z") }],
      [
        { completedAt: new Date("2026-07-15T15:00:00Z"), startTime: new Date("2026-07-15T14:30:00Z"), completedRunId: "run-1" },
        { completedAt: new Date("2026-07-15T18:00:00Z"), startTime: new Date("2026-07-15T17:30:00Z"), completedRunId: null },
      ],
      ZONE,
    );

    expect(days.get("2026-07-15")?.sessions).toBe(2);
  });

  it("marks days a freeze bridged without counting them as study", () => {
    const days = bucketActivity(
      [{ action: "STREAK_FREEZE_USED", xpAmount: 0, sourceId: "2026-07-13", createdAt: new Date("2026-07-14T02:00:00Z") }],
      [],
      ZONE,
    );

    expect(days.get("2026-07-13")).toMatchObject({ freezeUsed: true, sessions: 0, reviews: 0, xp: 0 });
  });
});
