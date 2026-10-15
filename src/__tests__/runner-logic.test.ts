/**
 * The study loop's pure logic: attempt payloads, question kinds, the
 * keyboard map and the per-question state machine.
 */
import { describe, it, expect } from "vitest"

import {
  MAX_ANSWER_SECONDS,
  answerSeconds,
  buildErrorLog,
  buildExamAnswer,
  buildExamScore,
  buildMcqAttempt,
  buildRecallAttempt,
  formatMcqAnswer,
  isConfidentError,
  mcqCorrectionRule,
  needsErrorLog,
  parseMcqAnswer,
} from "@/components/session/runner/attempt-payload"
import {
  highlightSnippet,
  isMcqPrompt,
  linkCitations,
  parseWorkedExample,
  questionKind,
  sourceLabel,
  splitQuestion,
  stripCompletionTrailer,
} from "@/components/session/runner/question-kind"
import { isTypingTarget, matchHotkey, type Binding, type HotkeyEventLike } from "@/components/session/runner/hotkeys"
import {
  draftOf,
  initialQuestionState,
  questionReducer,
  type QuestionAction,
  type QuestionState,
} from "@/components/session/runner/question-reducer"
import { draftKey } from "@/components/session/runner/storage"
import { resultCompletesRun, resultStartsBreak } from "@/components/session/runner/types"

describe("answer timing", () => {
  it("counts whole seconds and stays under the server's 7200 limit", () => {
    expect(answerSeconds(1_000, 31_400)).toBe(30)
    expect(answerSeconds(0, 3 * 60 * 60 * 1000)).toBe(MAX_ANSWER_SECONDS)
    expect(MAX_ANSWER_SECONDS).toBeLessThan(7200)
    expect(answerSeconds(5_000, 1_000)).toBe(0)
    expect(answerSeconds(Number.NaN, 1_000)).toBe(0)
  })
})

describe("multiple-choice answers", () => {
  it("are stored as [A] text and parsed back", () => {
    expect(formatMcqAnswer(1, "The heap")).toBe("[B] The heap")
    expect(parseMcqAnswer("[B] The heap")).toBe(1)
    expect(parseMcqAnswer("[D] x")).toBe(3)
    expect(parseMcqAnswer("free text")).toBeNull()
    expect(parseMcqAnswer(null)).toBeNull()
  })

  it("send the index for server grading, never a score", () => {
    const payload = buildMcqAttempt({ index: 4, choiceIndex: 2, choiceText: "Stack", seconds: 12, confidence: null })
    expect(payload).toEqual({
      prompt_index: 4,
      user_answer: "[C] Stack",
      time_to_answer_seconds: 12,
      mcq_choice_index: 2,
    })
    expect(payload).not.toHaveProperty("self_score")
  })
})

describe("confidence", () => {
  it("is sent only when the student rated it", () => {
    const unrated = buildRecallAttempt({
      index: 0, answer: "a", score: "CORRECT", seconds: 3, confidence: null,
      isPretest: false, isRepair: false, errorLog: null,
    })
    expect(unrated).not.toHaveProperty("confidence_rating")
    const rated = buildExamAnswer({ index: 0, answer: "a", seconds: 3, confidence: 5 })
    expect(rated.confidence_rating).toBe(5)
  })
})

