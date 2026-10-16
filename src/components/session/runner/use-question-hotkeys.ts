"use client"

import * as React from "react"

import { matchHotkey, type Binding } from "./hotkeys"
import type { Step } from "./question-reducer"
import type { Confidence, SelfScore } from "./types"

const CONFIDENCE_BY_KEY: Record<string, Confidence> = { q: 1, w: 3, e: 5 }

export interface QuestionHotkeys {
  step: Step
  mcq: boolean
  choiceCount: number
  /** Exam scoring of a multiple-choice answer: the score is known, Enter saves it. */
  examMcqScorable: boolean
  /**
   * Exam scoring: false until the answer saved during the exam has loaded,
   * so no key records a score for an answer the student can't see.
   */
  scoringReady?: boolean
  /** Single-key shortcuts are on (WCAG 2.1.4 lets the student turn them off). */
  shortcutsEnabled: boolean
  helpOpen: boolean
  onToggleHelp: () => void
  onChoose: (index: number) => void
  onRate: (value: Confidence) => void
  onSubmit: () => void
  onScore: (score: SelfScore) => void
  onSaveExamMcqScore: () => void
  onSaveCorrection: () => void
  onContinue: () => void
}

/** The keys that work on this step of the question. Pure, unit-tested. */
export function questionBindings(input: QuestionHotkeys): Binding[] {
  const list: Binding[] = []
  const single = input.shortcutsEnabled
  if (single) list.push({ key: "?", run: input.onToggleHelp })

  if (input.step === "answering") {
    if (input.mcq) {
      if (single) {
        for (let i = 0; i < input.choiceCount; i++) list.push({ key: String(i + 1), run: () => input.onChoose(i) })
      }
      list.push({ key: "enter", run: input.onSubmit })
    } else {
      list.push({ key: "enter", mod: true, run: input.onSubmit })
    }
    if (single) {
      for (const [key, value] of Object.entries(CONFIDENCE_BY_KEY)) list.push({ key, run: () => input.onRate(value) })
    }
  } else if (input.step === "scoring") {
    if (input.scoringReady === false) {
      // Nothing to score yet: the saved answer is loading or failed (Retry).
    } else if (input.examMcqScorable) {
      list.push({ key: "enter", run: input.onSaveExamMcqScore })
    } else if (single) {
      list.push({ key: "1", run: () => input.onScore("CORRECT") })
      list.push({ key: "2", run: () => input.onScore("PARTIAL") })
      list.push({ key: "3", run: () => input.onScore("INCORRECT") })
    }
  } else if (input.step === "error_log") {
    list.push({ key: "enter", mod: true, run: input.onSaveCorrection })
  } else if (input.step === "feedback") {
    list.push({ key: "enter", run: input.onContinue })
  }
  return list
}

/**
 * The question's keyboard loop on document keydown: number keys answer and
 * score, Q/W/E rate, Enter checks and moves on, Ctrl or Cmd with Enter
 * submits written work. Reads the latest props on every press, so the
 * listener is added once per question.
 */
export function useQuestionHotkeys(input: QuestionHotkeys): void {
  const onKeyDown = React.useEffectEvent((event: KeyboardEvent) => {
    // With the help open, keys belong to it, except "?" which closes it.
    if (input.helpOpen && event.key !== "?") return
    // Enter inside the feedback acts on what's focused there (a citation, a
    // reflection field), never "Next question".
    if (event.key === "Enter" && event.target instanceof Element && event.target.closest("[data-feedback-details]")) {
      return
    }
    const binding = matchHotkey(event, questionBindings(input))
    if (!binding) return
    event.preventDefault()
    binding.run()
  })

  React.useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event)
    document.addEventListener("keydown", listener)
    return () => document.removeEventListener("keydown", listener)
  }, [])
}
