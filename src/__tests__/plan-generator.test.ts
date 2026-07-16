import { describe, it, expect } from "vitest";
import {
  generatePlan,
  PlanBlock,
  slugifyObjectiveTitle,
  buildObjectiveIdMap,
} from "@/lib/plan-generator";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultAvailability = Array.from({ length: 7 }, () => ({
  start: "09:00",
  end: "17:00",
}));

function makeObjectives(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `Objective ${i + 1}`);
}

function defaultInput(overrides?: Partial<Parameters<typeof generatePlan>[0]>) {
  return {
    objectives: makeObjectives(10),
    dailyCap: 180,
    breakProtocol: "50_10",
    availability: defaultAvailability,
    ...overrides,
  };
}

function dayTotals(blocks: PlanBlock[]): Record<number, number> {
  const totals: Record<number, number> = {};
  for (const b of blocks) {
    totals[b.dayIndex] = (totals[b.dayIndex] || 0) + b.plannedMinutes;
  }
  return totals;
}

// ---------------------------------------------------------------------------
// A) Pedagogical Invariants
// ---------------------------------------------------------------------------

describe("plan-generator: pedagogical invariants", () => {
  const objectiveCounts = [3, 6, 10, 15, 25];

  for (const n of objectiveCounts) {
    describe(`with ${n} objectives`, () => {
      const blocks = generatePlan(defaultInput({ objectives: makeObjectives(n) }));
      const modes = blocks.map((b) => b.mode);

      it("contains >= 1 INTERLEAVED_PRACTICE", () => {
        expect(modes.filter((m) => m === "INTERLEAVED_PRACTICE").length).toBeGreaterThanOrEqual(1);
      });

      it("contains >= 1 EXAM_SIM scheduled in last 2 days (day_index >= 5)", () => {
        const examSimBlocks = blocks.filter(
          (b) => b.mode === "EXAM_SIM" && b.dayIndex >= 5
        );
        expect(examSimBlocks.length).toBeGreaterThanOrEqual(1);
      });

      it("contains >= 1 ERROR_REPAIR scheduled in last 2 days (day_index >= 5)", () => {
        const errorRepairBlocks = blocks.filter(
          (b) => b.mode === "ERROR_REPAIR" && b.dayIndex >= 5
        );
        expect(errorRepairBlocks.length).toBeGreaterThanOrEqual(1);
      });

      it("each objective appears in >= 2 RETRIEVAL sessions", () => {
        const objectives = makeObjectives(n);
        const retrievalBlocks = blocks.filter((b) => b.mode === "RETRIEVAL");
        for (const obj of objectives) {
          const count = retrievalBlocks.filter((b) =>
            b.objectives.some((o) => o.title === obj)
          ).length;
          expect(count, `Objective "${obj}" should appear in >= 2 RETRIEVAL sessions`).toBeGreaterThanOrEqual(2);
        }
      });

      it("every block has target_outcome populated", () => {
        for (const b of blocks) {
          expect(b.targetOutcome).toBeDefined();
          expect(b.targetOutcome.prompt_count).toBeGreaterThan(0);
          expect(b.targetOutcome.target_accuracy).toBeGreaterThan(0);
        }
      });
    });
  }

  it("includes a diagnostic session on day 0", () => {
    const blocks = generatePlan(defaultInput());
    const diag = blocks.find(
      (b) => b.dayIndex === 0 && b.targetOutcome.type === "diagnostic"
    );
    expect(diag).toBeDefined();
    expect(diag!.mode).toBe("RETRIEVAL");
  });
});

// ---------------------------------------------------------------------------
// B) Schedule Validity
// ---------------------------------------------------------------------------