describe("error logs", () => {
  it("are needed for misses, except pretest and repair questions outside exam scoring", () => {
    expect(needsErrorLog({ score: "CORRECT", isPretest: false, isRepair: false, examScoring: false })).toBe(false)
    expect(needsErrorLog({ score: "PARTIAL", isPretest: false, isRepair: false, examScoring: false })).toBe(true)
    expect(needsErrorLog({ score: "INCORRECT", isPretest: true, isRepair: false, examScoring: false })).toBe(false)
    expect(needsErrorLog({ score: "INCORRECT", isPretest: false, isRepair: true, examScoring: false })).toBe(false)
    // The exam score schema always requires one for a miss.
    expect(needsErrorLog({ score: "INCORRECT", isPretest: true, isRepair: true, examScoring: true })).toBe(true)
  })

  it("trim the rule and drop an empty similar question", () => {
    expect(buildErrorLog({ errorType: "MEMORY", correctionRule: "  rule ", similarQuestion: "  " })).toEqual({
      error_type: "MEMORY",
      correction_rule: "rule",
    })
  })

  it("ride on free recall misses only when the question isn't a pretest or repair", () => {
    const log = buildErrorLog({ errorType: "MISCONCEPTION", correctionRule: "r", similarQuestion: "q?" })
    const miss = buildRecallAttempt({
      index: 1, answer: "a", score: "INCORRECT", seconds: 9, confidence: 1,
      isPretest: false, isRepair: false, errorLog: log,
    })
    expect(miss.error_log).toEqual(log)
    const pretest = buildRecallAttempt({
      index: 1, answer: "a", score: "INCORRECT", seconds: 9, confidence: null,
      isPretest: true, isRepair: false, errorLog: log,
    })
    expect(pretest).not.toHaveProperty("error_log")
    expect(pretest.is_pretest).toBe(true)
  })

  it("for exam scoring carry the score kind and no answer", () => {
    expect(buildExamScore({ index: 2, score: "CORRECT", errorLog: null })).toEqual({
      prompt_index: 2,
      kind: "SCORE",
      self_score: "CORRECT",
    })
    expect(buildExamScore({ index: 2, score: "INCORRECT", errorLog: mcqCorrectionRule("Stack.") }).error_log).toEqual({
      error_type: "MISCONCEPTION",
      correction_rule: "The right answer is Stack.",
    })
  })
})

describe("confident errors", () => {
  it("need a Sure rating on a miss, never on a pretest", () => {
    expect(isConfidentError({ score: "INCORRECT", confidence: 5, isPretest: false })).toBe(true)
    expect(isConfidentError({ score: "PARTIAL", confidence: 5, isPretest: false })).toBe(true)
    expect(isConfidentError({ score: "INCORRECT", confidence: 4, isPretest: false })).toBe(true)
    expect(isConfidentError({ score: "INCORRECT", confidence: 3, isPretest: false })).toBe(false)
    expect(isConfidentError({ score: "CORRECT", confidence: 5, isPretest: false })).toBe(false)
    expect(isConfidentError({ score: "INCORRECT", confidence: 5, isPretest: true })).toBe(false)
    expect(isConfidentError({ score: null, confidence: 5, isPretest: false })).toBe(false)
  })
})

describe("question kinds", () => {
  const base = { prompt_index: 0, text: "Q" }

  it("reads pack and source markers", () => {
    expect(questionKind({ ...base, meta: { pack: "PRE_TEST" } }).type).toBe("pretest")
    expect(questionKind({ ...base, source_type: "VARIANT_REPAIR", meta: { original_prompt_text: "Orig" } })).toEqual({
      type: "repair",
      original: "Orig",
      inSession: true,
    })
    expect(questionKind({ ...base, source_type: "ERROR_LOG" })).toMatchObject({ type: "repair", inSession: false })
    expect(questionKind({ ...base, meta: { pack: "WARMUP" } }).type).toBe("review")
    expect(questionKind({ ...base, meta: { pack: "WE_COMPLETION_2", step_count: 4 } })).toEqual({
      type: "worked-completion",
      missing: 2,
      stepCount: 4,
    })
    expect(questionKind(base).type).toBe("standard")
  })

  it("treats a choice list it can't draw as free recall", () => {
    expect(isMcqPrompt({ ...base, format: "MCQ", choices: ["a", "b", "c", "d"] })).toBe(true)
    expect(isMcqPrompt({ ...base, format: "MCQ", choices: [] })).toBe(false)
    expect(isMcqPrompt({ ...base, format: "MCQ" })).toBe(false)
  })

  it("splits the question from the instruction after it", () => {
    expect(splitQuestion("What is a base case?\n\nFrom memory: answer it.")).toEqual({
      heading: "What is a base case?",
      body: "From memory: answer it.",
    })
    expect(splitQuestion("One line").body).toBe("")
  })

  it("parses worked examples in the old and new step formats", () => {
    const fresh = parseWorkedExample(
      "Solve 2x = 4.\n\nStep 1: Divide by 2. Why: Undo the product.\nStep 2: Read x = 2. Why: That is the result.\n\nIn your own words, why does step 2 follow from the steps before it?"
    )
    expect(fresh.problem).toBe("Solve 2x = 4.")
    expect(fresh.steps).toEqual([
      { action: "Divide by 2", why: "Undo the product" },
      { action: "Read x = 2", why: "That is the result" },
    ])
    expect(fresh.question).toContain("why does step 2 follow")

    const old = parseWorkedExample("P\n\nStep 1: A action \u2014 why: A reason\n\nQ?")
    expect(old.steps).toEqual([{ action: "A action", why: "A reason" }])
  })

  it("removes the missing-steps line the screen draws itself", () => {
    expect(stripCompletionTrailer("Problem\n(The final step is missing \u2014 supply it and state why it follows.)")).toBe(
      "Problem"
    )
    expect(stripCompletionTrailer("Problem\n\nThe last two steps are missing. Write them and say why each follows.")).toBe(
      "Problem"
    )
  })
})

