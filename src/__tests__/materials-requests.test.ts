import { afterEach, describe, it, expect, vi } from "vitest";
import { anySignal, processUntilSettled, sleep } from "@/components/materials/requests";
import { busyDocumentIds, dedupeNoteFor, type UploadEntry } from "@/components/materials/use-material-uploads";
import { lastCalendarAction } from "@/components/plan/calendar-types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("anySignal", () => {
  it("aborts with the reason of whichever signal aborts first", () => {
    const a = new AbortController();
    const b = new AbortController();
    const signal = anySignal(a.signal, b.signal);
    expect(signal.aborted).toBe(false);
    b.abort("timeout");
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe("timeout");
  });

  it("works where AbortSignal.any is missing (Safari before 17.4, Firefox before 124)", () => {
    const original = AbortSignal.any;
    // @ts-expect-error simulate an older browser
    AbortSignal.any = undefined;
    try {
      const a = new AbortController();
      const b = new AbortController();
      const signal = anySignal(a.signal, b.signal);
      expect(signal.aborted).toBe(false);
      a.abort("left");
      expect(signal.aborted).toBe(true);
      expect(signal.reason).toBe("left");

      const done = new AbortController();
      done.abort("already");
      expect(anySignal(new AbortController().signal, done.signal).reason).toBe("already");
    } finally {
      AbortSignal.any = original;
    }
  });
});

describe("sleep", () => {
  it("rejects as soon as the signal aborts", async () => {
    const controller = new AbortController();
    const waiting = sleep(60_000, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
  });
});

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

describe("processUntilSettled", () => {
  it("checks back while another request is processing the file, without failing it", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, { status: "PROCESSING" }))
      .mockResolvedValueOnce(json(200, { status: "PROCESSED" }));
    vi.stubGlobal("fetch", fetchMock);
    const outcome = processUntilSettled("doc-1", new AbortController().signal);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(outcome).resolves.toBe("PROCESSED");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("waits out a 429 and says so", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json(429, { error: "Too many files at once." }, { "Retry-After": "2" }))
        .mockResolvedValueOnce(json(200, { status: "FAILED" }))
    );
    const onWait = vi.fn();
    const onResume = vi.fn();
    const outcome = processUntilSettled("doc-1", new AbortController().signal, { onWait, onResume });
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(outcome).resolves.toBe("FAILED");
    expect(onWait).toHaveBeenCalledWith(2);
    expect(onResume).toHaveBeenCalledTimes(1);
  });
});

describe("upload rows", () => {
  const entry = (phase: UploadEntry["phase"], documentId?: string): UploadEntry => ({
    key: `k-${phase}-${documentId}`,
    name: "lecture.pdf",
    phase,
    courseName: "CS 2110",
    documentId,
  });

  it("lists the files still uploading or processing, so their materials rows offer no second run", () => {
    const ids = busyDocumentIds([
      entry("processing", "a"),
      entry("waiting", "b"),
      entry("ready", "c"),
      entry("failed", "d"),
      entry("queued"),
    ]);
    expect([...ids].sort()).toEqual(["a", "b"]);
  });

  it("words the duplicate note by where the file already is", () => {
    expect(dedupeNoteFor("AEM 2210", "CS 2110")).toBe("Already in your AEM 2210 materials, so it stays there.");
    expect(dedupeNoteFor("cs 2110", "CS 2110")).toBe("Already in your materials.");
    expect(dedupeNoteFor(null, "CS 2110")).toBe("Already in your materials.");
  });
});

describe("lastCalendarAction", () => {
  it("reads an add when both stamps match and a removal when only the sync moved", () => {
    const at = "2026-10-15T20:00:00.000Z";
    expect(lastCalendarAction({ published_at: at, last_synced_at: at })).toBe("add");
    expect(lastCalendarAction({ published_at: at, last_synced_at: "2026-10-15T20:05:00.000Z" })).toBe("remove");
    expect(lastCalendarAction({ published_at: null, last_synced_at: null })).toBe("add");
  });
});
