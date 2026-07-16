/**
 * Unit tests for the research-informed plan generator.
 *
 * Tests both the deterministic fallback path and AI-generated plan conversion.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma (needed by research service and gateway)
vi.mock("@/lib/db", () => ({
  prisma: {
    evidenceCard: {
      findMany: vi.fn(async () => []),
    },
    $queryRawUnsafe: vi.fn(async () => []),
    $queryRaw: vi.fn(async () => []),
    aiCallLog: {
      create: vi.fn(async () => ({})),
      aggregate: vi.fn(async () => ({ _sum: { costUsdMicros: 0n } })),
    },
    aiCache: {
      findFirst: vi.fn(async () => null),
      upsert: vi.fn(async () => ({})),
    },
  },
}));

import { generatePlanWithResearch } from "@/lib/research-plan-generator";
import { MockProvider } from "@/lib/ai/providers/mock";

const DEFAULT_AVAILABILITY = Array.from({ length: 7 }, () => ({
  start: "09:00",
  end: "17:00",
}));

const DEFAULT_INPUT = {
  objectives: ["Algebra basics", "Linear equations", "Quadratic equations", "Graphing", "Word problems"],
  dailyCap: 180,
  breakProtocol: "50_10",
  availability: DEFAULT_AVAILABILITY,
  examDate: "2026-04-13",
};

describe("generatePlanWithResearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("deterministic fallback (no AI)", () => {
    it("returns blocks when gatewayCtx is null", async () => {
      const result = await generatePlanWithResearch(DEFAULT_INPUT, null);

      expect(result.aiGenerated).toBe(false);
      expect(result.blocks.length).toBeGreaterThanOrEqual(3);

      // Verify all blocks have valid structure
      for (const block of result.blocks) {
        expect(block.dayIndex).toBeGreaterThanOrEqual(0);
        expect(block.dayIndex).toBeLessThan(7);
        expect(block.plannedMinutes).toBeGreaterThanOrEqual(15);
        expect(block.objectives.length).toBeGreaterThan(0);
        expect(block.topicScope).toBeTruthy();
      }
    });

    it("produces deterministic output", async () => {
      const result1 = await generatePlanWithResearch(DEFAULT_INPUT, null);
      const result2 = await generatePlanWithResearch(DEFAULT_INPUT, null);

      expect(result1.blocks).toEqual(result2.blocks);
    });
  });

  describe("mock provider fallback", () => {
    it("falls back to deterministic when mock provider returns null blocks", async () => {
      const provider = new MockProvider();
      const ctx = { userId: "test-user", provider };

      const result = await generatePlanWithResearch(DEFAULT_INPUT, ctx);

      // Mock provider returns null blocks, triggering fallback
      expect(result.aiGenerated).toBe(false);
      expect(result.blocks.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("AI-generated plan conversion", () => {
    it("converts valid AI blocks into PlanBlocks", async () => {
      const provider = new MockProvider();
      // Override completeJson to return structured plan
      provider.completeJson = async () => ({
        json: {
          blocks: [
            {
              dayIndex: 0,
              mode: "RETRIEVAL",
              objectives: ["Algebra basics", "Linear equations"],
              plannedMinutes: 30,
              outcomeType: "diagnostic",
              targetAccuracy: 0.5,
              closedBookRequired: true,
            },
            {
              dayIndex: 1,
              mode: "RETRIEVAL",
              objectives: ["Quadratic equations", "Graphing"],
              plannedMinutes: 50,
              outcomeType: null,
              targetAccuracy: 0.8,
              closedBookRequired: true,
            },
            {
              dayIndex: 2,
              mode: "INTERLEAVED_PRACTICE",
              objectives: ["Algebra basics", "Linear equations", "Quadratic equations"],
              plannedMinutes: 60,
              outcomeType: null,
              targetAccuracy: 0.75,
              closedBookRequired: false,
            },
            {
              dayIndex: 5,
              mode: "EXAM_SIM",
              objectives: ["Algebra basics", "Linear equations", "Quadratic equations", "Graphing", "Word problems"],
              plannedMinutes: 60,
              outcomeType: null,
              targetAccuracy: 0.7,
              closedBookRequired: true,
            },
          ],
          reasoning: "Test AI reasoning",
        },
        usage: { tokenIn: 500, tokenOut: 200, costUsdMicros: 100 },
      });

      const ctx = { userId: "test-user", provider };
      const result = await generatePlanWithResearch(DEFAULT_INPUT, ctx);

      expect(result.aiGenerated).toBe(true);
      expect(result.blocks).toHaveLength(4);
      expect(result.reasoning).toBe("Test AI reasoning");

      // Verify block structure
      expect(result.blocks[0].mode).toBe("RETRIEVAL");
      expect(result.blocks[0].dayIndex).toBe(0);
      expect(result.blocks[0].plannedMinutes).toBe(30);
      expect(result.blocks[0].targetOutcome.type).toBe("diagnostic");

      expect(result.blocks[2].mode).toBe("INTERLEAVED_PRACTICE");
      expect(result.blocks[3].mode).toBe("EXAM_SIM");

      // Objective ids are stable slugs of the titles: the same objective
      // carries the same id in every block it appears in.
      expect(result.blocks[0].objectives).toEqual([
        { id: "algebra_basics", title: "Algebra basics" },
        { id: "linear_equations", title: "Linear equations" },
      ]);
      const idsByTitle = new Map<string, string>();
      for (const block of result.blocks) {
        for (const o of block.objectives) {
          const prior = idsByTitle.get(o.title);
          expect(prior ?? o.id).toBe(o.id);
          idsByTitle.set(o.title, o.id);
        }
      }
      expect(idsByTitle.get("Word problems")).toBe("word_problems");
    });

    it("filters out blocks with invalid modes", async () => {
      const provider = new MockProvider();
      provider.completeJson = async () => ({
        json: {
          blocks: [
            { dayIndex: 0, mode: "RETRIEVAL", objectives: ["Algebra basics"], plannedMinutes: 30, outcomeType: null, targetAccuracy: 0.8, closedBookRequired: true },
            { dayIndex: 0, mode: "INVALID_MODE", objectives: ["Algebra basics"], plannedMinutes: 30, outcomeType: null, targetAccuracy: 0.8, closedBookRequired: true },
            { dayIndex: 1, mode: "EXAM_SIM", objectives: ["Algebra basics"], plannedMinutes: 50, outcomeType: null, targetAccuracy: 0.7, closedBookRequired: true },
            { dayIndex: 2, mode: "RETRIEVAL", objectives: ["Linear equations"], plannedMinutes: 40, outcomeType: null, targetAccuracy: 0.8, closedBookRequired: true },
          ],
          reasoning: "test",
        },
        usage: { tokenIn: 100, tokenOut: 50, costUsdMicros: 10 },
      });

      const ctx = { userId: "test-user", provider };
      const result = await generatePlanWithResearch(DEFAULT_INPUT, ctx);

      expect(result.aiGenerated).toBe(true);
      expect(result.blocks).toHaveLength(3); // Invalid mode filtered out
      expect(result.blocks.every((b) => (b.mode as string) !== "INVALID_MODE")).toBe(true);
    });

    it("clamps duration to daily cap", async () => {
      const provider = new MockProvider();
      provider.completeJson = async () => ({
        json: {
          blocks: [
            { dayIndex: 0, mode: "RETRIEVAL", objectives: ["Algebra basics"], plannedMinutes: 300, outcomeType: null, targetAccuracy: 0.8, closedBookRequired: true },
            { dayIndex: 1, mode: "RETRIEVAL", objectives: ["Linear equations"], plannedMinutes: 50, outcomeType: null, targetAccuracy: 0.8, closedBookRequired: true },
            { dayIndex: 2, mode: "RETRIEVAL", objectives: ["Quadratic equations"], plannedMinutes: 50, outcomeType: null, targetAccuracy: 0.8, closedBookRequired: true },
          ],
          reasoning: "test",
        },
        usage: { tokenIn: 100, tokenOut: 50, costUsdMicros: 10 },
      });

      const input = { ...DEFAULT_INPUT, dailyCap: 60 };
      const ctx = { userId: "test-user", provider };
      const result = await generatePlanWithResearch(input, ctx);

      expect(result.aiGenerated).toBe(true);
      // First block should be clamped to 60 min (daily cap)
      expect(result.blocks[0].plannedMinutes).toBeLessThanOrEqual(60);
    });

    it("falls back when AI returns too few blocks", async () => {
      const provider = new MockProvider();
      provider.completeJson = async () => ({
        json: {
          blocks: [
            { dayIndex: 0, mode: "RETRIEVAL", objectives: ["Algebra basics"], plannedMinutes: 30, outcomeType: null, targetAccuracy: 0.8, closedBookRequired: true },
          ],
          reasoning: "Only one block",
        },
        usage: { tokenIn: 100, tokenOut: 50, costUsdMicros: 10 },
      });

      const ctx = { userId: "test-user", provider };
      const result = await generatePlanWithResearch(DEFAULT_INPUT, ctx);

      // Too few blocks → deterministic fallback
      expect(result.aiGenerated).toBe(false);
      expect(result.blocks.length).toBeGreaterThanOrEqual(3);
    });

    it("falls back gracefully on provider error", async () => {
      const provider = new MockProvider();
      provider.completeJson = async () => {
        throw new Error("API rate limited");
      };

      const ctx = { userId: "test-user", provider };
      const result = await generatePlanWithResearch(DEFAULT_INPUT, ctx);

      expect(result.aiGenerated).toBe(false);
      expect(result.blocks.length).toBeGreaterThanOrEqual(3);
      expect(result.reasoning).toContain("AI unavailable");
    });

    it("substitutes unrecognized objectives with defaults", async () => {
      const provider = new MockProvider();
      provider.completeJson = async () => ({
        json: {
          blocks: [
            { dayIndex: 0, mode: "RETRIEVAL", objectives: ["Unknown Topic X"], plannedMinutes: 30, outcomeType: null, targetAccuracy: 0.8, closedBookRequired: true },
            { dayIndex: 1, mode: "RETRIEVAL", objectives: ["Another Unknown"], plannedMinutes: 30, outcomeType: null, targetAccuracy: 0.8, closedBookRequired: true },
            { dayIndex: 2, mode: "RETRIEVAL", objectives: ["Yet Another"], plannedMinutes: 30, outcomeType: null, targetAccuracy: 0.8, closedBookRequired: true },
          ],
          reasoning: "test",
        },
        usage: { tokenIn: 100, tokenOut: 50, costUsdMicros: 10 },
      });

      const ctx = { userId: "test-user", provider };
      const result = await generatePlanWithResearch(DEFAULT_INPUT, ctx);

      // Unrecognized objectives should be replaced with first 5 from input
      for (const block of result.blocks) {
        expect(block.objectives.length).toBeGreaterThan(0);
      }
    });
  });
});
