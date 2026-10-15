"use client"

import * as React from "react"
import { BookOpenIcon, LightbulbIcon, TriangleAlertIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { ErrorState } from "@/components/app/error-state"
import { LoadingRegion } from "@/components/app/skeletons"
import { Skeleton } from "@/components/ui/skeleton"
import { FreeRecallInput } from "@/components/lesson/free-recall-input"

import { AiTag } from "./parts"
import { highlightSnippet, sourceLabel } from "./question-kind"
import { RichText, type Citations } from "./rich-text"
import type { FeedbackStatus } from "./use-feedback"
import type { FeedbackPayload, FeedbackSource, McqResult, SelfScore } from "./types"

/** Respect reduced motion when moving the view to a cited source. */
function scrollBehavior(): ScrollBehavior {
  if (typeof window === "undefined") return "auto"
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
}

function SectionTitle({ id, children, ai = false }: { id: string; children: React.ReactNode; ai?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <h3 id={id} className="type-title-m font-bold">
        {children}
      </h3>
      {ai ? <AiTag /> : null}
    </div>
  )
}

function Sources({
  sources,
  active,
  sourceRefs,
}: {
  sources: FeedbackSource[]
  active: number | null
  sourceRefs: React.RefObject<Map<number, HTMLLIElement>>
}) {
  const id = React.useId()
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <SectionTitle id={id}>Sources</SectionTitle>
      <ol className="flex flex-col gap-3">
        {sources.map((source, i) => {
          const n = i + 1
          return (
            <li
              key={source.chunk_id}
              id={`source-${n}`}
              tabIndex={-1}
              ref={(el) => {
                if (el) sourceRefs.current.set(n, el)
                else sourceRefs.current.delete(n)
              }}
              className={cn(
                "flex flex-col gap-2 rounded-2xl bg-lesson-surface px-4 py-3 ring-1 ring-lesson-option-border transition-shadow duration-150 ease-standard outline-none",
                active === n && "ring-2 ring-lesson-selected-border"
              )}
            >
              <p className="flex items-start gap-2 type-label-l font-bold">
                <span
                  aria-hidden="true"
                  className="flex size-6 shrink-0 items-center justify-center rounded-full bg-lesson-selected type-label-m font-bold text-lesson-on-selected tabular-nums"
                >
                  {n}
                </span>
                <span className="min-w-0 pt-0.5">
                  <span className="sr-only">Source {n}: </span>
                  <span data-testid="excerpt-doc-title">{source.doc_title}</span>
                  {source.page_number && source.page_number > 0 ? (
                    <span className="font-medium text-lesson-muted">, page {source.page_number}</span>
                  ) : null}
                </span>
              </p>
              <blockquote className="type-body-m font-medium break-words text-lesson-neutral-text">
                {highlightSnippet(source.snippet).map((segment, k) =>
                  segment.mark ? (
                    <mark key={k} className="rounded-sm bg-lesson-selected px-0.5 text-lesson-on-selected">
                      {segment.text}
                    </mark>
                  ) : (
                    <React.Fragment key={k}>{segment.text}</React.Fragment>
                  )
                )}
              </blockquote>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/** A short AI-written note: More context, Connection, Memory aid, Pattern. */
function Note({ title, children }: { title: string; children: string }) {
  const id = React.useId()
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 id={id} className="type-title-s font-bold">
          {title}
        </h3>
        <AiTag />
      </div>
      <RichText className="type-body-m font-medium">{children}</RichText>
    </section>
  )
}

function FeedbackLoading() {
  return (
    <LoadingRegion label="Loading feedback…" className="flex flex-col gap-2">
      <p data-testid="feedback-loading" className="type-body-m text-lesson-muted">
        Loading feedback…
      </p>
      <div aria-hidden="true" className="flex flex-col gap-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-3/5" />
      </div>
    </LoadingRegion>
  )
}

export interface ReflectionProps {
  open: boolean
  onToggle: () => void
  correct: boolean
  socraticQuestion: string | null
  selfExplanation: string
  socraticAnswer: string
  generatedExample: string
  onChange: (field: "selfExplanation" | "socraticAnswer" | "generatedExample", text: string) => void
  status: "idle" | "saving" | "failed"
  /** The sheet's button, which also retries a failed save. */
  continueLabel: string
}

/**
 * Self-explanation and the follow-up question, behind one quiet link. Saved
 * with the answer when the student moves on.
 */
function Reflection(props: ReflectionProps) {
  const panelId = React.useId()
  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        aria-expanded={props.open}
        aria-controls={panelId}
        onClick={props.onToggle}
        className="min-h-6 w-fit rounded-sm text-left type-label-l font-bold underline decoration-current/40 underline-offset-4 hover:decoration-current"
      >
        {props.open ? "Hide your explanation" : "Explain it in your own words"}
      </button>
      {props.open ? (
        <div id={panelId} className="flex flex-col gap-5">
          {props.socraticQuestion ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h3 className="type-title-s font-bold">Question to consider</h3>
                <AiTag />
              </div>
              <p className="type-body-l font-medium">{props.socraticQuestion}</p>
              <FreeRecallInput
                label="Your answer to the question (optional)"
                description=""
                value={props.socraticAnswer}
                onChange={(e) => props.onChange("socraticAnswer", e.target.value)}
                showSubmitHint={false}
              />
            </div>
          ) : null}
          <FreeRecallInput
            label="Your explanation (optional)"
            description="Explain the idea as if you were teaching it. Saved when you move on."
            value={props.selfExplanation}
            onChange={(e) => props.onChange("selfExplanation", e.target.value)}
            showSubmitHint={false}
          />
          {props.correct ? (
            <FreeRecallInput
              label="Your own example (optional)"
              description="A new case where this idea applies."
              value={props.generatedExample}
              onChange={(e) => props.onChange("generatedExample", e.target.value)}
              showSubmitHint={false}
            />
          ) : null}
          {props.status === "failed" ? (
            <p role="alert" className="type-body-m font-bold text-lesson-on-wrong">
              Reflection not saved. Your text is still here. Press {props.continueLabel} to retry, or clear the
              text to move on.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Everything the feedback sheet holds after an answer: the multiple-choice
 * result, the confident-error note, the pretest note, the AI explanation
 * with numbered sources, the student's own correction, and the reflection.
 * Feedback states (loading, nothing in the materials, failed) are distinct.
 */
export function FeedbackBody({
  score,
  mcq,
  mcqMissing,
  isPretest,
  modelAnswerShown,
  confidentError,
  status,
  feedback,
  onRetry,
  retrying,
  correctionRule,
  similarQuestion,
  reflection,
}: {
  score: SelfScore | null
  mcq: McqResult | null
  /** The multiple-choice result didn't come back with the saved answer. */
  mcqMissing: boolean
  isPretest: boolean
  /** A model answer is on screen above the sheet. */
  modelAnswerShown: boolean
  confidentError: boolean
  status: FeedbackStatus
  feedback: FeedbackPayload | null
  onRetry: () => void
  retrying: boolean
  correctionRule: string
  similarQuestion: string
  reflection: ReflectionProps | null
}) {
  const [activeSource, setActiveSource] = React.useState<number | null>(null)
  const sourceRefs = React.useRef(new Map<number, HTMLLIElement>())
  const explanationId = React.useId()
  const correctionId = React.useId()
  const sources = feedback?.excerpts ?? []
  const correct = score === "CORRECT"

  const citations: Citations = {
    count: sources.length,
    label: (n) => sourceLabel(n, sources[n - 1]),
    active: activeSource,
    onCite: (n) => {
      setActiveSource((current) => (current === n ? null : n))
      const el = sourceRefs.current.get(n)
      if (el) {
        el.scrollIntoView({ block: "nearest", behavior: scrollBehavior() })
        el.focus({ preventScroll: true })
      }
    },
  }

  const mainText = correct ? feedback?.reinforcement : feedback?.explanation
  const notes: { title: string; text: string | undefined }[] = [
    { title: "More context", text: feedback?.deeper_insight },
    { title: "Connection", text: feedback?.concept_connection },
    { title: "Memory aid", text: feedback?.mnemonic },
    { title: "Pattern", text: feedback?.pattern_advice },
  ]
  const hasCorrection = Boolean(correctionRule.trim() || similarQuestion.trim())

  return (
    <div data-testid="review-panel" className="flex flex-col gap-5 text-lesson-on-surface">
      {/* Names the group for screen readers (and the e2e suite) without a
          visible label stacked over the Explanation heading. */}
      {score !== null && !correct ? <h3 className="sr-only">Feedback from your materials</h3> : null}
      {mcq ? (
        <div data-testid="mcq-result" className="flex flex-col gap-1">
          {mcq.is_correct ? (
            <p className="sr-only">Your answer is right: {mcq.correct_choice}</p>
          ) : (
            <>
              <p className="type-body-l font-bold">Right answer: {mcq.correct_choice}</p>
              {mcq.rationale ? (
                <div className="flex flex-col gap-1 pt-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h3 className="type-title-s font-bold">Why your answer is tempting</h3>
                    <AiTag />
                  </div>
                  <p className="type-body-m font-medium text-lesson-neutral-text">{mcq.rationale}</p>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {mcqMissing ? (
        <p className="type-body-l font-medium">
          Your answer is saved, but its result didn&apos;t load. You&apos;ll see it with your session results.
        </p>
      ) : null}

      {confidentError ? (
        <div
          data-testid="hypercorrection-badge"
          className="flex items-start gap-3 rounded-2xl bg-lesson-surface px-4 py-3 ring-1 ring-lesson-option-border"
        >
          <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-lesson-on-wrong" />
          <div className="flex flex-col gap-1">
            <h3 className="type-title-s font-bold">Confident error</h3>
            <p className="type-body-m font-medium text-lesson-neutral-text">
              You marked this Sure. Errors made with high confidence are often corrected well right after feedback,
              then return later, so this question comes back on another day.
            </p>
          </div>
        </div>
      ) : null}

      {isPretest ? (
        <p className="type-body-l font-medium">
          {correct
            ? "You already knew this one."
            : modelAnswerShown
              ? "Read the model answer now: trying first helps it stick."
              : "Trying first helps this topic stick when you study it."}
        </p>
      ) : null}

      {status === "loading" ? <FeedbackLoading /> : null}

      {status === "failed" ? (
        <ErrorState
          title="Feedback isn't available for this question."
          description="Your answer is saved."
          onRetry={onRetry}
          retrying={retrying}
        />
      ) : null}

      {status === "empty" && !correct ? (
        <p data-testid="feedback-empty" className="flex items-start gap-2 type-body-m font-medium">
          <BookOpenIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          Your materials don&apos;t cover this question, so there&apos;s no sourced feedback.
        </p>
      ) : null}

      {status === "ready" && mainText ? (
        <section aria-labelledby={explanationId} className="flex flex-col gap-2">
          <SectionTitle id={explanationId} ai>
            {correct ? "Why it's right" : "Explanation"}
          </SectionTitle>
          <p className="type-body-m text-lesson-muted">
            {sources.length > 0
              ? "Written by AI from your materials. Check it against the numbered sources."
              : "Written by AI from your materials."}
          </p>
          <RichText className="type-body-l font-medium" citations={citations}>
            {mainText}
          </RichText>
          {feedback?.key_takeaway ? (
            <p className="flex items-start gap-2 type-body-l font-bold">
              <LightbulbIcon aria-hidden="true" className="mt-1 size-5 shrink-0" />
              <span>
                <span className="sr-only">Takeaway: </span>
                {feedback.key_takeaway}
              </span>
            </p>
          ) : null}
        </section>
      ) : null}

      {status === "ready" && sources.length > 0 ? (
        <Sources sources={sources} active={activeSource} sourceRefs={sourceRefs} />
      ) : null}

      {status === "ready"
        ? notes.map((note) => (note.text ? <Note key={note.title} title={note.title}>{note.text}</Note> : null))
        : null}

      {hasCorrection ? (
        <section aria-labelledby={correctionId} className="flex flex-col gap-1">
          <h3 id={correctionId} className="type-title-s font-bold">
            Your correction
          </h3>
          {correctionRule.trim() ? (
            <p className="type-body-l font-medium whitespace-pre-wrap">{correctionRule.trim()}</p>
          ) : null}
          {similarQuestion.trim() ? (
            <p className="type-body-m font-medium whitespace-pre-wrap text-lesson-neutral-text">
              Similar question: {similarQuestion.trim()}
            </p>
          ) : null}
          <p className="type-body-m text-lesson-muted">Say the right answer out loud once before you move on.</p>
        </section>
      ) : null}

      {reflection ? <Reflection {...reflection} /> : null}
    </div>
  )
}