describe("sources", () => {
  it("split highlight marks into segments without HTML", () => {
    expect(highlightSnippet("## Heading\nA <<priority queue>> holds **items**")).toEqual([
      { text: "Heading\nA ", mark: false },
      { text: "priority queue", mark: true },
      { text: " holds items", mark: false },
    ])
    const injected = highlightSnippet("<img src=x onerror=alert(1)> <<x>>")
    expect(injected[0]).toEqual({ text: "<img src=x onerror=alert(1)> ", mark: false })
  })

  it("link only citations that have a source", () => {
    expect(linkCitations("See [1] and [3].", 2)).toBe("See [1](#source-1) and [3].")
    expect(linkCitations("See [1].", 0)).toBe("See [1].")
  })

  it("label sources with title and page, skipping page 0", () => {
    expect(sourceLabel(2, { doc_title: "Lecture 5", page_number: 3 })).toBe("Source 2: Lecture 5, page 3")
    expect(sourceLabel(1, { doc_title: "Notes", page_number: 0 })).toBe("Source 1: Notes")
  })
})

describe("keyboard map", () => {
  const ran: string[] = []
  const bindings: Binding[] = [
    { key: "1", run: () => ran.push("1") },
    { key: "enter", run: () => ran.push("enter") },
    { key: "enter", mod: true, run: () => ran.push("mod-enter") },
  ]
  const textarea = { tagName: "TEXTAREA" } as unknown as EventTarget
  const button = { tagName: "BUTTON", getAttribute: () => null } as unknown as EventTarget
  const radio = { tagName: "INPUT", type: "radio" } as unknown as EventTarget
  const press = (over: Partial<HotkeyEventLike>): HotkeyEventLike => ({
    key: "1",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: null,
    ...over,
  })

  it("ignores single keys while typing, but not Ctrl+Enter", () => {
    expect(matchHotkey(press({ key: "1", target: textarea }), bindings)).toBeNull()
    expect(matchHotkey(press({ key: "Enter", ctrlKey: true, target: textarea }), bindings)?.key).toBe("enter")
    expect(matchHotkey(press({ key: "Enter", ctrlKey: true, target: textarea }), bindings)?.mod).toBe(true)
  })

  it("leaves Enter on a focused button to the button (no double action)", () => {
    expect(matchHotkey(press({ key: "Enter", target: button }), bindings)).toBeNull()
    expect(matchHotkey(press({ key: "1", target: button }), bindings)?.key).toBe("1")
  })

  it("treats a focused radio as a place for shortcuts", () => {
    expect(isTypingTarget(radio)).toBe(false)
    expect(matchHotkey(press({ key: "1", target: radio }), bindings)?.key).toBe("1")
  })

  it("skips handled, repeated, composing and Alt presses", () => {
    expect(matchHotkey(press({ defaultPrevented: true }), bindings)).toBeNull()
    expect(matchHotkey(press({ repeat: true }), bindings)).toBeNull()
    expect(matchHotkey(press({ isComposing: true }), bindings)).toBeNull()
    expect(matchHotkey(press({ altKey: true }), bindings)).toBeNull()
    expect(matchHotkey(press({ key: "1", ctrlKey: true }), bindings)).toBeNull()
  })
})

