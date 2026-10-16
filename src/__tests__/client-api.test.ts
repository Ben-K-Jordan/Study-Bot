import { afterEach, describe, expect, it, vi } from "vitest"

import {
  ApiError,
  SIGNED_OUT_MESSAGE,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiRequest,
  failureMessage,
  retryAfterSeconds,
  sharedFailureReason,
} from "@/lib/client-api"

type Call = { url: string; init: RequestInit }

/** Stub fetch with one response; returns the calls it saw. */
function stubFetch(body: unknown, init: ResponseInit = {}): Call[] {
  const calls: Call[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, requestInit: RequestInit) => {
      calls.push({ url, init: requestInit })
      return new Response(body === undefined ? null : JSON.stringify(body), init)
    })
  )
  return calls
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error("expected the request to fail")
}

afterEach(() => vi.unstubAllGlobals())

describe("apiRequest and its helpers", () => {
  it("sends JSON with the method and returns the parsed answer", async () => {
    const calls = stubFetch({ ok: true })
    await expect(apiPatch("/api/flashcards/d1", { title: "Recursion" })).resolves.toEqual({ ok: true })
    expect(calls[0].url).toBe("/api/flashcards/d1")
    expect(calls[0].init.method).toBe("PATCH")
    expect(calls[0].init.headers).toEqual({ "Content-Type": "application/json" })
    expect(calls[0].init.body).toBe(JSON.stringify({ title: "Recursion" }))
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal)
  })

  it("sends no body or content type without a body", async () => {
    const calls = stubFetch({ deleted: true })
    await apiDelete("/api/guides/g1")
    await apiGet("/api/plans")
    expect(calls.map((call) => call.init.method)).toEqual(["DELETE", "GET"])
    for (const call of calls) {
      expect(call.init.body).toBeUndefined()
      expect(call.init.headers).toBeUndefined()
    }
  })

  it("sends a DELETE with a body and PUT through apiRequest", async () => {
    const calls = stubFetch({})
    await apiRequest("DELETE", "/api/account", { confirm: "DELETE MY ACCOUNT" })
    await apiRequest("PUT", "/api/settings", { timezone: "America/New_York" })
    expect(calls[0].init.body).toBe(JSON.stringify({ confirm: "DELETE MY ACCOUNT" }))
    expect(calls[1].init.method).toBe("PUT")
  })

  it("rejects with ApiError carrying status, code and the server's sentence", async () => {
    stubFetch({ error: "This deck isn't there anymore.", code: "DECK_NOT_FOUND" }, { status: 404 })
    const error = await rejection(apiPost("/api/flashcards/d1/review", {}))
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 404, code: "DECK_NOT_FOUND", message: "This deck isn't there anymore." })
  })

  it("keeps Retry-After with a 429, so the message can say how long to wait", async () => {
    stubFetch({ error: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": "30" } })
    const error = await rejection(apiPost("/api/chat", { message: "Hi" }))
    expect(retryAfterSeconds(error)).toBe(30)
    expect(failureMessage(error, "Answer not generated.")).toBe("Too many requests. Retry in 30 seconds.")
  })

  it("prefers the wait the server put in the body", async () => {
    stubFetch({ error: "Too many requests.", retry_after_seconds: 120 }, { status: 429, headers: { "Retry-After": "5" } })
    const error = await rejection(apiGet("/api/plans"))
    expect(retryAfterSeconds(error)).toBe(120)
    expect(sharedFailureReason(error)).toBe("Too many requests. Retry in 2 minutes.")
  })
})

describe("shared failure copy", () => {
  it("says the sign-in expired on a 401", () => {
    expect(sharedFailureReason(new ApiError("Unauthorized", 401))).toBe(SIGNED_OUT_MESSAGE)
  })

  it("uses the server's own 429 sentence without a wait, and never a raw code", () => {
    const sentence = new ApiError("x", 429, { error: "Too many sign-in attempts. Retry in 15 minutes." })
    expect(sharedFailureReason(sentence)).toBe("Too many sign-in attempts. Retry in 15 minutes.")
    const code = new ApiError("RATE_LIMITED", 429, { error: "RATE_LIMITED" })
    expect(sharedFailureReason(code)).toBe("Too many requests. Retry in a minute.")
  })

  it("names a timeout and a lost connection", () => {
    expect(sharedFailureReason(new DOMException("timed out", "TimeoutError"))).toBe(
      "The server took too long to answer. Retry."
    )
    expect(sharedFailureReason(new TypeError("Failed to fetch"))).toBe("Check your connection and retry.")
  })

  it("leaves everything else to the screen", () => {
    const missing = new ApiError("Not found", 404, { code: "DECK_NOT_FOUND" })
    expect(sharedFailureReason(missing)).toBeNull()
    expect(failureMessage(missing, "Deck not deleted. Reload the page and retry.")).toBe(
      "Deck not deleted. Reload the page and retry."
    )
    // The student's own cancel is not a failure to report
    expect(sharedFailureReason(new DOMException("aborted", "AbortError"))).toBeNull()
  })
})
