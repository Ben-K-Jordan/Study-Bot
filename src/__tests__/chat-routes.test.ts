/**
 * Chat history paging (newest first, limit and before honoured) and the
 * answer route storing a question once, retries included.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  getUserId: vi.fn(async (request: Request) => request.headers.get("x-user-id")),
}));

vi.mock("@/lib/rate-limit", () => ({
  chatLimiter: { check: () => ({ allowed: true, retryAfterMs: 0 }) },
  aiLimiter: { check: () => ({ allowed: true, retryAfterMs: 0 }) },
}));

interface Row {
  id: string;
  userId: string;
  courseKey: string;
  role: string;
  content: string;
  citations: unknown;
  createdAt: Date;
}

const rows: Row[] = [];

vi.mock("@/lib/db", () => {
  const matches = (row: Row, where: Record<string, unknown>): boolean => {
    for (const [key, value] of Object.entries(where)) {
      if (key === "OR") {
        if (!(value as Record<string, unknown>[]).some((w) => matches(row, w))) return false;
        continue;
      }
      const field = row[key as keyof Row];
      if (value && typeof value === "object" && !(value instanceof Date)) {
        const ops = value as { lt?: unknown };
        if (ops.lt !== undefined) {
          if (field instanceof Date) {
            if (!(field.getTime() < (ops.lt as Date).getTime())) return false;
          } else if (!(String(field) < String(ops.lt))) return false;
        }
        continue;
      }
      if (value instanceof Date) {
        if ((field as Date).getTime() !== value.getTime()) return false;
        continue;
      }
      if (field !== value) return false;
    }
    return true;
  };
  return {
    prisma: {
      chatMessage: {
        findMany: vi.fn(async ({ where, take }: { where: Record<string, unknown>; take: number }) =>
          rows
            .filter((r) => matches(r, where))
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
            .slice(0, take),
        ),
        findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.find((r) => matches(r, where)) ?? null),
        count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => matches(r, where)).length),
        create: vi.fn(async ({ data }: { data: Omit<Row, "id" | "createdAt"> }) => {
          const row = { ...data, citations: data.citations ?? null, id: `m${rows.length + 100}`, createdAt: new Date(Date.now() + rows.length) };
          rows.push(row);
          return row;
        }),
      },
      contentChunk: { findMany: vi.fn(async () => []) },
      contentDocument: { count: vi.fn(async () => 1) },
    },
  };
});

const hybridSearch = vi.fn();
vi.mock("@/lib/search", () => ({ hybridSearch: (...args: unknown[]) => hybridSearch(...args) }));

const runTask = vi.fn();
const embed = vi.fn(async () => ({ embeddings: [[0.1]] }));
vi.mock("@/lib/ai/gateway", () => {
  class GatewayError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly retryable: boolean,
    ) {
      super(message);
    }
  }
  return {
    GatewayError,
    runTask: (...args: unknown[]) => runTask(...args),
    embed: (...args: unknown[]) => embed(...(args as [])),
  };
});
vi.mock("@/lib/ai/provider-factory", () => ({ createProvider: () => ({}) }));

import { GET } from "@/app/api/chat/messages/route";
import { POST as ANSWER } from "@/app/api/assistant/answer/route";
import { GatewayError } from "@/lib/ai/gateway";

function seed(count: number) {
  rows.length = 0;
  for (let i = 0; i < count; i++) {
    rows.push({
      id: `m${String(i).padStart(3, "0")}`,
      userId: "u1",
      courseKey: "INFO 1300||Prelim 2",
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message ${i}`,
      citations: null,
      createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)),
    });
  }
}

function get(query: string) {
  return GET(
    Object.assign(new Request(`http://localhost/api/chat/messages?${query}`, { headers: { "x-user-id": "u1" } }), {
      nextUrl: new URL(`http://localhost/api/chat/messages?${query}`),
    }) as unknown as NextRequest,
  );
}

function answer(body: unknown) {
  return ANSWER(
    new Request("http://localhost/api/assistant/answer", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": "u1" },
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
  );
}

const KEY = encodeURIComponent("INFO 1300||Prelim 2");

describe("GET /api/chat/messages", () => {
  beforeEach(() => seed(120));

  it("returns the newest page, oldest first, with has_more and the total", async () => {
    const json = await (await get(`courseKey=${KEY}&limit=50`)).json();
    expect(json.messages).toHaveLength(50);
    expect(json.messages[0].content).toBe("message 70");
    expect(json.messages[49].content).toBe("message 119");
    expect(json.has_more).toBe(true);
    expect(json.total).toBe(120);
  });

  it("pages back with before and stops at the oldest", async () => {
    const second = await (await get(`courseKey=${KEY}&limit=50&before=m070`)).json();
    expect(second.messages[0].content).toBe("message 20");
    expect(second.messages[49].content).toBe("message 69");
    expect(second.has_more).toBe(true);

    const third = await (await get(`courseKey=${KEY}&limit=50&before=m020`)).json();
    expect(third.messages.map((m: { content: string }) => m.content)).toEqual(
      Array.from({ length: 20 }, (_, i) => `message ${i}`),
    );
    expect(third.has_more).toBe(false);
  });

  it("labels questions and answers, and rejects a bad limit", async () => {
    const json = await (await get(`courseKey=${KEY}&limit=2`)).json();
    expect(json.messages.map((m: { kind: string }) => m.kind)).toEqual(["question", "answer"]);
    expect((await get(`courseKey=${KEY}&limit=500`)).status).toBe(400);
  });
});

describe("POST /api/assistant/answer with save", () => {
  beforeEach(() => {
    rows.length = 0;
    hybridSearch.mockReset();
    runTask.mockReset();
    embed.mockClear();
    hybridSearch.mockResolvedValue([
      { chunk_id: "c1", doc_id: "d1", doc_title: "Lecture 14", page_number: 3, rank_score: 1, snippet: "Compare the columns left to right." },
    ]);
  });

  it("stores the question before answering and keeps it when the answer fails", async () => {
    runTask.mockRejectedValueOnce(new GatewayError("PROVIDER_ERROR", "boom", true));

    const failed = await answer({ question: "Why?", course_name: "INFO 1300", exam_name: "Prelim 2", save: true });
    const failedJson = await failed.json();

    expect(failed.status).toBe(502);
    expect(failedJson.question.id).toBeTruthy();
    expect(failedJson.error).not.toMatch(/boom/);
    expect(rows.filter((r) => r.role === "user")).toHaveLength(1);

    runTask.mockResolvedValueOnce({
      output: { answer_markdown: "Columns decide [1].", citations: [{ chunk_id: "c1", reason: "r", quote_snippet: "Compare the columns" }] },
      meta: { cacheHit: false, latencyMs: 5 },
    });
    const retried = await (
      await answer({ question: "Why?", course_name: "INFO 1300", exam_name: "Prelim 2", save: true, question_id: failedJson.question.id })
    ).json();

    // Retrying reuses the stored question: still one question, now one answer.
    expect(rows.filter((r) => r.role === "user")).toHaveLength(1);
    expect(rows.filter((r) => r.role === "assistant")).toHaveLength(1);
    expect(retried.answer.kind).toBe("answer");
    expect(retried.answer.sources).toHaveLength(1);
    expect(retried.answer.sources[0]).toMatchObject({ n: 1, page: 3 });
  });

  it("answers plainly, without AI text, when the materials have nothing", async () => {
    hybridSearch.mockResolvedValue([]);
    const json = await (await answer({ question: "Why?", course_name: "INFO 1300", save: true })).json();
    expect(json.kind).toBe("notice");
    expect(json.answer.kind).toBe("notice");
    expect(json.answer_markdown).toBe(
      "Your INFO 1300 materials don't cover this. Upload the file that does, or ask it a different way.",
    );
    expect(runTask).not.toHaveBeenCalled();
  });

  it("searches for any of the question's words when no passage has them all", async () => {
    // "Why does an ID selector beat any number of class selectors?": no lecture says "beat"
    hybridSearch.mockReset();
    hybridSearch.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { chunk_id: "c1", doc_id: "d1", doc_title: "Lecture 14", page_number: 3, rank_score: 2, snippet: "An ID selector outranks classes." },
    ]);
    runTask.mockResolvedValueOnce({
      output: { answer_markdown: "IDs outrank classes [1].", citations: [{ chunk_id: "c1", reason: "r", quote_snippet: "An ID selector outranks classes" }] },
      meta: { cacheHit: false, latencyMs: 5 },
    });

    const json = await (
      await answer({ question: "Why does an ID selector beat any number of class selectors?", course_name: "INFO 1300", save: true })
    ).json();

    expect(json.kind).toBe("answer");
    expect(json.answer.sources[0]).toMatchObject({ n: 1, title: "Lecture 14" });
    expect(hybridSearch.mock.calls.map(([params]) => (params as { match: string }).match)).toEqual(["all", "any"]);
  });

  it("keeps an answer that every word finds, without searching again or embedding in FTS mode", async () => {
    vi.stubEnv("HYBRID_SEARCH_ENABLED", "false");
    runTask.mockResolvedValueOnce({
      output: { answer_markdown: "Columns decide [1].", citations: [{ chunk_id: "c1", reason: "r", quote_snippet: "Compare the columns" }] },
      meta: { cacheHit: false, latencyMs: 5 },
    });

    const json = await (await answer({ question: "How do columns compare?", course_name: "INFO 1300" })).json();

    expect(json.kind).toBe("answer");
    expect(hybridSearch).toHaveBeenCalledTimes(1);
    expect(hybridSearch.mock.calls[0][0]).toMatchObject({ match: "all", mode: "FTS" });
    // HYBRID_SEARCH_ENABLED is off, so the vector half never runs and the embedding isn't needed
    expect(embed).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("shows the model's 'Your materials don't cover this.' as the notice, not as an AI answer", async () => {
    runTask.mockResolvedValueOnce({
      output: { answer_markdown: "Your materials don’t cover this.", citations: [] },
      meta: { cacheHit: false, latencyMs: 5 },
    });

    const json = await (await answer({ question: "How do I bake sourdough?", course_name: "INFO 1300", save: true })).json();

    expect(json.kind).toBe("notice");
    expect(json.answer.kind).toBe("notice");
    expect(json.answer_markdown).toBe(
      "Your INFO 1300 materials don't cover this. Upload the file that does, or ask it a different way.",
    );
    expect(rows.find((r) => r.role === "assistant")?.citations).toEqual({ notice: "no_match" });
  });

  it("refuses a retry for a question that isn't stored", async () => {
    const res = await answer({ question: "Why?", course_name: "INFO 1300", save: true, question_id: "nope" });
    expect(res.status).toBe(404);
    expect(rows).toHaveLength(0);
  });

  it("explains an over-long question", async () => {
    const res = await answer({ question: "x".repeat(2001), course_name: "INFO 1300" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Shorten your question to 2,000 characters.");
  });
});
