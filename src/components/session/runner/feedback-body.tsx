"use client"

import * as React from "react"
import { BookOpenIcon, TriangleAlertIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { ErrorState } from "@/components/app/error-state"
import { LoadingRegion } from "@/components/app/skeletons"
import { Skeleton } from "@/components/ui/skeleton"
import { FreeRecallInput } from "@/components/lesson/free-recall-input"

import { AiTag } from "./parts"
import { highlightSnippet, sourceLabel } from "./question-kind"
import { RichText, type Citations } from "./rich-text"
import type { FeedbackFailure, FeedbackState } from "./use-feedback"
import type { FeedbackSource, McqResult, SelfScore } from "./types"

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

/** The numbered passages behind the explanation, as a plain list. */
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
    <section aria-labelledby={id} className="flex flex-col gap-1">
      <SectionTitle id={id}>Sources</SectionTitle>
      <ol className="flex flex-col">
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
              className="flex flex-col gap-1.5 border-t border-current/15 py-3 outline-none first:border-t-0"
            >
              <p className="flex items-start gap-2 type-label-l font-bold">
                {/* The cited source's number fills in, like its citation button. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full type-label-m font-bold tabular-nums transition-colors duration-150 ease-standard",
                    active === n
                      ? "bg-lesson-selected-border text-lesson-on-primary"
                      : "bg-lesson-selected text-lesson-on-selected"
                  )}
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
              <blockquote className="pl-8 type-body-m font-medium break-words text-lesson-neutral-text">
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

/** Each reason feedback isn't here gets its own words; the answer is always saved. */
const FAILURE_COPY: Record<FeedbackFailure, { title: string; description: string }> = {
  unavailable: { title: "Feedback isn't available for this question.", description: "Your answer is saved." },
  load: { title: "Feedback didn't load.", description: "Your answer is saved. Check your connection, then retry." },
  slow: {
    title: "Feedback is taking longer than usual.",
    description: "Your answer is saved. Retry to check again.",
  },
}

export interface ReflectionProps {
  open: boolean
  onToggle: () => void
  correct: boolean
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
function Reflection({ socraticQuestion, ...props }: ReflectionProps & { socraticQuestion: string | null }) {
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
          {socraticQuestion ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h3 className="type-title-s font-bold">Question to consider</h3>
                <AiTag />
              </div>
              <p className="type-body-l font-medium">{socraticQuestion}</p>
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
 * The feedback that reads below the answered question, in the page's own
 * scroll: why the wrong choice is tempting, the confident-error note, the
 * AI explanation with numbered sources, the notes, the student's own
 * correction and the reflection. The feedback sheet keeps only the verdict
 * and a one-line summary, so it never covers this. Feedback states
 * (loading, nothing in the materials, failed) are distinct.
 */
export function FeedbackBody({
  score,
  mcq,
  confidentError,
  feedback: state,
  correctionRule,
  similarQuestion,
  reflection,
}: {
  score: SelfScore | null
  mcq: McqResult | null
  confidentError: boolean
  feedback: FeedbackState
  correctionRule: string
  similarQuestion: string
  reflection: ReflectionProps | null
}) {
  const [activeSource, setActiveSource] = React.useState<number | null>(null)
  const sourceRefs = React.useRef(new Map<number, HTMLLIElement>())
  const headingId = React.useId()
  const explanationId = React.useId()
  const correctionId = React.useId()
  const { status, failure, feedback } = state
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
  const rationale = mcq && !mcq.is_correct ? mcq.rationale?.trim() : undefined
  const hasStatus = status === "loading" || status === "failed" || status === "ready" || (status === "empty" && !correct)

  if (!hasStatus && !rationale && !confidentError && !hasCorrection && !reflection) return null

  return (
    <section
      aria-labelledby={headingId}
      data-testid="review-panel"
      // Enter inside the feedback acts on what's focused here, never "Next question".
      data-feedback-details=""
      // Anything scrolled to or focused here stays clear of the sticky top
      // bar and of the feedback sheet (up to about a third of a phone screen).
      className="flex flex-col gap-6 text-lesson-on-surface **:scroll-mt-28 **:scroll-mb-[max(18rem,40dvh)]"
    >
      {/* Names the region for screen readers without a visible label
          stacked over the Explanation heading. */}
      <h2 id={headingId} className="sr-only">
        Feedback from your materials
      </h2>

      {confidentError ? (
        <div data-testid="hypercorrection-badge" className="flex items-start gap-2">
          <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-lesson-on-wrong" />
          <div className="flex flex-col gap-1">
            <h3 className="type-body-m font-bold">Confident error</h3>
            <p className="type-body-m font-medium text-lesson-neutral-text">
              You marked this Sure. Errors made with high confidence are often corrected well right after feedback,
              then return later, so this question comes back on another day.
            </p>
          </div>
        </div>
      ) : null}

      {rationale ? (
        <section aria-labelledby={`${headingId}-tempting`} className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 id={`${headingId}-tempting`} className="type-title-s font-bold">
              Why your answer is tempting
            </h3>
            <AiTag />
          </div>
          <p className="type-body-m font-medium text-lesson-neutral-text">{rationale}</p>
        </section>
      ) : null}

      {status === "loading" ? <FeedbackLoading /> : null}

      {status === "failed" ? (
        <ErrorState {...FAILURE_COPY[failure ?? "unavailable"]} onRetry={state.retry} retrying={state.retrying} />
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
            {correct ? "Why it's correct" : "Explanation"}
          </SectionTitle>
          <p className="type-body-m text-lesson-muted">
            {/* Feedback saved before every note carried its sources can lack them: say so, never imply a source. */}
            {sources.length > 0
              ? "Written by AI from your materials. Check it against the numbered sources."
              : "Written by AI. No passage from your materials was used, so check it against your notes."}
          </p>
          <RichText className="type-body-l font-medium" citations={citations}>
            {mainText}
          </RichText>
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
          <p className="type-body-m text-lesson-muted">Say the correct answer out loud once before you move on.</p>
        </section>
      ) : null}

      {reflection ? <Reflection {...reflection} socraticQuestion={feedback?.socratic_followup ?? null} /> : null}
    </section>
  )
}
