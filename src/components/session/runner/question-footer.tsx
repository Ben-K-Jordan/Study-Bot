"use client"

import * as React from "react"
import { RotateCcwIcon } from "lucide-react"

import { cn } from "@/lib/utils"
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
  scoringReady = true,
  scoringWait = null,
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
  /** Exam scoring: the saved answer has loaded, so a score can be recorded. */
  scoringReady?: boolean
  /** Exam scoring: why the score buttons are off, said where they are. */
  scoringWait?: string | null
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
          disabled={!scoringReady}
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
          prompt={scoringWait ?? (isPretest ? "How close were you?" : "Score your answer")}
          pendingScore={pendingScore}
          disabled={pending || !scoringReady}
          showKeys={shortcutsEnabled}
          onScore={onScore}
        />
      </>
    )
  }

  if (step === "error_log") {
    // One row on a phone too, so the footer stays one button tall and the
    // correction rule field has room above it. From 600px the two buttons
    // sit at the footer's two ends.
    return (
      <div className="grid w-full grid-cols-[auto_minmax(0,1fr)] gap-2 sm:contents">
        <LessonButton
          variant="neutral"
          disabled={pending}
          onClick={onChangeScore}
          className="max-sm:min-w-0 max-sm:px-3 sm:w-auto"
        >
          <RotateCcwIcon aria-hidden="true" />
          {/* "Change" under 600px; the name stays "Change score". One span,
              so the button's flex gap doesn't widen the space. */}
          <span>
            Change<span className="max-sm:sr-only"> score</span>
          </span>
        </LessonButton>
        <LessonButton
          variant="check"
          kbd={["Mod", "Enter"]}
          // Enabled while the rule is empty: pressing it says what's missing beside the field.
          loading={pending}
          loadingLabel="Saving answer…"
          onClick={onSaveCorrection}
          className={cn(WIDE, "max-sm:min-w-0 max-sm:px-3 max-sm:[&_[data-slot=kbd-group]]:hidden")}
        >
          Save correction
        </LessonButton>
      </div>
    )
  }

  return null
}
