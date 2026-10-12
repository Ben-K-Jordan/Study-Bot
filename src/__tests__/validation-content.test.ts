import { describe, it, expect } from "vitest";
import {
  uploadDocumentSchema,
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