describe("question state", () => {
  const run = (state: QuestionState, ...actions: QuestionAction[]) => actions.reduce(questionReducer, state)
  const fresh = () => initialQuestionState({ examScoring: false })

  it("restores a draft into empty fields", () => {
    const state = initialQuestionState({
      examScoring: false,
      draft: { answer: "typed", correction_rule: "rule", error_type: "MEMORY" },
    })
    expect(state.answer).toBe("typed")
    expect(state.correctionRule).toBe("rule")
    expect(state.errorType).toBe("MEMORY")
    expect(initialQuestionState({ examScoring: false, draft: { error_type: "BOGUS" } }).errorType).toBe("MISCONCEPTION")
  })

  it("starts exam scoring in the scoring step", () => {
    expect(initialQuestionState({ examScoring: true, draft: { answer: "x" } })).toMatchObject({ step: "scoring", answer: "" })
  })

  it("reveals, scores, logs the error and lands on feedback", () => {
    const outcome = { score: "INCORRECT" as const, mcq: null, attemptId: "a1", completes: false, startsBreak: false }
    const state = run(
      fresh(),
      { type: "answer", text: "my answer" },
      { type: "rate", value: 5 },
      { type: "reveal_start", seconds: 40 },
      { type: "reveal_done", reveal: { model_answer: " Model ", key_points: ["a", " "], committed_answer: "my answer" } },
      { type: "score", score: "INCORRECT", errorLog: true },
      { type: "correction", text: "The rule" },
      { type: "submit_start" },
      { type: "submit_done", outcome }
    )
    expect(state.step).toBe("feedback")
    expect(state.seconds).toBe(40)
    expect(state.reveal).toEqual({ status: "ready", modelAnswer: "Model", keyPoints: ["a"] })
    expect(state.confidence).toBe(5)
    expect(state.outcome).toEqual(outcome)
    expect(draftOf(state)).toBeNull()
  })

  it("uses the answer the server committed", () => {
    const state = run(
      fresh(),
      { type: "answer", text: "edited" },
      { type: "reveal_start", seconds: 1 },
      { type: "reveal_done", reveal: { model_answer: null, key_points: null, committed_answer: "first" } }
    )
    expect(state.answer).toBe("first")
  })

  it("ignores a second submit while one is in flight", () => {
    const pending = run(fresh(), { type: "answer", text: "a" }, { type: "submit_start", seconds: 3 })
    expect(run(pending, { type: "submit_start", seconds: 9 })).toBe(pending)
    expect(run(pending, { type: "answer", text: "changed" }).answer).toBe("a")
  })

  it("keeps everything typed when a break blocks the save", () => {
    const state = run(fresh(), { type: "answer", text: "keep me" }, { type: "submit_start" }, { type: "submit_blocked" })
    expect(state.pending).toBeNull()
    expect(state.answer).toBe("keep me")
    expect(draftOf(state)).toEqual({ answer: "keep me" })
  })

  it("keeps the input and shows the failure when the save fails", () => {
    const state = run(fresh(), { type: "answer", text: "a" }, { type: "submit_start" }, { type: "failed", message: "Answer not saved." })
    expect(state).toMatchObject({ pending: null, error: "Answer not saved.", answer: "a", step: "answering" })
  })

  it("lets the student change the score from the error log", () => {
    const state = run(
      fresh(),
      { type: "answer", text: "a" },
      { type: "reveal_start", seconds: 1 },
      { type: "reveal_done", reveal: { model_answer: "m", key_points: null } },
      { type: "score", score: "PARTIAL", errorLog: true },
      { type: "change_score" }
    )
    expect(state).toMatchObject({ step: "scoring", score: null })
  })
})

describe("submit results", () => {
  it("say when the run finished or a break is due", () => {
    expect(resultCompletesRun({ status: "COMPLETED" })).toBe(true)
    expect(resultCompletesRun({ status: "ACTIVE" })).toBe(false)
    expect(resultStartsBreak({ break_state: { on_break: true } })).toBe(true)
    expect(resultStartsBreak({ break_state: { on_break: false } })).toBe(false)
    expect(resultStartsBreak(null)).toBe(false)
  })
})

describe("draft keys", () => {
  it("keep the existing localStorage contract", () => {
    expect(draftKey("run-1", "ACTIVE", 3)).toBe("draft:run-1:ACTIVE:3")
  })
})
