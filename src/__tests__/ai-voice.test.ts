/**
 * AI text follows VOICE.md: the system prompts teach the model the app's
 * voice, the mock provider (what the demo shows) already writes in it, and
 * student-written text is capped before it reaches a prompt.
 */
import { describe, it, expect } from "vitest";
import { AiTask } from "@/lib/ai/types";
import { MAX_STUDENT_TEXT_CHARS, PROMPTS, STUDENT_VOICE, getPrompt } from "@/lib/ai/prompt-registry";
import { MockProvider } from "@/lib/ai/providers/mock";

/** Tasks whose output a student reads. SUGGEST_ERROR_TYPE returns an enum, the plan returns blocks. */
const STUDENT_FACING = [
  AiTask.ANSWER_WITH_CITATIONS,
  AiTask.GENERATE_VARIANT_QUESTION,
  AiTask.GENERATE_PROMPTS,
  AiTask.GENERATE_FEEDBACK,
  AiTask.REINFORCE_CORRECT,
  AiTask.SOCRATIC_FOLLOWUP,
  AiTask.EXTRACT_OBJECTIVES,
  AiTask.SUMMARIZE_DOCUMENT,
  AiTask.GENERATE_STUDY_GUIDE,
  AiTask.GENERATE_FLASHCARDS,
  AiTask.GENERATE_WORKED_EXAMPLES,
];

const DASH = /[–—]/;

/** Every string inside a JSON value. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

/** Sentence case: no word after the first starts with a capital, unless it is an acronym. */
function isSentenceCase(title: string): boolean {
  return title
    .split(/\s+/)
    .slice(1)
    .every((word) => !/^[A-Z][a-z]/.test(word));
}

describe("system prompts", () => {
  it.each(STUDENT_FACING)("%s carries the student voice block", (task) => {
    expect(getPrompt(task).systemPrompt).toContain(STUDENT_VOICE);
  });

  it("never casts the model as a person or uses dashes", () => {
    for (const prompt of Object.values(PROMPTS)) {
      const own = prompt.systemPrompt.replace(STUDENT_VOICE, "");
      expect(own, prompt.task).not.toMatch(/professor|office hours|\blet's\b/i);
      expect(prompt.systemPrompt, prompt.task).not.toMatch(DASH);
    }
  });

  it("asks for sentence-case topic titles", () => {
    expect(getPrompt(AiTask.EXTRACT_OBJECTIVES).systemPrompt).toMatch(/sentence case/);
  });

  it("still routes every task in the mock provider", async () => {
    const provider = new MockProvider();
    const answer = await provider.completeJson(getPrompt(AiTask.ANSWER_WITH_CITATIONS).systemPrompt, "q", "m");
    expect(answer.json).toHaveProperty("answer_markdown");
    const feedback = await provider.completeJson(getPrompt(AiTask.GENERATE_FEEDBACK).systemPrompt, "q", "m");
    expect(feedback.json).toHaveProperty("explanation");
    const objectives = await provider.completeJson(getPrompt(AiTask.EXTRACT_OBJECTIVES).systemPrompt, "q", "m");
    expect(objectives.json).toHaveProperty("objectives");
    const cards = await provider.completeJson(getPrompt(AiTask.GENERATE_FLASHCARDS).systemPrompt, "q", "m");
    expect(cards.json).toHaveProperty("cards");
  });
});

describe("student text in prompts", () => {
  const huge = "a".repeat(MAX_STUDENT_TEXT_CHARS * 3);

  it("caps the fenced answer and correction in feedback prompts", () => {
    const prompt = getPrompt(AiTask.GENERATE_FEEDBACK).buildUserPrompt({
      question: "Q",
      userAnswer: huge,
      selfScore: "INCORRECT",
      correctionRule: huge,
      chunks: [],
    });
    expect(prompt.length).toBeLessThan(MAX_STUDENT_TEXT_CHARS * 2 + 1_000);
  });

  it.each([AiTask.SUGGEST_ERROR_TYPE, AiTask.REINFORCE_CORRECT, AiTask.SOCRATIC_FOLLOWUP])(
    "caps the fenced answer in %s",
    (task) => {
      const prompt = getPrompt(task).buildUserPrompt({
        question: "Q",
        userAnswer: huge,
        correctConcept: "C",
        selfScore: "CORRECT",
        chunks: [],
      });
      expect(prompt.length).toBeLessThan(MAX_STUDENT_TEXT_CHARS + 1_000);
    },
  );
});

describe("mock provider text", () => {
  const provider = new MockProvider();
  const run = async (task: AiTask, userPrompt = "Course: CS 2110 | Exam: Prelim 1") =>
    (await provider.completeJson(getPrompt(task).systemPrompt, userPrompt, "m")).json;

  it("has no dashes, three-dot ellipses or exclamation marks", async () => {
    const outputs = await Promise.all([
      ...STUDENT_FACING.map((task) => run(task)),
      run(AiTask.GENERATE_STUDY_GUIDE, "Course: CS 2110\nGuide type: FAQ\nGenerate the faq study guide."),
      run(AiTask.GENERATE_STUDY_GUIDE, "Course: CS 2110\nGuide type: CHEAT_SHEET\nGenerate the cheat sheet study guide."),
    ]);
    for (const text of outputs.flatMap(strings)) {
      expect(text).not.toMatch(DASH);
      expect(text).not.toContain("...");
      expect(text).not.toContain("!");
    }
  });

  it("writes topic titles in sentence case", async () => {
    const { objectives } = (await run(AiTask.EXTRACT_OBJECTIVES)) as { objectives: { title: string }[] };
    for (const { title } of objectives) expect(isSentenceCase(title), title).toBe(true);
  });

  it("writes guide titles and headings in sentence case", async () => {
    const guides = await Promise.all(
      ["KEY_CONCEPTS", "FAQ", "CHEAT_SHEET"].map((type) =>
        run(
          AiTask.GENERATE_STUDY_GUIDE,
          `Course: CS 2110\nGuide type: ${type}\nGenerate the ${type.replace(/_/g, " ").toLowerCase()} study guide.`,
        ),
      ),
    );
    const titles = guides.map((g) => (g as { title: string }).title);
    expect(titles).toEqual(["Key concepts for CS 2110", "FAQ for CS 2110", "Cheat sheet for CS 2110"]);
    for (const guide of guides) {
      const { sections } = guide as { sections: { concept?: string; topic?: string }[] };
      for (const heading of sections.map((s) => s.concept ?? s.topic).filter(Boolean) as string[]) {
        expect(isSentenceCase(heading), heading).toBe(true);
      }
    }
  });
});
