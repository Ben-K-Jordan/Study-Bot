import { describe, it, expect } from "vitest";
import { generatePlan, PlanBlock } from "@/lib/plan-generator";

const defaultAvailability = Array.from({ length: 7 }, () => ({
  start: "09:00",
  end: "17:00",
}));

function makeObjectives(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `Objective ${i + 1}`);
}

describe("plan-generator", () => {
  it("produces blocks for all required session types", () => {
    const blocks = generatePlan({
      objectives: makeObjectives(10),
      dailyCap: 180,
      breakProtocol: "50_10",
      availability: defaultAvailability,
    });

    const modes = blocks.map((b) => b.mode);
    expect(modes).toContain("RETRIEVAL");
    expect(modes).toContain("INTERLEAVED_PRACTICE");
    expect(modes).toContain("EXAM_SIM");
    expect(modes).toContain("ERROR_REPAIR");
  });

  it("includes a diagnostic session on day 0", () => {
    const blocks = generatePlan({
      objectives: makeObjectives(8),
      dailyCap: 180,
      breakProtocol: "50_10",
      availability: defaultAvailability,
    });

    const day0Diagnostic = blocks.find(
      (b) => b.dayIndex === 0 && b.targetOutcome.type === "diagnostic"
    );
    expect(day0Diagnostic).toBeDefined();
    expect(day0Diagnostic!.mode).toBe("RETRIEVAL");
  });

  it("ensures each objective appears in at least 2 retrieval sessions", () => {
    const objectives = makeObjectives(6);
    const blocks = generatePlan({
      objectives,
      dailyCap: 180,
      breakProtocol: "50_10",
      availability: defaultAvailability,
    });

    const retrievalBlocks = blocks.filter((b) => b.mode === "RETRIEVAL");
    for (const obj of objectives) {
      const count = retrievalBlocks.filter((b) =>
        b.objectives.some((o) => o.title === obj)
      ).length;
      expect(count).toBeGreaterThanOrEqual(2);
    }
  });

  it("respects daily cap", () => {
    const blocks = generatePlan({
      objectives: makeObjectives(10),
      dailyCap: 60,
      breakProtocol: "50_10",
      availability: defaultAvailability,
    });

    // Group by day and check total minutes
    const dayTotals: Record<number, number> = {};
    for (const b of blocks) {
      dayTotals[b.dayIndex] = (dayTotals[b.dayIndex] || 0) + b.plannedMinutes;
    }
    for (const [, total] of Object.entries(dayTotals)) {
      expect(total).toBeLessThanOrEqual(60);
    }
  });

  it("respects availability window", () => {
    const shortAvailability = Array.from({ length: 7 }, () => ({
      start: "14:00",
      end: "15:00", // only 60 min window
    }));

    const blocks = generatePlan({
      objectives: makeObjectives(6),
      dailyCap: 180,
      breakProtocol: "50_10",
      availability: shortAvailability,
    });

    for (const b of blocks) {
      expect(b.plannedMinutes).toBeLessThanOrEqual(60);
    }
  });

  it("produces blocks with valid planned_minutes (>= 15)", () => {
    const blocks = generatePlan({
      objectives: makeObjectives(12),
      dailyCap: 180,
      breakProtocol: "50_10",
      availability: defaultAvailability,
    });

    for (const b of blocks) {
      expect(b.plannedMinutes).toBeGreaterThanOrEqual(15);
    }
  });

  it("handles large objective lists (20+)", () => {
    const blocks = generatePlan({
      objectives: makeObjectives(25),
      dailyCap: 180,
      breakProtocol: "50_10",
      availability: defaultAvailability,
    });

    expect(blocks.length).toBeGreaterThanOrEqual(5);
    const modes = blocks.map((b) => b.mode);
    expect(modes).toContain("EXAM_SIM");
    expect(modes).toContain("ERROR_REPAIR");
  });

  it("skips days with insufficient remaining time", () => {
    const tightAvailability = Array.from({ length: 7 }, (_, i) => ({
      start: "09:00",
      end: i === 5 ? "09:10" : "17:00", // Day 5 only has 10 min
    }));

    const blocks = generatePlan({
      objectives: makeObjectives(6),
      dailyCap: 180,
      breakProtocol: "50_10",
      availability: tightAvailability,
    });

    // Day 5 should have at most 1 block (if any fit in 10 min, it'll be skipped since < 15)
    const day5Blocks = blocks.filter((b) => b.dayIndex === 5);
    // Both exam sim (60 min desired) and error repair (45 min desired) get clamped to 10 min
    // but since remaining drops and 10 < 15, the second should be skipped
    expect(day5Blocks.length).toBeLessThanOrEqual(1);
  });
});
