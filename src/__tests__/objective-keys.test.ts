/**
 * Topic keys: one slug rule and one way back to a readable title, shared by
 * the plan generator, Home and Progress, sessions and recommendations.
 */
import { describe, expect, it } from "vitest";

import { humanizeObjectiveKey, slugifyObjectiveTitle } from "@/lib/objective-keys";
import { slugifyObjectiveTitle as planGeneratorSlug } from "@/lib/plan-generator";

describe("slugifyObjectiveTitle", () => {
  it("derives keys exactly like the plan generator", () => {
    const long = "A very long objective title that goes well past the sixty character limit for keys";
    for (const title of ["CSS specificity", "Responsive images and srcset", "ref and reactive", "  Big-O!  ", "!!!", long]) {
      expect(slugifyObjectiveTitle(title)).toBe(planGeneratorSlug(title));
    }
  });

  it("lowercases, joins words with underscores and falls back to a fixed key", () => {
    expect(slugifyObjectiveTitle("Photosynthesis: Light Reactions!")).toBe("photosynthesis_light_reactions");
    expect(slugifyObjectiveTitle("  --Weird   spacing--  ")).toBe("weird_spacing");
    expect(slugifyObjectiveTitle("!!!")).toBe("objective");
  });
});

describe("humanizeObjectiveKey", () => {
  it("reads a slug back in sentence case", () => {
    expect(humanizeObjectiveKey("photosynthesis_light_reactions")).toBe("Photosynthesis light reactions");
    expect(humanizeObjectiveKey("grid_template_areas")).toBe("Grid template areas");
    expect(humanizeObjectiveKey("big-o")).toBe("Big o");
  });

  it("splits camelCase and keeps words written in capitals", () => {
    expect(humanizeObjectiveKey("bigO-notation")).toBe("Big O notation");
    expect(humanizeObjectiveKey("CSS_specificity")).toBe("CSS specificity");
    expect(humanizeObjectiveKey("HTMLParser_basics")).toBe("HTML parser basics");
    expect(humanizeObjectiveKey("Photosynthesis_Light_Reactions")).toBe("Photosynthesis light reactions");
  });

  it("names a key with no words", () => {
    expect(humanizeObjectiveKey("__")).toBe("Untitled topic");
    expect(humanizeObjectiveKey("")).toBe("Untitled topic");
  });

  it("round-trips a slug from a title", () => {
    expect(humanizeObjectiveKey(slugifyObjectiveTitle("Dynamic programming"))).toBe("Dynamic programming");
  });
});
