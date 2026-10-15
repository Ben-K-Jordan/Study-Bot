import { describe, expect, it } from "vitest";
import {
  guideFileName,
  guideTitle,
  guideToMarkdown,
  guideTypeFromSlug,
  normalizeGuideSections,
  toGuideText,
} from "@/components/guides/guide-format";

describe("toGuideText", () => {
  it("keeps strings and stringifies scalars", () => {
    expect(toGuideText("  a  ")).toBe("a");
    expect(toGuideText(3)).toBe("3");
    expect(toGuideText(null)).toBe("");
  });

  it("turns a list into Markdown bullets", () => {
    expect(toGuideText(["First", "Second"])).toBe("- First\n- Second");
  });

  it("turns rows of cells into a Markdown table", () => {
    expect(
      toGuideText([
        ["Term", "Meaning"],
        ["ID", "(1,0,0)"],
        ["a|b", "pipe"],
      ]),
    ).toBe("| Term | Meaning |\n| --- | --- |\n| ID | (1,0,0) |\n| a\\|b | pipe |");
  });

  it("turns an object into key: value lines", () => {
    expect(toGuideText({ formula: "E = mc^2", note: ["one", "two"] })).toBe(
      "formula: E = mc^2\nnote:\n- one\n- two",
    );
  });
});

describe("normalizeGuideSections", () => {
  it("never returns non-string fields, whatever the stored shape", () => {
    const sections = normalizeGuideSections([
      { topic: "Box model", content: ["content-box", "border-box"] },
      { concept: "Specificity", explanation: { ids: 1, classes: 2 }, importance: 7 },
      "A loose paragraph",
      null,
      42,
      { unknown: "dropped" },
    ]);
    expect(sections).toEqual([
      { topic: "Box model", content: "- content-box\n- border-box" },
      { concept: "Specificity", explanation: "ids: 1\nclasses: 2", importance: "7" },
      { content: "A loose paragraph" },
    ]);
    for (const s of sections) {
      for (const value of Object.values(s)) expect(typeof value).toBe("string");
    }
  });

  it("accepts an object wrapper or an object of sections", () => {
    expect(normalizeGuideSections({ sections: [{ question: "Q", answer: "A" }] })).toEqual([
      { question: "Q", answer: "A" },
    ]);
    expect(normalizeGuideSections({ a: { topic: "T", content: "C" } })).toEqual([{ topic: "T", content: "C" }]);
    expect(normalizeGuideSections(undefined)).toEqual([]);
    expect(normalizeGuideSections("text")).toEqual([]);
  });
});

describe("guide titles and files", () => {
  it("replaces the old enum fallback titles", () => {
    expect(guideTitle("KEY CONCEPTS Guide", "KEY_CONCEPTS", "Prelim 2")).toBe("Key concepts for Prelim 2");
    expect(guideTitle("", "CHEAT_SHEET", "INFO 1300")).toBe("Cheat sheet for INFO 1300");
    expect(guideTitle("Prelim 2 cheat sheet", "CHEAT_SHEET", "x")).toBe("Prelim 2 cheat sheet");
  });

  it("slugs the file name and never returns a bare .md", () => {
    expect(guideFileName("Prelim 2 cheat sheet")).toBe("prelim-2-cheat-sheet.md");
    expect(guideFileName("Big-O: the basics!")).toBe("bigo-the-basics.md");
    expect(guideFileName("¿?")).toBe("study-guide.md");
  });

  it("reads format slugs from the URL", () => {
    expect(guideTypeFromSlug("cheat-sheet")).toBe("CHEAT_SHEET");
    expect(guideTypeFromSlug("FAQ")).toBe("FAQ");
    expect(guideTypeFromSlug("nope")).toBeNull();
    expect(guideTypeFromSlug(null)).toBeNull();
  });
});

describe("guideToMarkdown", () => {
  it("keeps the export layout", () => {
    expect(
      guideToMarkdown({
        title: "Prelim 2 key concepts",
        sections: [
          { concept: "Specificity", explanation: "IDs beat classes.", importance: "Most cascade questions." },
          { question: "Why?", answer: "Because." },
          { topic: "Box model", content: "content-box\nborder-box" },
        ],
      }),
    ).toBe(
      "# Prelim 2 key concepts\n\n" +
        "## Specificity\nIDs beat classes.\n_Why it matters: Most cascade questions._" +
        "\n\n---\n\n" +
        "**Q: Why?**\nBecause." +
        "\n\n---\n\n" +
        "## Box model\ncontent-box\nborder-box",
    );
  });
});
