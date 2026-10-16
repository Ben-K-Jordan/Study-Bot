"use client"

import * as React from "react"
import { RotateCcwIcon } from "lucide-react"

import { LessonButton } from "@/components/lesson/lesson-button"

import type { Step } from "./question-reducer"
import { ScoreBar } from "./scoring"
import type { SelfScore } from "./types"

const WIDE = "w-full sm:w-auto sm:min-w-44"

/**
 * The footer bar for each step before feedback: Submit answer, the score
 * buttons, Save score, or Change score and Save correction. The feedback
 * sheet takes its place after that.
 */
export function QuestionFooter({
  step,
  help,
  mcq,
  examAnswering,
  examMcqScorable,
  isPretest,
  canSubmit,
  pending,
  pendingScore,
  shortcutsEnabled,
  onSubmit,
  onScore,
  onSaveExamMcqScore,
  onChangeScore,
  onSaveCorrection,
}: {
  step: Step
  /** The keyboard shortcuts button. */
  help: React.ReactNode
  mcq: boolean
  examAnswering: boolean
  examMcqScorable: boolean
  isPretest: boolean
  canSubmit: boolean
  pending: boolean
  /** The score being saved, which shows the spinner. */
  pendingScore: SelfScore | null
  shortcutsEnabled: boolean
  onSubmit: () => void
  onScore: (score: SelfScore) => void
  onSaveExamMcqScore: () => void
  onChangeScore: () => void
  onSaveCorrection: () => void
}) {
  if (step === "answering") {
    return (
      <>
        {help}
        <LessonButton
          variant="check"
          kbd={mcq ? "Enter" : ["Mod", "Enter"]}
          disabled={!canSubmit}
          loading={pending}
          loadingLabel={examAnswering ? "Saving answer…" : "Checking answer…"}
          onClick={onSubmit}
          className={WIDE}
        >
          Submit answer
        </LessonButton>
      </>
    )
  }

  if (step === "scoring") {
    return examMcqScorable ? (
      <>
        {help}
        <LessonButton
          variant="check"
          kbd="Enter"
          loading={pending}
          loadingLabel="Saving score…"
          onClick={onSaveExamMcqScore}
          className={WIDE}
        >
          Save score
        </LessonButton>
      </>
    ) : (
      <>
        {help}
        <ScoreBar
          prompt={isPretest ? "How close were you?" : "Score your answer"}
          pendingScore={pendingScore}
          disabled={pending}
          showKeys={shortcutsEnabled}
          onScore={onScore}
        />
      </>
    )
  }

  if (step === "error_log") {
    return (
      <>
        <LessonButton variant="neutral" disabled={pending} onClick={onChangeScore} className="w-full sm:w-auto">
          <RotateCcwIcon aria-hidden="true" />
          Change score
        </LessonButton>
        <LessonButton
          variant="check"
          kbd={["Mod", "Enter"]}
          // Enabled while the rule is empty: pressing it says what's missing beside the field.
          loading={pending}
          loadingLabel="Saving answer…"
          onClick={onSaveCorrection}
          className={WIDE}
        >
          Save correction
        </LessonButton>
      </>
    )
  }

  return null
}
