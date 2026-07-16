import { describe, it, expect } from "vitest";
import {
  uploadDocumentSchema,
  searchContentSchema,
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
