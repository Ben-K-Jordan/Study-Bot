/**
 * Server reads shared by Home and Progress. loadPlans keeps a fixed number
 * of plans; a long-time student with more than that must still see the
 * upcoming exams and today's sessions.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ getCurrentUserId: vi.fn(async () => "user1") }));
vi.mock("@/services/gamification", () => ({
  getActivityByDay: vi.fn(),
  getGameState: vi.fn(),
  resolveTimeZone: vi.fn(async () => "UTC"),
}));

interface PlanFixture {
  planId: string;
  courseName: string;
  examName: string;
  examDate: Date;
  createdAt: Date;
  config: unknown;
  items: never[];
}

type OrderBy = Array<Partial<Record<"examDate" | "createdAt", "asc" | "desc">>>;

const db = vi.hoisted(() => ({ plans: [] as PlanFixture[] }));

vi.mock("@/lib/db", () => ({
  prisma: {
    studyPlan: {
      // Applies orderBy and take the way Postgres would.
      findMany: vi.fn(async ({ orderBy, take }: { orderBy: OrderBy; take?: number }) => {
        const sorted = [...db.plans].sort((a, b) => {
          for (const clause of orderBy) {
            const [field, direction] = Object.entries(clause)[0] as ["examDate" | "createdAt", "asc" | "desc"];
            const diff = a[field].getTime() - b[field].getTime();
            if (diff !== 0) return direction === "asc" ? diff : -diff;
          }
          return 0;
        });
        return take === undefined ? sorted : sorted.slice(0, take);
      }),
    },
    planReflowAudit: { findMany: vi.fn(async () => []) },
    sessionRun: { findMany: vi.fn(async () => []) },
  },
}));

import { PLAN_LIMIT, loadPlans } from "@/services/progress-data";

function plan(id: string, examDate: string, createdAt: string): PlanFixture {
  return {
    planId: id,
    courseName: "CS 2110",
    examName: id,
    examDate: new Date(`${examDate}T00:00:00Z`),
    createdAt: new Date(createdAt),
    config: null,
    items: [],
  };
}

beforeEach(() => {
  db.plans.length = 0;
});

describe("loadPlans", () => {
  it("keeps upcoming exams when a student has more plans than the limit", async () => {
    // Old semesters fill the limit with exams that are long over.
    for (let i = 0; i < PLAN_LIMIT; i++) {
      const day = String((i % 28) + 1).padStart(2, "0");
      db.plans.push(plan(`old-${i}`, `2024-0${(i % 9) + 1}-${day}`, "2024-01-01T00:00:00Z"));
    }
    db.plans.push(plan("prelim-1", "2026-10-22", "2026-10-01T00:00:00Z"));

    const plans = await loadPlans("user1");

    expect(plans).toHaveLength(PLAN_LIMIT);
    expect(plans.at(-1)?.planId).toBe("prelim-1");
    expect(plans.some((p) => p.planId === "old-0")).toBe(false);
  });

  it("lists the soonest exam first, and the newest plan first on the same date", async () => {
    db.plans.push(
      plan("final", "2026-12-10", "2026-09-01T00:00:00Z"),
      plan("prelim-older", "2026-10-22", "2026-09-01T00:00:00Z"),
      plan("prelim-newer", "2026-10-22", "2026-10-01T00:00:00Z"),
    );

    const plans = await loadPlans("user1");

    expect(plans.map((p) => p.planId)).toEqual(["prelim-newer", "prelim-older", "final"]);
    expect(plans[0].examDateKey).toBe("2026-10-22");
  });
});
