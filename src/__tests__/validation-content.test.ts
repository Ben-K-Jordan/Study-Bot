import { describe, it, expect } from "vitest";
import {
  uploadDocumentSchema,
  searchContentSchema,
  createPracticeSetSchema,
  importQuestionsSchema,
  createEvidencePaperSchema,
  createEvidenceCardSchema,
} from "@/lib/validation-content";

describe("uploadDocumentSchema", () => {
  it("accepts valid COURSE upload", () => {
    const result = uploadDocumentSchema.safeParse({
      namespace: "COURSE",
      course_name: "CS 101",
    });
    expect(result.success).toBe(true);
  });

  it("rejects COURSE without course_name", () => {
    const result = uploadDocumentSchema.safeParse({
      namespace: "COURSE",
    });
    expect(result.success).toBe(false);
  });

  it("accepts RESEARCH without course_name", () => {
    const result = uploadDocumentSchema.safeParse({
      namespace: "RESEARCH",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid namespace", () => {
    const result = uploadDocumentSchema.safeParse({
      namespace: "INVALID",
    });
    expect(result.success).toBe(false);
  });
});

describe("searchContentSchema", () => {
  it("accepts valid search", () => {
    const result = searchContentSchema.safeParse({
      q: "loop invariant",
      namespace: "COURSE",
      top_k: 3,
    });
    expect(result.success).toBe(true);
  });

  it("defaults top_k to 5", () => {
    const result = searchContentSchema.parse({
      q: "test",
      namespace: "COURSE",
    });
    expect(result.top_k).toBe(5);
  });

  it("rejects empty query", () => {
    const result = searchContentSchema.safeParse({
      q: "",
      namespace: "COURSE",
    });
    expect(result.success).toBe(false);
  });

  it("rejects top_k > 10", () => {
    const result = searchContentSchema.safeParse({
      q: "test",
      namespace: "COURSE",
      top_k: 20,
    });
    expect(result.success).toBe(false);
  });
});

describe("createPracticeSetSchema", () => {
  it("accepts valid input", () => {
    const result = createPracticeSetSchema.safeParse({
      course_name: "CS 101",
      title: "Midterm Prep",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty title", () => {
    const result = createPracticeSetSchema.safeParse({
      course_name: "CS 101",
      title: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("importQuestionsSchema", () => {
  it("accepts valid question array", () => {
    const result = importQuestionsSchema.safeParse({
      questions: [
        { kind: "SHORT_ANSWER", prompt_text: "What is X?" },
        { kind: "MCQ", prompt_text: "Choose A/B/C", answer_key: "A" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty questions array", () => {
    const result = importQuestionsSchema.safeParse({
      questions: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid kind", () => {
    const result = importQuestionsSchema.safeParse({
      questions: [{ kind: "ESSAY", prompt_text: "Write about X" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("createEvidencePaperSchema", () => {
  it("accepts valid paper", () => {
    const result = createEvidencePaperSchema.safeParse({
      title: "Testing Effect",
      document_id: "doc_123",
      tags: ["retrieval_practice"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing document_id", () => {
    const result = createEvidencePaperSchema.safeParse({
      title: "Paper",
    });
    expect(result.success).toBe(false);
  });
});

describe("createEvidenceCardSchema", () => {
  it("accepts valid card", () => {
    const result = createEvidenceCardSchema.safeParse({
      claim: "Testing enhances learning",
      recommendation: "Use retrieval practice",
      strength: "STRONG",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid strength", () => {
    const result = createEvidenceCardSchema.safeParse({
      claim: "X",
      recommendation: "Y",
      strength: "VERY_STRONG",
    });
    expect(result.success).toBe(false);
  });
});
