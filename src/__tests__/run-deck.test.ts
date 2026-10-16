/**
 * The deck a run starts with: added questions (repairs, pretests, reviews)
 * go in front of the mode's own questions, inside the requested count.
 */
import { describe, it, expect } from "vitest";

import type { Prompt } from "@/lib/prompts";
import { assembleDeck, prependBudget } from "@/services/run";

const q = (id: string, pack?: string): Prompt => ({ id, text: id, difficulty: 1, meta: pack ? { pack } : undefined });
const base = Array.from({ length: 10 }, (_, i) => q(`base_${i}`));
const ids = (prompts: Prompt[]) => prompts.map((p) => p.id);

describe("assembleDeck", () => {
  it("returns the mode's deck unchanged when nothing is added", () => {
    const deck = assembleDeck(base, { repairs: [], pretests: [], warmups: [] }, 10);
    expect(deck.prompts).toBe(base);
    expect(deck.counts).toEqual({ pretests: 0, warmups: 0, repairs: 0 });
  });

  it("keeps the requested count: added questions replace the deck's last ones", () => {
    const deck = assembleDeck(
      base,
      { repairs: [q("repair_0", "CROSS_SESSION_REPAIR")], pretests: [q("pre_0", "PRE_TEST")], warmups: [q("warm_0", "WARMUP")] },
      10,
    );
    expect(deck.prompts).toHaveLength(10);
    expect(ids(deck.prompts).slice(0, 3)).toEqual(["pre_0", "warm_0", "repair_0"]);
    expect(ids(deck.prompts).slice(3)).toEqual(ids(base.slice(0, 7)));
    expect(deck.counts).toEqual({ pretests: 1, warmups: 1, repairs: 1 });
  });

  it("fills a tight budget with repairs first, then pretests, then reviews, but orders pretests first", () => {
    const budget = prependBudget(10);
    const repairs = Array.from({ length: budget }, (_, i) => q(`repair_${i}`, "CROSS_SESSION_REPAIR"));
    const deck = assembleDeck(
      base,
      { repairs: repairs.slice(0, budget - 1), pretests: [q("pre_0", "PRE_TEST"), q("pre_1", "PRE_TEST")], warmups: [q("warm_0", "WARMUP")] },
      10,
    );
    expect(deck.counts).toEqual({ pretests: 1, warmups: 0, repairs: budget - 1 });
    expect(deck.prompts[0].id).toBe("pre_0");
    expect(ids(deck.prompts)).not.toContain("warm_0");
  });

  it("keeps at least one of the mode's own questions, and adds nothing to a one-question session", () => {
    const pretests = [q("pre_0", "PRE_TEST"), q("pre_1", "PRE_TEST")];
    const two = assembleDeck(base, { repairs: [], pretests, warmups: [] }, 2);
    expect(ids(two.prompts)).toEqual(["pre_0", "base_0"]);
    expect(assembleDeck(base, { repairs: [], pretests, warmups: [] }, 1).prompts).toBe(base);
  });
});
