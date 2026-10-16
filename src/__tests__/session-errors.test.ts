import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/client-api";
import {
  breakStateFromRejection,
  sessionErrorCopy,
  sessionErrorMessage,
  toSessionError,
} from "@/components/session/errors";

const BANNED = /Forbidden|Unauthorized|Internal server error|run_not_completed|Request failed|Wrong prompt index|[—–]|!/;

describe("sessionErrorCopy", () => {
  it("never passes the server's raw text through", () => {
    const raw = [
      new ApiError("Forbidden", 403),
      new ApiError("Unauthorized", 401),
      new ApiError("Internal server error", 500),
      new ApiError("run_not_completed", 409, { error: "run_not_completed" }),
      new ApiError("Wrong prompt index", 409, { error: "Wrong prompt index", expected: 2 }),
      new ApiError("Request failed", 502),
    ];
    for (const error of raw) {
      for (const action of ["start", "submit", "finish", "endBreak", "results", "followups"] as const) {
        expect(sessionErrorMessage(error, action)).not.toMatch(BANNED);
      }
    }
  });

  it("says what didn't happen, then the fix", () => {
    const copy = sessionErrorCopy(new ApiError("x", 500), "submit");
    expect(copy.title).toBe("Answer not saved.");
    expect(copy.description).toBe("Your answer is still here. Retry in a moment.");
  });

  it("offers sign-in when the session expired", () => {
    const copy = sessionErrorCopy(new ApiError("x", 401), "start");
    expect(copy.signIn).toBe(true);
    expect(copy.title).toBe("Your sign-in expired.");
  });

  it("explains a start that timed out", () => {
    const timeout = Object.assign(new Error("signal timed out"), { name: "TimeoutError" });
    const copy = sessionErrorCopy(timeout, "start");
    expect(copy.title).toBe("Session not started.");
    expect(copy.description).toMatch(/longer than a minute/);
  });

  it("treats a network failure as a connection problem", () => {
    const copy = sessionErrorCopy(new TypeError("Failed to fetch"), "finish");
    expect(copy.description).toBe("Your answers are saved. Check your connection and retry.");
  });

  it("asks for a reload when another tab answered the question", () => {
    const copy = sessionErrorCopy(new ApiError("x", 409, { expected: 3 }), "submit");
    expect(copy.reload).toBe(true);
    expect(copy.description).toBe("This question was answered in another tab. Reload to continue.");
  });

  it("says whose session it is on a 403 and that it is gone on a 404", () => {
    expect(sessionErrorCopy(new ApiError("x", 403), "results").description).toBe(
      "This session belongs to another account."
    );
    expect(sessionErrorCopy(new ApiError("x", 404), "results").description).toBe(
      "This session doesn't exist anymore. It may have been deleted."
    );
  });

  it("maps the follow-ups conflict to finishing first", () => {
    const copy = sessionErrorCopy(new ApiError("run_not_completed", 409), "followups");
    expect(copy.description).toBe("Finish the session before adding follow-ups.");
  });
});

describe("toSessionError", () => {
  it("keeps status, code and body with the student-facing message", () => {
    const original = new ApiError("Forbidden", 403, { error: "Forbidden", code: "forbidden" });
    const mapped = toSessionError(original, "submit");
    expect(mapped).toBeInstanceOf(ApiError);
    expect(mapped.status).toBe(403);
    expect(mapped.code).toBe("forbidden");
    expect(mapped.message).not.toMatch(/Forbidden/);
  });
});

describe("breakStateFromRejection", () => {
  const breakState = {
    on_break: true,
    work_started_at: "2026-10-15T14:00:00Z",
    break_started_at: "2026-10-15T14:25:00Z",
    current_cycle: 0,
    total_cycles: 2,
    work_duration_seconds: 1500,
    break_duration_seconds: 300,
    completed_breaks: [],
  };

  it("reads the break from the 409 body, not from the message text", () => {
    const error = new ApiError("Anything at all", 409, { error: "Anything at all", break_state: breakState });
    expect(breakStateFromRejection(error)).toEqual(breakState);
  });

  it("ignores other conflicts and other statuses", () => {
    expect(breakStateFromRejection(new ApiError("Cannot submit during break", 409, { expected: 1 }))).toBeNull();
    expect(breakStateFromRejection(new ApiError("x", 400, { break_state: breakState }))).toBeNull();
    expect(breakStateFromRejection(new Error("break"))).toBeNull();
  });
});
