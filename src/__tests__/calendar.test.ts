import { describe, it, expect } from "vitest";
import { breaksText, buildCalendarTitle, buildCalendarDescription, sessionTopics } from "@/lib/calendar";

describe("buildCalendarTitle", () => {
  it("leads with the mode and topics, then the course and exam", () => {
    const title = buildCalendarTitle({
      courseName: "CS 2110",
      examName: "Prelim 1",
      mode: "RETRIEVAL",
      topicScope: "Recursion, Stacks",
    });
    expect(title).toBe("Retrieval: Recursion and Stacks · CS 2110 Prelim 1");
  });

  it("keeps a topic scope without commas whole", () => {
    const title = buildCalendarTitle({
      courseName: "CHEM 2070",
      examName: "Prelim 2",
      mode: "INTERLEAVED_PRACTICE",
      topicScope: "Buffers + Titrations",
    });
    expect(title).toBe("Interleaved practice: Buffers + Titrations · CHEM 2070 Prelim 2");
  });

  it("uses every mode label from VOICE.md", () => {
    const modes = [
      ["ERROR_REPAIR", "Error repair"],
      ["EXAM_SIM", "Exam simulation"],
      ["WORKED_EXAMPLES", "Worked examples"],
    ] as const;

    for (const [mode, label] of modes) {
      const title = buildCalendarTitle({ courseName: "TEST", examName: "E1", mode, topicScope: "T1" });
      expect(title).toBe(`${label}: T1 · TEST E1`);
    }
  });

  it("reads the objectives before the scope, and caps the title at 3 topics", () => {
    const title = buildCalendarTitle({
      courseName: "CS 2110",
      examName: "Prelim 1",
      mode: "INTERLEAVED_PRACTICE",
      topicScope: "ignored",
      objectives: [{ title: "Recursion" }, { title: "Stacks" }, { title: "Queues" }, { title: "Graphs" }],
    });
    expect(title).toBe("Interleaved practice: Recursion, Stacks, Queues, and 1 more · CS 2110 Prelim 1");
  });

  it("drops the topics part when there are none", () => {
    expect(buildCalendarTitle({ courseName: "CS 2110", examName: "Final", mode: "EXAM_SIM", topicScope: "" })).toBe(
      "Exam simulation · CS 2110 Final",
    );
  });
});

describe("sessionTopics", () => {
  it("reads stored objectives, strings or { title } objects", () => {
    expect(sessionTopics([{ id: "a", title: "Recursion" }, "Stacks", { id: "c" }])).toEqual(["Recursion", "Stacks"]);
  });

  it("falls back to the comma-separated scope", () => {
    expect(sessionTopics(null, "Recursion, Stacks , ")).toEqual(["Recursion", "Stacks"]);
  });

  it("drops the marker older follow-up sessions stored in their scope", () => {
    expect(sessionTopics(null, "Follow-up: Recursion, Stacks")).toEqual(["Recursion", "Stacks"]);
    expect(sessionTopics(null, "Follow-up: Follow-up: Unit tests")).toEqual(["Unit tests"]);
  });
});

describe("breaksText", () => {
  it("says nothing for a single block", () => {
    expect(breaksText({ type: "25_5", cycles: 1 })).toBeNull();
    expect(breaksText(null)).toBeNull();
  });

  it("names the blocks and the break in words", () => {
    expect(breaksText({ type: "25_5", cycles: 2 })).toBe("2 blocks of 25 min, with a 5 min break in between.");
    expect(breaksText({ type: "50_10", cycles: 3 })).toBe("3 blocks of 50 min, with a 10 min break between blocks.");
  });
});

describe("buildCalendarDescription", () => {
  const sessionUrl = "http://localhost:3000/s/abc";

  it("is plain text a new plan's event can show in any calendar", () => {
    const desc = buildCalendarDescription({
      courseName: "CS 2110",
      examName: "Prelim 1",
      mode: "RETRIEVAL",
      topics: [
        { id: "recursion", title: "Recursion" },
        { id: "stacks", title: "Stacks" },
      ],
      outcome: { prompt_count: 8, target_accuracy: 0.8, closed_book_required: true },
      // What every new plan sends: one block, so no break
      breaks: { type: "25_5", cycles: 1 },
      sessionUrl,
    });

    expect(desc).toBe(
      [
        "Retrieval session for CS 2110 Prelim 1",
        "Topics: Recursion and Stacks",
        "8 questions. Target accuracy: 80%. Answer from memory before you open your notes.",
        "",
        `Open the session: ${sessionUrl}`,
        "",
        "Added by Study Bot",
      ].join("\n"),
    );
  });

  it("never carries Markdown, raw enums, glyphs or developer labels", () => {
    const desc = buildCalendarDescription({
      courseName: "CS 2110",
      examName: "Prelim 1",
      mode: "EXAM_SIM",
      topics: ["A", "B", "C"],
      outcome: { prompt_count: 1, target_accuracy: 0.7, deliverables: ["error_log_entries>=5"] },
      breaks: { type: "25_5", cycles: 2 },
      sessionUrl,
    });
    expect(desc).not.toMatch(/\*\*|- \[ \]|>=|25_5|Terminal|cycle\(s\)|prompts?\b|Score|[—–]/);
    expect(desc).toContain("1 question. Target accuracy: 70%.");
    expect(desc).toContain("Error log entries: at least 5.");
    expect(desc).toContain("2 blocks of 25 min, with a 5 min break in between.");
  });

  it("names the first topics and counts the rest", () => {
    const topics = Array.from({ length: 8 }, (_, i) => `Topic ${i + 1}`);
    const desc = buildCalendarDescription({ topics, sessionUrl });
    expect(desc).toContain("Topics: Topic 1, Topic 2, Topic 3, Topic 4, Topic 5, Topic 6, and 2 more");
    expect(desc).not.toContain("Topic 7");
  });

  it("works with only the session link", () => {
    expect(buildCalendarDescription({ sessionUrl })).toBe(`Open the session: ${sessionUrl}\n\nAdded by Study Bot`);
  });

  it("lists steps, rules and materials as plain lines", () => {
    const desc = buildCalendarDescription({
      planSteps: ["Setup", "Practice"],
      rules: ["Notes closed"],
      resources: [{ type: "slides", ref: "slides_week2.pdf", range: "pp. 8-22" }],
      sessionUrl,
    });
    expect(desc).toContain("Steps\n- Setup\n- Practice");
    expect(desc).toContain("Rules\n- Notes closed");
    expect(desc).toContain("Materials\n- slides: slides_week2.pdf (pp. 8-22)");
  });
});
