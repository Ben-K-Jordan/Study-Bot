import { describe, it, expect } from "vitest";
import { FILE_RULE, MAX_FILE_BYTES, fileKind, fileProblem } from "@/components/materials/file-rules";
import { errorCode, errorMessage, fieldIssues } from "@/components/plan/api-errors";
import { ApiError } from "@/lib/client-api";

describe("fileProblem", () => {
  it("accepts PDF, text and Markdown up to 10 MB, by type or extension", () => {
    expect(fileProblem({ name: "lecture.pdf", size: 1000, type: "application/pdf" })).toBeNull();
    expect(fileProblem({ name: "notes.md", size: 1000, type: "" })).toBeNull();
    expect(fileProblem({ name: "NOTES.TXT", size: 1000, type: "" })).toBeNull();
    expect(fileProblem({ name: "big.pdf", size: MAX_FILE_BYTES, type: "application/pdf" })).toBeNull();
  });

  it("names the rule for other types and larger files", () => {
    expect(fileProblem({ name: "slides.pptx", size: 1000, type: "application/vnd.ms-powerpoint" })).toBe(FILE_RULE);
    expect(fileProblem({ name: "big.pdf", size: MAX_FILE_BYTES + 1, type: "application/pdf" })).toBe(FILE_RULE);
  });

  it("refuses an empty file", () => {
    expect(fileProblem({ name: "empty.md", size: 0, type: "text/markdown" })).toMatch(/empty/);
  });

  it("names the kind of file", () => {
    expect(fileKind("a.pdf")).toBe("PDF");
    expect(fileKind("a.markdown")).toBe("Markdown");
    expect(fileKind("a.txt", "text/plain")).toBe("Text");
  });
});

describe("api errors", () => {
  it("never shows a raw code, preferring the server's sentence", () => {
    const publish = new ApiError("GOOGLE_RECONNECT_REQUIRED", 409, {
      error: "GOOGLE_RECONNECT_REQUIRED",
      code: "GOOGLE_RECONNECT_REQUIRED",
      message: "Google Calendar needs you to sign in again.",
    });
    expect(errorMessage(publish, "Not added.")).toBe("Google Calendar needs you to sign in again.");
    expect(errorCode(publish)).toBe("GOOGLE_RECONNECT_REQUIRED");

    const bare = new ApiError("not_found", 404, { error: "not_found" });
    expect(errorMessage(bare, "Plan not deleted.")).toBe("Plan not deleted.");
    expect(errorCode(bare)).toBe("not_found");
  });

  it("chooses copy by status when the server sent none", () => {
    expect(errorMessage(new ApiError("Unauthorized", 401, { error: "Unauthorized" }), "x")).toBe(
      "Your sign-in expired. Sign in again."
    );
    expect(errorMessage(new ApiError("Request failed", 503, null), "Plan not created.")).toBe(
      "Plan not created. Retry in a minute."
    );
    expect(errorMessage(new TypeError("Failed to fetch"), "Plan not created.")).toBe(
      "Plan not created. Check your connection and retry."
    );
  });

  it("maps validation issues to fields by their first path segment", () => {
    const error = new ApiError("Check the highlighted fields.", 400, {
      issues: [
        { path: ["availability"], message: "Choose an end time after the start time." },
        { path: ["availability", 2, "end"], message: "Choose an end time." },
        { path: [], message: "ignored" },
      ],
    });
    expect(fieldIssues(error)).toEqual({ availability: "Choose an end time after the start time." });
  });
});
