/**
 * Adding a saved question and answer to a course's chat history cache, and
 * fetching the history again when it hasn't loaded (so an answer received
 * while it was loading, or after it failed, still shows).
 */
import { describe, it, expect, vi } from "vitest";
import { unstable_serialize } from "swr/infinite";

import { appendToHistory, appendToPages, historyKey } from "@/components/chat/use-chat-history";
import type { ChatMessage, HistoryPage } from "@/components/chat/chat-types";

function message(id: string, role: "user" | "assistant"): ChatMessage {
  return {
    id,
    role,
    kind: role === "user" ? "question" : "answer",
    content: `${role} ${id}`,
    sources: [],
    createdAt: "2026-10-15T12:00:00.000Z",
  } as unknown as ChatMessage;
}

const page = (ids: string[], total = ids.length): HistoryPage =>
  ({ messages: ids.map((id) => message(id, "user")), has_more: false, total }) as HistoryPage;

describe("appendToPages", () => {
  it("adds new messages to the end of the newest page and counts them", () => {
    const pages = [page(["a", "b"], 5), page(["older"])];
    const next = appendToPages(pages, [message("b", "user"), message("c", "assistant")]);
    expect(next?.[0].messages.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(next?.[0].total).toBe(6);
    expect(next?.[1]).toBe(pages[1]);
  });

  it("leaves a history that hasn't loaded as it is", () => {
    expect(appendToPages(undefined, [message("c", "user")])).toBeUndefined();
  });
});

describe("appendToHistory", () => {
  it("updates the course's history without a fetch when it's loaded", () => {
    const mutate = vi.fn();
    appendToHistory(mutate as never, "CS 2110||Prelim 1", [message("q", "user"), message("a", "assistant")]);

    expect(mutate).toHaveBeenCalledTimes(1);
    const [key, update, options] = mutate.mock.calls[0];
    expect(key).toBe(unstable_serialize(historyKey("CS 2110||Prelim 1")));
    const updated = update([page(["x"])]) as HistoryPage[];
    expect(updated[0].messages.map((m) => m.id)).toEqual(["x", "q", "a"]);
    expect(options.revalidate(updated)).toBe(false);
  });

  it("fetches the history again when it's still loading or failed", () => {
    const mutate = vi.fn();
    appendToHistory(mutate as never, "CS 2110||Prelim 1", [message("q", "user")]);

    const [, update, options] = mutate.mock.calls[0];
    const updated = update(undefined);
    expect(updated).toBeUndefined();
    expect(options.revalidate(updated)).toBe(true);
  });

  it("does nothing with no messages", () => {
    const mutate = vi.fn();
    appendToHistory(mutate as never, "CS 2110||Prelim 1", []);
    expect(mutate).not.toHaveBeenCalled();
  });
});
