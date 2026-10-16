"use client"

import * as React from "react"
import { LightbulbIcon } from "lucide-react"

import { FeedbackSheet, type FeedbackTone } from "@/components/lesson/feedback-sheet"

import { FeedbackBody, type ReflectionProps } from "./feedback-body"
import { AiTag } from "./parts"
import { feedbackSummary } from "./question-kind"
import type { Outcome } from "./question-reducer"
import { InlineText } from "./rich-text"
import type { McqResult, SelfScore } from "./types"
import { useFeedback, type FeedbackState } from "./use-feedback"

const FeedbackContext = React.createContext<FeedbackState | null>(null)

/**
 * Owns the feedback poll for the answered question. Polling re-renders only
 * this provider and the two parts that read it (the sheet and the details);
 * the rest of the question screen arrives as `children`, which React leaves
 * alone when only this provider's state changes.
 */
export function FeedbackProvider({ attemptId, children }: { attemptId: string | null; children: React.ReactNode }) {
  const feedback = useFeedback(attemptId)
  return <FeedbackContext.Provider value={feedback}>{children}</FeedbackContext.Provider>
}

function useQuestionFeedback(): FeedbackState {
  const value = React.useContext(FeedbackContext)
  if (!value) throw new Error("Question feedback is read inside FeedbackProvider.")
  return value
}

export interface Verdict {
  title: string
  tone: FeedbackTone
}

const SCORE_TITLES: Record<SelfScore, Verdict> = {
  CORRECT: { title: "Correct", tone: "correct" },
  PARTIAL: { title: "Partly correct", tone: "neutral" },
  INCORRECT: { title: "Incorrect", tone: "wrong" },
}

/** The sheet's title: the recorded score, "Pretest done", or "Answer saved" when no score came back. */
export function verdictFor(outcome: Pick<Outcome, "score">, isPretest: boolean): Verdict {
  if (isPretest) return { title: "Pretest done", tone: "neutral" }
  return outcome.score ? SCORE_TITLES[outcome.score] : { title: "Answer saved", tone: "neutral" }
}

/** The pretest line in the sheet: trying first is the point, so the model answer comes next. */
export function pretestNote(correct: boolean, modelAnswerShown: boolean): string {
  if (correct) return "You already knew this one."
  return modelAnswerShown
    ? "Read the model answer now: trying first helps it stick."
    : "Trying first helps this topic stick when you study it."
}

/**
 * The bar that slides up after an answer, kept to what fits at a glance:
 * the verdict, the correct choice when the answer was wrong, one short
 * note, and the takeaway. Everything longer reads below the question.
 */
export function QuestionFeedbackSheet({
  verdict,
  correct,
  correctChoice,
  note,
  continueLabel,
  continueLoading,
  onContinue,
}: {
  verdict: Verdict
  /** The recorded score was Correct: the sheet then adds only a takeaway. */
  correct: boolean
  /** The correct choice, shown when a multiple-choice answer was wrong. */
  correctChoice: string | null
  /** One short line: the pretest note, or a result that didn't load. */
  note: string | null
  continueLabel: string
  continueLoading: boolean
  onContinue: () => void
}) {
  const { status, feedback } = useQuestionFeedback()
  const summary = status === "ready" ? feedbackSummary(feedback, correct) : null
  const hasBody = Boolean(correctChoice || note || summary)

  return (
    <FeedbackSheet
      tone={verdict.tone}
      title={verdict.title}
      continueLabel={continueLabel}
      onContinue={onContinue}
      continueLoading={continueLoading}
    >
      {hasBody ? (
        <>
          {correctChoice ? (
            <p data-testid="mcq-result" className="type-body-l font-bold">
              Correct answer: <InlineText>{correctChoice}</InlineText>
            </p>
          ) : null}
          {note ? <p className="type-body-l font-medium">{note}</p> : null}
          {summary ? (
            <div className="flex flex-col gap-1">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 type-label-l font-bold">
                <LightbulbIcon aria-hidden="true" className="size-4 shrink-0" />
                {summary.kind === "takeaway" ? "Takeaway" : "Explanation"}
                <AiTag />
              </p>
              <p className={summary.kind === "takeaway" ? "type-body-m font-medium" : "line-clamp-2 type-body-m font-medium"}>
                {summary.text}
              </p>
            </div>
          ) : null}
        </>
      ) : null}
    </FeedbackSheet>
  )
}

/** The full feedback, in the page below the answered question. */
export function QuestionFeedbackDetails(props: {
  score: SelfScore | null
  mcq: McqResult | null
  confidentError: boolean
  correctionRule: string
  similarQuestion: string
  reflection: ReflectionProps | null
}) {
  const feedback = useQuestionFeedback()
  return <FeedbackBody {...props} feedback={feedback} />
}
