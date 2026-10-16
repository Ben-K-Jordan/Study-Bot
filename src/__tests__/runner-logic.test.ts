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
import { draftKey, parseDraft } from "@/components/session/runner/storage"
import { needsSavedAnswers, repairsAdded, resultCompletesRun, resultStartsBreak } from "@/components/session/runner/types"
import { feedbackSummary, plainSummaryText } from "@/components/session/runner/question-kind"
import { feedbackStatus } from "@/components/session/runner/use-feedback"
import { questionBindings, type QuestionHotkeys } from "@/components/session/runner/use-question-hotkeys"
import { submitFailure } from "@/components/session/runner/use-question-actions"
import { needsReload } from "@/components/session/runner/api"
import { ApiError } from "@/lib/client-api"

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
    expect(buildExamScore({ index: 2, score: "INCORRECT", errorLog: mcqCorrectionRule(" Stack ") }).error_log).toEqual({
      error_type: "MISCONCEPTION",
      correction_rule: 'The correct answer is "Stack".',
    })
  })

  it("word an exam multiple-choice correction like the server, so error cards stay answerable", () => {
    // src/lib/auto-flashcards.ts wraps a "Which of the following" stem only
    // when the correction carries this marker; services/run.ts writes the same.
    const marker = /the correct answer is\s*"[^"]+"/i
    expect(mcqCorrectionRule("A hash table keyed by vertex").correction_rule).toMatch(marker)
    expect(mcqCorrectionRule("A hash table keyed by vertex").correction_rule).toBe(
      'The correct answer is "A hash table keyed by vertex".'
    )
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

  it("keeps a multiple-choice pick and its rating across a break or refresh", () => {
    const picked = run(
      initialQuestionState({ examScoring: false, choiceCount: 4 }),
      { type: "choose", index: 2 },
      { type: "rate", value: 5 }
    )
    const saved = draftOf(picked)
    expect(saved).toEqual({ choice: 2, confidence: 5 })
    // Through localStorage and back.
    const restored = initialQuestionState({ examScoring: false, draft: parseDraft(JSON.stringify(saved)), choiceCount: 4 })
    expect(restored).toMatchObject({ choice: 2, confidence: 5 })
    // A pick that no longer fits the question, or a rating off the scale, is dropped.
    expect(initialQuestionState({ examScoring: false, draft: { choice: 5, confidence: 4 }, choiceCount: 4 })).toMatchObject({
      choice: null,
      confidence: null,
    })
    // Exam scoring reads the answer saved during the exam, never a draft.
    expect(initialQuestionState({ examScoring: true, draft: { choice: 1 }, choiceCount: 4 }).choice).toBeNull()
  })

  it("shows an empty correction rule beside the field and clears it on typing", () => {
    const logging = run(
      fresh(),
      { type: "answer", text: "a" },
      { type: "reveal_start", seconds: 1 },
      { type: "reveal_done", reveal: { model_answer: "m", key_points: null } },
      { type: "score", score: "INCORRECT", errorLog: true },
      { type: "field_error", error: { field: "correction", message: "Write the correction rule first." } }
    )
    expect(logging.fieldError).toEqual({ field: "correction", message: "Write the correction rule first." })
    expect(run(logging, { type: "correction", text: "r" }).fieldError).toBeNull()
    expect(run(logging, { type: "similar", text: "q" }).fieldError).not.toBeNull()
  })

  it("remembers when only a reload helps, until the next try", () => {
    const failed = run(
      fresh(),
      { type: "answer", text: "a" },
      { type: "submit_start" },
      { type: "failed", message: "x", reload: true }
    )
    expect(failed.errorReload).toBe(true)
    expect(run(failed, { type: "submit_start" }).errorReload).toBe(false)
    expect(run(fresh(), { type: "submit_start" }, { type: "failed", message: "x" }).errorReload).toBe(false)
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

describe("stored drafts", () => {
  it("keep only fields of the right type", () => {
    expect(parseDraft(JSON.stringify({ answer: "a", choice: "2", confidence: 3, error_type: "MEMORY" }))).toEqual({
      answer: "a",
      confidence: 3,
      error_type: "MEMORY",
    })
    expect(parseDraft("not json")).toBeNull()
    expect(parseDraft(null)).toBeNull()
  })
})

describe("feedback status", () => {
  const ok = { status: "OK", excerpts: [], explanation: "x" }
  const pending = { status: "PENDING", excerpts: [] }
  it("tells a slow poll, a failed load and unavailable feedback apart", () => {
    expect(feedbackStatus({ attemptId: null, error: null, data: undefined, polls: 0 })).toEqual({
      status: "idle",
      failure: null,
    })
    expect(feedbackStatus({ attemptId: "a", error: null, data: undefined, polls: 0 }).status).toBe("loading")
    expect(feedbackStatus({ attemptId: "a", error: null, data: pending, polls: 3 }).status).toBe("loading")
    expect(feedbackStatus({ attemptId: "a", error: null, data: pending, polls: 25 })).toEqual({
      status: "failed",
      failure: "slow",
    })
    expect(feedbackStatus({ attemptId: "a", error: new Error("x"), data: undefined, polls: 0 }).failure).toBe("load")
    expect(
      feedbackStatus({ attemptId: "a", error: null, data: { status: "UNAVAILABLE", excerpts: [] }, polls: 0 }).failure
    ).toBe("unavailable")
    expect(feedbackStatus({ attemptId: "a", error: null, data: ok, polls: 0 }).status).toBe("ready")
    expect(feedbackStatus({ attemptId: "a", error: null, data: { status: "OK", excerpts: [] }, polls: 0 }).status).toBe(
      "empty"
    )
  })
})

describe("feedback sheet summary", () => {
  it("prefers the takeaway, else the explanation's first sentence, without markdown or citations", () => {
    expect(feedbackSummary({ key_takeaway: "Use a **priority queue** [1].", explanation: "Long." }, false)).toEqual({
      kind: "takeaway",
      text: "Use a priority queue.",
    })
    expect(
      feedbackSummary({ explanation: "Dijkstra always takes the closest vertex [1]. So it needs a heap [2]." }, false)
    ).toEqual({ kind: "explanation", text: "Dijkstra always takes the closest vertex." })
    expect(feedbackSummary({ explanation: "Use a `heap` here. More." }, false)).toEqual({
      kind: "explanation",
      text: "Use a heap here.",
    })
    // A correct answer shows only a takeaway; its explanation reads in full above.
    expect(feedbackSummary({ explanation: "Why it works." }, true)).toBeNull()
    expect(feedbackSummary({ key_takeaway: "Keep it." }, true)).toEqual({ kind: "takeaway", text: "Keep it." })
    expect(feedbackSummary({ explanation: "  " }, false)).toBeNull()
    expect(feedbackSummary(null, false)).toBeNull()
  })

  it("strips links, headings and list markers", () => {
    expect(plainSummaryText("## Why\n- See [the notes](http://x) for *more*")).toBe("Why See the notes for more")
  })
})

describe("question keys", () => {
  const noop = () => undefined
  const base: QuestionHotkeys = {
    step: "answering",
    mcq: true,
    choiceCount: 3,
    examMcqScorable: false,
    shortcutsEnabled: true,
    helpOpen: false,
    onToggleHelp: noop,
    onChoose: noop,
    onRate: noop,
    onSubmit: noop,
    onScore: noop,
    onSaveExamMcqScore: noop,
    onSaveCorrection: noop,
    onContinue: noop,
  }
  const keys = (input: QuestionHotkeys) => questionBindings(input).map((b) => `${b.mod ? "mod+" : ""}${b.key}`)

  it("pick, rate and submit a multiple-choice answer", () => {
    expect(keys(base)).toEqual(["?", "1", "2", "3", "enter", "q", "w", "e"])
    const chosen: number[] = []
    const rated: number[] = []
    const all = questionBindings({ ...base, onChoose: (i) => chosen.push(i), onRate: (v) => rated.push(v) })
    for (const binding of all) if (binding.key !== "?" && binding.key !== "enter") binding.run()
    expect(chosen).toEqual([0, 1, 2])
    expect(rated).toEqual([1, 3, 5])
  })

  it("keep only Enter bindings when single-key shortcuts are off", () => {
    expect(keys({ ...base, shortcutsEnabled: false })).toEqual(["enter"])
    expect(keys({ ...base, mcq: false, shortcutsEnabled: false })).toEqual(["mod+enter"])
    expect(keys({ ...base, step: "scoring", mcq: false })).toEqual(["?", "1", "2", "3"])
    expect(keys({ ...base, step: "error_log" })).toEqual(["?", "mod+enter"])
    expect(keys({ ...base, step: "feedback", shortcutsEnabled: false })).toEqual(["enter"])
  })
})

describe("failed saves", () => {
  it("offer Reload instead of Retry when the server already moved on", () => {
    const saved = new ApiError("This session changed in another tab. Reload to continue.", 409, {
      code: "duplicate_attempt",
    })
    expect(submitFailure(saved)).toEqual({ message: "This answer is already saved. Reload to continue.", reload: true })
    const otherTab = new ApiError("This question was answered in another tab. Reload to continue.", 409, {
      code: "wrong_index",
    })
    expect(submitFailure(otherTab)).toEqual({ message: otherTab.message, reload: true })
    const server = new ApiError("Answer not saved. Retry in a moment.", 500, null)
    expect(submitFailure(server)).toEqual({ message: server.message, reload: false })
    expect(needsReload(new ApiError("This question isn't in the session. Reload to continue.", 400, null))).toBe(true)
    expect(needsReload(new TypeError("Failed to fetch"))).toBe(false)
  })
})

describe("saved exam answers", () => {
  it("load while the run is scoring and the payload lacks them", () => {
    expect(needsSavedAnswers({ runPhase: "REVIEW", shownPhase: null, hasAttempts: false })).toBe(true)
    expect(needsSavedAnswers({ runPhase: "REVIEW", shownPhase: "REVIEW", hasAttempts: true })).toBe(false)
    expect(needsSavedAnswers({ runPhase: "EXAM", shownPhase: "EXAM", hasAttempts: false })).toBe(false)
  })

  it("stay loaded while the last scored question shows its feedback", () => {
    // The last score completes the run, which leaves REVIEW, but the scored
    // question stays on screen until See results.
    expect(needsSavedAnswers({ runPhase: "COMPLETE", shownPhase: "REVIEW", hasAttempts: false })).toBe(true)
    expect(needsSavedAnswers({ runPhase: "COMPLETE", shownPhase: undefined, hasAttempts: false })).toBe(false)
  })
})

describe("repair questions added", () => {
  it("count from the starting deck, so a refresh keeps the number", () => {
    expect(repairsAdded({ prompt_count: 7, prompts: [1, 2, 3, 4, 5] }, 7)).toBe(2)
    expect(repairsAdded({ prompt_count: 5, prompts: [1, 2, 3, 4, 5] }, 5)).toBe(0)
    // No deck in the payload: growth since the screen opened.
    expect(repairsAdded({ prompt_count: 6 }, 5)).toBe(1)
  })
})
