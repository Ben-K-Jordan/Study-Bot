import { describe, it, expect } from "vitest";
import { objectiveTitles, sessionHeading, topicListText } from "@/components/session/session-heading";

/**
 * The intro and results headings name a session's topics the way the Topics
 * row, Home and Plan do (one Intl list), and keep any wording that isn't the
 * plan's plain comma join.
 */
describe("sessionHeading", () => {
  it("rebuilds a plan's comma-joined scope as an Intl list", () => {
    expect(sessionHeading("Retrieval", "CSS specificity, The box model", ["CSS specificity", "The box model"])).toEqual({
      text: "Retrieval: CSS specificity and The box model",
      namesAllTopics: true,
    });
    expect(
      sessionHeading("Interleaved practice", "Recursion, Stacks, Big-O, Queues", ["Recursion", "Stacks", "Big-O", "Queues"])
        .text
    ).toBe("Interleaved practice: Recursion, Stacks, Big-O, and Queues");
  });

  it("names the first three of a long list and counts the rest", () => {
    const topics = [
      "CSS specificity",
      "The box model",
      "Flexbox alignment",
      "Grid template areas",
      "Responsive images and srcset",
      "Media queries",
    ];
    expect(sessionHeading("Exam simulation", topics.join(", "), topics)).toEqual({
      text: "Exam simulation: CSS specificity, The box model, Flexbox alignment, and 3 more",
      namesAllTopics: false,
    });
  });

  it("keeps a scope that isn't the plain join of the topics", () => {
    expect(sessionHeading("Error repair", "Unresolved errors", [])).toEqual({
      text: "Error repair: Unresolved errors",
      namesAllTopics: false,
    });
    expect(sessionHeading("Interleaved practice", "Recursion and stacks", ["Recursion", "Stacks"]).text).toBe(
      "Interleaved practice: Recursion and stacks"
    );
    // A scope the server already wrote as a list stays as written.
    expect(sessionHeading("Retrieval", "A, B, and C", ["A", "B", "C"]).text).toBe("Retrieval: A, B, and C");
  });

  it("reads an older follow-up's scope without its Follow-up marker", () => {
    expect(sessionHeading("Retrieval", "Follow-up: Recursion, Stacks", ["Recursion", "Stacks"]).text).toBe(
      "Retrieval: Recursion and Stacks"
    );
    expect(sessionHeading("Retrieval", "Follow-up: Follow-up: Unit tests", []).text).toBe("Retrieval: Unit tests");
  });

  it("names one topic as it is", () => {
    expect(sessionHeading("Retrieval", "End-to-end testing", ["End-to-end testing"])).toEqual({
      text: "Retrieval: End-to-end testing",
      namesAllTopics: true,
    });
  });
});

describe("topicListText", () => {
  it("names one topic past the cap instead of counting it", () => {
    expect(topicListText(["A", "B", "C", "D"])).toBe("A, B, C, and D");
    expect(topicListText(["A", "B", "C", "D", "E"])).toBe("A, B, C, and 2 more");
  });
});

describe("objectiveTitles", () => {
  it("keeps the non-empty titles, trimmed", () => {
    expect(objectiveTitles([{ title: " Recursion " }, { title: "" }, { title: "Stacks" }])).toEqual(["Recursion", "Stacks"]);
    expect(objectiveTitles(null)).toEqual([]);
  });
});
