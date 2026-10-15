"use client"

import * as React from "react"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"

import { RichText } from "./rich-text"

/** The tag every block of AI-written text carries beside its heading. */
export function AiTag({ className }: { className?: string }) {
  return (
    <Badge variant="outline" className={cn("border-current/30 text-current", className)}>
      AI-written
    </Badge>
  )
}

/** A heading for one block of the lesson, with an optional AI tag. */
export function BlockHeading({
  id,
  as: Heading = "h2",
  ai = false,
  children,
  className,
}: {
  id?: string
  as?: "h2" | "h3"
  ai?: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      <Heading id={id} className="type-title-m font-bold">
        {children}
      </Heading>
      {ai ? <AiTag /> : null}
    </div>
  )
}

/** A quiet line of framing under the question: what kind of question this is. */
export function LessonNote({
  icon: Icon,
  children,
  className,
}: {
  icon: LucideIcon
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-2xl bg-lesson-option-hover px-4 py-3 type-body-m font-medium text-lesson-neutral-text",
        className
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-lesson-muted" />
      <div className="flex min-w-0 flex-col gap-1">{children}</div>
    </div>
  )
}

/** The student's own answer, read-only, after it is committed. */
export function AnswerEcho({
  answer,
  missingText = "Your saved answer didn't load.",
  className,
}: {
  answer: string | null
  missingText?: string
  className?: string
}) {
  const id = React.useId()
  return (
    <section aria-labelledby={id} className={cn("flex flex-col gap-2", className)}>
      <BlockHeading id={id}>Your answer</BlockHeading>
      {answer ? (
        <p className="rounded-2xl border-2 border-lesson-option-border px-4 py-3 type-body-l font-medium whitespace-pre-wrap break-words">
          {answer}
        </p>
      ) : (
        <p className="type-body-m text-lesson-muted">{missingText}</p>
      )}
    </section>
  )
}

/**
 * The standard to score against: the model answer and its points to check.
 * A repair question's standard is the student's own correction rule, which
 * is not AI-written.
 */
export function ModelAnswerCard({
  modelAnswer,
  keyPoints,
  ownRule = false,
  className,
}: {
  modelAnswer: string | null
  keyPoints: string[]
  ownRule?: boolean
  className?: string
}) {
  const id = React.useId()
  const pointsId = React.useId()
  if (!modelAnswer && keyPoints.length === 0) return null
  return (
    <section
      aria-labelledby={id}
      data-testid="model-answer"
      className={cn("flex flex-col gap-3 rounded-2xl bg-lesson-selected px-4 py-4 text-lesson-on-surface sm:px-5", className)}
    >
      <div className="flex flex-col gap-1">
        <BlockHeading id={id} ai={!ownRule}>
          {ownRule ? "Your correction rule" : "Model answer"}
        </BlockHeading>
        {ownRule ? null : (
          <p className="type-body-m text-lesson-muted">Written by AI from your materials.</p>
        )}
      </div>
      {modelAnswer ? <RichText className="type-body-l font-medium">{modelAnswer}</RichText> : null}
      {keyPoints.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 id={pointsId} className="type-title-s font-bold">
            Points to check
          </h3>
          <ul aria-labelledby={pointsId} className="flex list-disc flex-col gap-1 pl-5 type-body-l font-medium">
            {keyPoints.map((point, i) => (
              <li key={i}>{point}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

/** Placeholder in the shape of the model answer card, while it loads. */
export function ModelAnswerSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3 rounded-2xl bg-lesson-option-hover px-4 py-4 sm:px-5">
      <Skeleton className="h-5 w-36" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-4 w-3/5" />
    </div>
  )
}