describe("plan-generator: schedule validity", () => {
  it("no overlapping plan items within a day (blocks are sequential)", () => {
    const blocks = generatePlan(defaultInput());
    // Group by day, check that blocks placed sequentially don't exceed availability
    const byDay: Record<number, PlanBlock[]> = {};
    for (const b of blocks) {
      (byDay[b.dayIndex] = byDay[b.dayIndex] || []).push(b);
    }
    for (const [dayStr, dayBlocks] of Object.entries(byDay)) {
      const totalMinutes = dayBlocks.reduce((s, b) => s + b.plannedMinutes, 0);
      const avail = defaultAvailability[Number(dayStr)];
      const [sh, sm] = avail.start.split(":").map(Number);
      const [eh, em] = avail.end.split(":").map(Number);
      const windowMinutes = (eh * 60 + em) - (sh * 60 + sm);
      expect(
        totalMinutes,
        `Day ${dayStr}: total ${totalMinutes} exceeds window ${windowMinutes}`
      ).toBeLessThanOrEqual(windowMinutes);
    }
  });

  it("daily total minutes <= daily cap", () => {
    const cap = 90;
    const blocks = generatePlan(defaultInput({ dailyCap: cap }));
    const totals = dayTotals(blocks);
    for (const [day, total] of Object.entries(totals)) {
      expect(total, `Day ${day}: total ${total} exceeds cap ${cap}`).toBeLessThanOrEqual(cap);
    }
  });

  it("daily total minutes <= daily cap (small cap)", () => {
    const cap = 45;
    const blocks = generatePlan(defaultInput({ dailyCap: cap }));
    const totals = dayTotals(blocks);
    for (const [day, total] of Object.entries(totals)) {
      expect(total, `Day ${day}: total ${total} exceeds cap ${cap}`).toBeLessThanOrEqual(cap);
    }
  });

  it("all sessions fit within availability windows (short window)", () => {
    const shortAvail = Array.from({ length: 7 }, () => ({
      start: "14:00",
      end: "15:30", // 90 min window
    }));
    const blocks = generatePlan(
      defaultInput({ availability: shortAvail, dailyCap: 300 })
    );
    const totals = dayTotals(blocks);
    for (const [day, total] of Object.entries(totals)) {
      expect(total, `Day ${day}: total ${total} exceeds 90-min window`).toBeLessThanOrEqual(90);
    }
  });

  it("all sessions fit within availability windows (varying per day)", () => {
    const mixedAvail = [
      { start: "08:00", end: "10:00" }, // 120
      { start: "13:00", end: "14:00" }, // 60
      { start: "09:00", end: "12:00" }, // 180
      { start: "16:00", end: "17:00" }, // 60
      { start: "10:00", end: "13:00" }, // 180
      { start: "09:00", end: "11:00" }, // 120
      { start: "14:00", end: "16:00" }, // 120
    ];
    const windowMins = [120, 60, 180, 60, 180, 120, 120];
    const blocks = generatePlan(
      defaultInput({ availability: mixedAvail, dailyCap: 300 })
    );
    const totals = dayTotals(blocks);
    for (const [day, total] of Object.entries(totals)) {
      const w = windowMins[Number(day)];
      expect(total, `Day ${day}: total ${total} exceeds window ${w}`).toBeLessThanOrEqual(w);
    }
  });

  it("every block has plannedMinutes >= 15", () => {
    const blocks = generatePlan(defaultInput());
    for (const b of blocks) {
      expect(b.plannedMinutes).toBeGreaterThanOrEqual(15);
    }
  });

  it("skips days with < 15 remaining availability", () => {
    const tinyAvail = Array.from({ length: 7 }, (_, i) => ({
      start: "09:00",
      end: i === 5 ? "09:10" : "17:00",
    }));
    const blocks = generatePlan(defaultInput({ availability: tinyAvail }));
    const day5 = blocks.filter((b) => b.dayIndex === 5);
    // 10 min window < 15 min minimum → nothing should be scheduled
    expect(day5.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// C) Determinism
// ---------------------------------------------------------------------------

describe("plan-generator: determinism", () => {
  it("produces identical output for same input", () => {
    const input = defaultInput();
    const run1 = generatePlan(input);
    const run2 = generatePlan(input);
    expect(run1).toEqual(run2);
  });

  it("produces identical output regardless of repeated calls", () => {
    const input = defaultInput({ objectives: makeObjectives(20) });
    const runs = Array.from({ length: 5 }, () => generatePlan(input));
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i]).toEqual(runs[0]);
    }
  });
});

// ---------------------------------------------------------------------------
// C2) Stable objective ids
// ---------------------------------------------------------------------------

describe("plan-generator: stable objective ids", () => {
  it("slugifies titles: lowercase, non-alphanumeric runs to single underscore, trimmed", () => {
    expect(slugifyObjectiveTitle("Photosynthesis: Light Reactions!")).toBe(
      "photosynthesis_light_reactions",
    );
    expect(slugifyObjectiveTitle("  --Weird   spacing--  ")).toBe("weird_spacing");
    expect(slugifyObjectiveTitle("Objective 1")).toBe("objective_1");
  });

  it("caps slugs at 60 chars without a trailing underscore", () => {
    const long = "A ".repeat(80); // slugs to a_a_a_... far beyond 60
    const slug = slugifyObjectiveTitle(long);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith("_")).toBe(false);
  });

  it("falls back to a non-empty id for titles with no alphanumerics", () => {
    expect(slugifyObjectiveTitle("!!!")).toBe("objective");
  });

  it("disambiguates colliding slugs deterministically in first-seen order", () => {
    const map = buildObjectiveIdMap(["Loops!", "Loops?", "Loops."]);
    expect(map.get("Loops!")).toBe("loops");
    expect(map.get("Loops?")).toBe("loops_2");
    expect(map.get("Loops.")).toBe("loops_3");
  });

  it("gives the same objective the same id in every block it appears in", () => {
    // 10 objectives → packs split; interleaved and full-scope blocks would
    // previously remint per-block obj_N ids that collided across blocks.
    const blocks = generatePlan(defaultInput({ objectives: makeObjectives(10) }));
    const idByTitle = new Map<string, string>();
    const titleById = new Map<string, string>();
    for (const b of blocks) {
      for (const o of b.objectives) {
        const priorId = idByTitle.get(o.title);
        expect(priorId ?? o.id, `"${o.title}" changed id across blocks`).toBe(o.id);
        idByTitle.set(o.title, o.id);
        const priorTitle = titleById.get(o.id);
        expect(priorTitle ?? o.title, `id "${o.id}" reused for a different title`).toBe(o.title);
        titleById.set(o.id, o.title);
      }
    }
    // Ids derive from titles, not positions
    expect(idByTitle.get("Objective 1")).toBe("objective_1");
    expect(idByTitle.get("Objective 10")).toBe("objective_10");
  });
});

// ---------------------------------------------------------------------------
// D) Edge cases
// ---------------------------------------------------------------------------

describe("plan-generator: edge cases", () => {
  it("handles minimum objectives (3)", () => {
    const blocks = generatePlan(defaultInput({ objectives: makeObjectives(3) }));
    expect(blocks.length).toBeGreaterThanOrEqual(5);
    const modes = blocks.map((b) => b.mode);
    expect(modes).toContain("RETRIEVAL");
    expect(modes).toContain("EXAM_SIM");
    expect(modes).toContain("ERROR_REPAIR");
  });

  it("handles large objective lists (30+)", () => {
    const blocks = generatePlan(defaultInput({ objectives: makeObjectives(30) }));
    expect(blocks.length).toBeGreaterThanOrEqual(5);
    const modes = blocks.map((b) => b.mode);
    expect(modes).toContain("INTERLEAVED_PRACTICE");
    expect(modes).toContain("EXAM_SIM");
    expect(modes).toContain("ERROR_REPAIR");
  });

  it("handles maximum daily cap (600)", () => {
    const blocks = generatePlan(defaultInput({ dailyCap: 600 }));
    const totals = dayTotals(blocks);
    for (const [, total] of Object.entries(totals)) {
      expect(total).toBeLessThanOrEqual(600);
    }
  });

  it("handles minimum daily cap (30)", () => {
    const blocks = generatePlan(defaultInput({ dailyCap: 30 }));
    const totals = dayTotals(blocks);
    for (const [, total] of Object.entries(totals)) {
      expect(total).toBeLessThanOrEqual(30);
    }
    // Should still produce some blocks
    expect(blocks.length).toBeGreaterThan(0);
  });
});
