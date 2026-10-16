/**
 * The guide list stays small however often a guide is regenerated: only the
 * newest guide of each format carries its sections, and any one guide loads
 * on its own through getStudyGuide.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface GuideRow {
  id: string;
  userId: string;
  courseName: string;
  examName: string | null;
  guideType: string;
  title: string;
  createdAt: Date;
  content: unknown;
}

vi.mock("@/lib/db", () => {
  const state = { rows: [] as GuideRow[] };
  const pick = (row: GuideRow, select?: Record<string, boolean>) =>
    select ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k as keyof GuideRow]])) : row;
  return {
    prisma: {
      studyGuide: {
        findMany: vi.fn(
          async (args: { where: { userId: string; id?: { in: string[] } }; select?: Record<string, boolean> }) =>
            state.rows
              .filter((r) => r.userId === args.where.userId)
              .filter((r) => !args.where.id || args.where.id.in.includes(r.id))
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
              .map((r) => pick(r, args.select)),
        ),
        findFirst: vi.fn(
          async (args: { where: { id: string; userId: string }; select?: Record<string, boolean> }) => {
            const row = state.rows.find((r) => r.id === args.where.id && r.userId === args.where.userId);
            return row ? pick(row, args.select) : null;
          },
        ),
      },
      _test: state,
    },
  };
});

// Generation isn't under test here.
vi.mock("@/lib/ai/gateway", () => ({ runTask: vi.fn() }));
vi.mock("@/lib/ai/prompt-registry", () => ({ getPrompt: vi.fn() }));
vi.mock("@/lib/ai/provider-factory", () => ({ createProvider: vi.fn() }));

import { prisma } from "@/lib/db";
import { getStudyGuide, listStudyGuides } from "@/services/study-guides";

const state = (prisma as unknown as { _test: { rows: GuideRow[] } })._test;

function row(id: string, guideType: string, day: number, userId = "user1"): GuideRow {
  return {
    id,
    userId,
    courseName: "INFO 1300",
    examName: "Prelim 2",
    guideType,
    title: `${guideType} ${id}`,
    createdAt: new Date(`2026-10-${String(day).padStart(2, "0")}T15:00:00Z`),
    content: [{ concept: `Concept from ${id}`, explanation: "Text" }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.rows = [
    row("kc-old", "KEY_CONCEPTS", 1),
    row("faq", "FAQ", 2),
    row("kc-new", "KEY_CONCEPTS", 3),
    row("kc-mid", "KEY_CONCEPTS", 2),
    row("bogus", "MIND_MAP", 4),
    row("theirs", "CHEAT_SHEET", 5, "user2"),
  ];
});

describe("listStudyGuides", () => {
  it("lists every version, newest first, with sections only on the newest of each format", async () => {
    const guides = await listStudyGuides("user1", "INFO 1300", "Prelim 2");

    expect(guides.map((g) => g.id)).toEqual(["kc-new", "faq", "kc-mid", "kc-old"]);
    expect(guides.map((g) => g.sections !== undefined)).toEqual([true, true, false, false]);
    expect(guides[0].sections).toEqual([{ concept: "Concept from kc-new", explanation: "Text" }]);
    expect(guides[2]).not.toHaveProperty("sections");
    expect(guides[0]).toMatchObject({
      guide_type: "KEY_CONCEPTS",
      course_name: "INFO 1300",
      exam_name: "Prelim 2",
      created_at: "2026-10-03T15:00:00.000Z",
    });
  });

  it("reads content only for the guides that carry it", async () => {
    await listStudyGuides("user1", "INFO 1300");
    const calls = vi.mocked(prisma.studyGuide.findMany).mock.calls as unknown as [
      { where: { id?: { in: string[] } }; select: Record<string, boolean> },
    ][];
    expect(calls).toHaveLength(2);
    expect(calls[0][0].select).not.toHaveProperty("content");
    expect(calls[1][0].where.id?.in.sort()).toEqual(["faq", "kc-new"]);
  });

  it("skips the content query when there are no guides", async () => {
    state.rows = [];
    expect(await listStudyGuides("user1", "INFO 1300")).toEqual([]);
    expect(prisma.studyGuide.findMany).toHaveBeenCalledTimes(1);
  });
});

describe("getStudyGuide", () => {
  it("returns one guide with its sections", async () => {
    const guide = await getStudyGuide("user1", "kc-old");
    expect(guide?.id).toBe("kc-old");
    expect(guide?.sections).toEqual([{ concept: "Concept from kc-old", explanation: "Text" }]);
  });

  it("returns null for another account's guide, a missing one, or an unknown format", async () => {
    expect(await getStudyGuide("user1", "theirs")).toBeNull();
    expect(await getStudyGuide("user1", "nope")).toBeNull();
    expect(await getStudyGuide("user1", "bogus")).toBeNull();
  });
});
