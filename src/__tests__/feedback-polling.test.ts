/**
 * Unit tests for the client-side feedback poll loop (pollFeedback).
 *
 * The live-audit bug: an empty/failed feedback generation left the review
 * panel spinning forever. The contract under test: PENDING is the ONLY
 * non-terminal status — any other result (OK with content, OK + no_sources,
 * UNAVAILABLE) resolves the poll immediately, the poll budget yields null
 * instead of spinning, and cancellation stops the loop without a result.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { pollFeedback } from "@/app/s/[sessionId]/feedback-poll";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

const notCancelled = () => false;

describe("pollFeedback terminal semantics", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("resolves on the first non-PENDING result (single fetch)", async () => {
    const payload = { status: "OK", excerpts: [], explanation: "because osmosis" };
    fetchMock.mockResolvedValue(jsonResponse(payload));

    const result = await pollFeedback("attempt-1", notCancelled, 5, 1);

    expect(result).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats the explicit no-sources state as terminal — no further polling", async () => {
    const payload = { status: "OK", excerpts: [], no_sources: true };
    fetchMock.mockResolvedValue(jsonResponse(payload));

    const result = await pollFeedback("attempt-1", notCancelled, 5, 1);

    expect(result).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats UNAVAILABLE (generation failure) as terminal", async () => {
    const payload = { status: "UNAVAILABLE", excerpts: [] };
    fetchMock.mockResolvedValue(jsonResponse(payload));

    const result = await pollFeedback("attempt-1", notCancelled, 5, 1);

    expect(result).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps polling through PENDING, then returns the terminal result", async () => {
    const terminal = { status: "OK", excerpts: [], no_sources: true };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ status: "PENDING", excerpts: [] }))
      .mockResolvedValueOnce(jsonResponse({ status: "PENDING", excerpts: [] }))
      .mockResolvedValueOnce(jsonResponse(terminal));

    const result = await pollFeedback("attempt-1", notCancelled, 5, 1);

    expect(result).toEqual(terminal);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns null (not an infinite spin) when the poll budget is exhausted", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: "PENDING", excerpts: [] }));

    const result = await pollFeedback("attempt-1", notCancelled, 3, 1);

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns null without fetching when already cancelled", async () => {
    const result = await pollFeedback("attempt-1", () => true, 5, 1);

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops mid-loop when cancellation flips during a PENDING stretch", async () => {
    let cancelled = false;
    fetchMock.mockImplementation(async () => {
      cancelled = true; // cancel after the first response comes back
      return jsonResponse({ status: "PENDING", excerpts: [] });
    });

    const result = await pollFeedback("attempt-1", () => cancelled, 5, 1);

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("propagates a fetch error so the caller can settle into a fallback", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "Internal server error" }, false));

    await expect(pollFeedback("attempt-1", notCancelled, 5, 1)).rejects.toThrow(
      "Internal server error",
    );
  });
});
