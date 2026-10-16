/**
 * Feedback is written from the student's materials and says where from.
 *
 * - A correct answer's "why it's correct" note comes with the passages it
 *   was written from, saved as citations like a wrong answer's explanation.
 * - With no passage, there is no note at all (never general knowledge shown
 *   as sourced), and the result is marked no_sources.
 * - The fallback search matches any of the query's words and puts the topic
 *   title first.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest"

interface AttemptRow {
  id: string
  runId: string
  promptIndex: number
  promptText: string
  userAnswer: string
  selfScore: string | null
  confidenceRating: number | null
  feedbackStatus: string
  feedbackJson: Record<string, unknown> | null
  run: {
    userId: string
    session: { courseName: string; examName: string; objectives: { id: string; title: string }[] }
  }
}

const store: { row: AttemptRow | null } = { row: null }

vi.mock("@/lib/db", () => {
  const prisma = {
    sessionAttempt: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        store.row && store.row.id === where.id ? store.row : null
      ),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (!store.row) return { count: 0 }
        Object.assign(store.row, data)
        return { count: 1 }
      }),
    },
    sessionErrorLog: {
      findFirst: vi.fn(async () => ({ correctionRule: "Water moves toward higher solute concentration", errorType: "MISCONCEPTION" })),
      findMany: vi.fn(async () => []),
    },
    sessionRunPrompt: { findUnique: vi.fn(async () => null) },
    objectiveAnchor: { findMany: vi.fn(async () => []) },
    attemptCitation: { upsert: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  }
  return { prisma }
})

const SEARCH_RESULT = {
  chunk_id: "chunk-1",
  doc_id: "doc-1",
  doc_title: "Cell Biology Notes",
  page_number: 3,
  rank_score: 2.4,
  snippet: "<<Osmosis>> is the diffusion of water across a membrane.",
}

vi.mock("@/lib/search", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/search")>()
  return { ...actual, searchChunks: vi.fn(async () => [SEARCH_RESULT]) }
})

vi.mock("@/lib/ai/provider-factory", () => ({ createProvider: vi.fn(() => ({})) }))

vi.mock("@/lib/ai/gateway", () => ({
  runTask: vi.fn(async (_ctx: unknown, spec: { task: string }) => {
    if (spec.task === "REINFORCE_CORRECT") {
      return { output: { reinforcement: "Water follows solute [1].", deeper_insight: "", concept_connection: null } }
    }
    if (spec.task === "SOCRATIC_FOLLOWUP") {
      return { output: { followup_question: "What if the membrane were impermeable?", purpose: "probe" } }
    }
    if (spec.task === "GENERATE_FEEDBACK") {
      return {
        output: {
          explanation: "Osmosis moves water [1].",
          key_takeaway: "",
          concept_connection: null,
          mnemonic: null,
          pattern_advice: null,
          referenced_chunk_ids: [],
        },
      }
    }
    return { output: {} }
  }),
}))

import { generateFeedback } from "@/services/feedback"
import { prisma } from "@/lib/db"
import { searchChunks } from "@/lib/search"
import { runTask } from "@/lib/ai/gateway"

const searchChunksMock = vi.mocked(searchChunks)
const runTaskMock = vi.mocked(runTask)
const upsertMock = vi.mocked(prisma.attemptCitation.upsert)

function makeAttempt(overrides: Partial<AttemptRow> = {}): AttemptRow {
  return {
    id: "attempt-1",
    runId: "run-1",
    promptIndex: 0,
    promptText: "From memory: explain Osmosis in 3 to 5 bullets.",
    userAnswer: "Water moves across a membrane",
    selfScore: "CORRECT",
    confidenceRating: 5,
    feedbackStatus: "NONE",
    feedbackJson: null,
    run: {
      userId: "user-1",
      session: { courseName: "Biology", examName: "Midterm 1", objectives: [{ id: "obj-1", title: "Cell transport" }] },
    },
    ...overrides,
  }
}

const ORIGINAL_AI_PROVIDER = process.env.AI_PROVIDER

describe("feedback sources", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.row = makeAttempt()
    process.env.AI_PROVIDER = "openai"
    searchChunksMock.mockImplementation(async () => [SEARCH_RESULT])
  })

  afterAll(() => {
    if (ORIGINAL_AI_PROVIDER === undefined) delete process.env.AI_PROVIDER
    else process.env.AI_PROVIDER = ORIGINAL_AI_PROVIDER
  })

  it("returns and saves the passages a correct answer's note was written from", async () => {
    const result = await generateFeedback("user-1", "attempt-1")

    expect(result.reinforcement).toBe("Water follows solute [1].")
    expect(result.excerpts).toEqual([
      {
        chunk_id: "chunk-1",
        doc_title: "Cell Biology Notes",
        page_number: 3,
        snippet: SEARCH_RESULT.snippet,
        rank: 1,
      },
    ])
    expect(result.no_sources).toBeUndefined()
    expect(upsertMock).toHaveBeenCalledTimes(1)
    // The note's AI call got the same passages
    const reinforce = runTaskMock.mock.calls.find(([, spec]) => (spec as { task: string }).task === "REINFORCE_CORRECT")
    expect((reinforce?.[1] as { input: { chunks: { chunk_id: string }[] } }).input.chunks).toEqual([
      expect.objectContaining({ chunk_id: "chunk-1" }),
    ])
  })

  it("writes no correct-answer note when no passage matches, and says there are no sources", async () => {
    searchChunksMock.mockResolvedValue([])

    const result = await generateFeedback("user-1", "attempt-1")

    expect(result.reinforcement).toBeUndefined()
    expect(result.deeper_insight).toBeUndefined()
    expect(result.excerpts).toEqual([])
    expect(result.no_sources).toBe(true)
    expect(runTaskMock.mock.calls.map(([, spec]) => (spec as { task: string }).task)).not.toContain("REINFORCE_CORRECT")
    // The follow-up question is still asked; it isn't presented as sourced.
    expect(result.socratic_followup).toBe("What if the membrane were impermeable?")
  })

  it("searches any of the words, topic title first, without the question template's wording", async () => {
    store.row = makeAttempt({ selfScore: "INCORRECT" })

    await generateFeedback("user-1", "attempt-1")

    expect(searchChunksMock).toHaveBeenCalled()
    for (const [params] of searchChunksMock.mock.calls) {
      expect(params.match).toBe("any")
      expect(params.q.startsWith("Cell transport Water moves toward higher solute concentration")).toBe(true)
      expect(params.q).not.toMatch(/From memory|3 to 5 bullets/)
    }
  })

  it("asks the follow-up question from the passages already found, without searching again", async () => {
    store.row = makeAttempt({ selfScore: "INCORRECT" })

    const result = await generateFeedback("user-1", "attempt-1")

    expect(result.explanation).toBe("Osmosis moves water [1].")
    // One scoped and one course-wide search, nothing more
    expect(searchChunksMock).toHaveBeenCalledTimes(2)
  })
})
