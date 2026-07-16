import { describe, it, expect } from "vitest";
import { buildCalendarTitle, buildCalendarDescription } from "@/lib/calendar";

describe("buildCalendarTitle", () => {
  it("formats a retrieval session title", () => {
    const title = buildCalendarTitle({
      courseName: "CS 2110",
      examName: "Prelim 1",
      mode: "RETRIEVAL",
      topicScope: "L3–L4",
    });
    expect(title).toBe("CS 2110 | Prelim 1 | Retrieval: L3–L4");
  });

  it("formats an interleaved practice title", () => {
    const title = buildCalendarTitle({
      courseName: "CHEM 2070",
      examName: "Prelim 2",
      mode: "INTERLEAVED_PRACTICE",
      topicScope: "Buffers + Titrations",
    });
    expect(title).toBe(
      "CHEM 2070 | Prelim 2 | Interleaved Practice: Buffers + Titrations"
    );
  });

  it("formats all mode labels correctly", () => {
    const modes = [
      ["ERROR_REPAIR", "Error Repair"],
      ["EXAM_SIM", "Exam Sim"],
      ["WORKED_EXAMPLES", "Worked Examples"],
    ] as const;

    for (const [mode, label] of modes) {
      const title = buildCalendarTitle({
        courseName: "TEST",
        examName: "E1",
        mode,
        topicScope: "T1",
      });
      expect(title).toBe(`TEST | E1 | ${label}: T1`);
    }
  });
});

describe("buildCalendarDescription", () => {
  it("includes outcome checkboxes", () => {
    const desc = buildCalendarDescription({
      outcome: {
        target_accuracy: 0.8,
        prompt_count: 20,
        closed_book_required: true,
        deliverables: ["error_log_entries>=5"],
      },
      sessionUrl: "http://localhost:3000/s/abc123",
    });

    expect(desc).toContain("- [ ] Score >= 80% on 20 prompts");
    expect(desc).toContain("- [ ] Complete closed-book first pass");
    expect(desc).toContain("error log_entries >= 5");
  });

  it("includes the session URL", () => {
    const desc = buildCalendarDescription({
      sessionUrl: "http://localhost:3000/s/xyz",
    });
    expect(desc).toContain("http://localhost:3000/s/xyz");
    expect(desc).toContain("**Terminal session:**");
  });

  it("includes break protocol", () => {
    const desc = buildCalendarDescription({
      breaks: { type: "50_10", cycles: 2 },
      sessionUrl: "http://localhost:3000/s/abc",
    });
    expect(desc).toContain("50 min work / 10 min break");
    expect(desc).toContain("2 cycle(s)");
  });

  it("includes resources", () => {
    const desc = buildCalendarDescription({
      sessionUrl: "http://localhost:3000/s/abc",
      resources: [
        { type: "slides", ref: "slides_week2.pdf", range: "pp. 8-22" },
      ],
    });
    expect(desc).toContain("slides: slides_week2.pdf (pp. 8-22)");
  });

  it("includes plan steps and rules", () => {
    const desc = buildCalendarDescription({
      planSteps: ["0–5 min: Setup", "5–50 min: Practice"],
      rules: ["No phone", "Closed book"],
      sessionUrl: "http://localhost:3000/s/abc",
    });
    expect(desc).toContain("**Plan (how):**");
    expect(desc).toContain("- 0–5 min: Setup");
    expect(desc).toContain("**Rules:**");
    expect(desc).toContain("- No phone");
  });
});
