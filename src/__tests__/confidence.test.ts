import { describe, it, expect } from "vitest";
import { CONFIDENCE_SCALE, confidenceLabel, confidenceLevel, isSureRating } from "@/lib/confidence";

/** One confidence scale for every screen: Guessing, Unsure, Sure, stored as 1, 3 and 5. */
describe("confidence scale", () => {
  it("stores Guessing, Unsure and Sure as 1, 3 and 5, in picker order", () => {
    expect(CONFIDENCE_SCALE.map((entry) => [entry.value, entry.label])).toEqual([
      [1, "Guessing"],
      [3, "Unsure"],
      [5, "Sure"],
    ]);
    for (const entry of CONFIDENCE_SCALE) expect(confidenceLevel(entry.value)).toBe(entry.level);
  });

  // The old five steps were Guessing, Unsure, Somewhat, Confident and Very sure.
  it("reads the older five-step ratings by what they meant", () => {
    expect(confidenceLevel(2)).toBe("unsure");
    expect(confidenceLevel(4)).toBe("sure");
    expect(isSureRating(4)).toBe(true);
    expect(isSureRating(3)).toBe(false);
  });

  it("treats missing and out-of-range ratings as not rated", () => {
    for (const rating of [null, undefined, 0, 6, Number.NaN]) {
      expect(confidenceLevel(rating)).toBeNull();
      expect(isSureRating(rating)).toBe(false);
    }
  });

  it("labels each level", () => {
    expect(confidenceLabel("guessing")).toBe("Guessing");
    expect(confidenceLabel("unsure")).toBe("Unsure");
    expect(confidenceLabel("sure")).toBe("Sure");
  });
});
