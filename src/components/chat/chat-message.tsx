"use client"

import * as React from "react"
import Link from "next/link"
import { ChevronDownIcon, InfoIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { AppMark } from "@/components/shell/app-mark"
import { AiTag } from "@/components/app/ai-tag"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import type { ChatMessage, ChatSource } from "@/components/chat/chat-types"

// The Markdown renderer (react-markdown, remark-gfm) is the largest part of
// Chat's JavaScript and isn't needed until answers arrive, which is after
// the page hydrates. ChatScreen starts loading it on mount.
const loadAnswerMarkdown = () => import("@/components/chat/answer-markdown")
const AnswerMarkdown = React.lazy(() => loadAnswerMarkdown().then((m) => ({ default: m.AnswerMarkdown })))

/** Starts loading the answer renderer so it's ready when the history is. */
export function preloadAnswerMarkdown() {
  void loadAnswerMarkdown()
}

/** The student's question, right-aligned like a sent message. */
export const QuestionBubble = React.memo(function QuestionBubble({
  content,
  pending = false,
}: {
  content: string
  pending?: boolean
}) {
  return (
    <article aria-label="You asked" className="flex scroll-mt-24 justify-end">
      <p
        className={cn(
          "max-w-[85%] rounded-3xl rounded-br-md bg-surface-container-high px-4 py-2.5 type-body-l whitespace-pre-wrap text-on-surface [overflow-wrap:anywhere]",
          pending && "opacity-80"
        )}
      >
        {content}
      </p>
    </article>
  )
})

function AnswerHeader({ ai }: { ai: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <AppMark className="size-6" />
      <span className="type-label-l text-on-surface">Study Bot</span>
      {ai ? <AiTag /> : null}
    </div>
  )
}

/** An AI answer: Markdown with inline source links, then the numbered sources. */
export const AnswerBlock = React.memo(function AnswerBlock({ message }: { message: ChatMessage }) {
  const [open, setOpen] = React.useState<ReadonlySet<number>>(() => new Set())
  const baseId = `src-${message.id}`
  const idFor = React.useCallback((n: number) => `${baseId}-${n}`, [baseId])

  const openSource = React.useCallback(
    (n: number) => {
      setOpen((prev) => new Set(prev).add(n))
      // Wait for the quote to render, then bring the source into view.
      requestAnimationFrame(() => {
        const el = document.getElementById(idFor(n))
        el?.scrollIntoView({ block: "nearest" })
        el?.focus({ preventScroll: true })
      })
    },
    [idFor]
  )

  const toggle = (n: number) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(n)) next.delete(n)
      else next.add(n)
      return next
    })

  return (
    <article aria-label="Study Bot answered" className="flex scroll-mt-24 flex-col gap-3">
      <AnswerHeader ai />
      <React.Suspense
        fallback={
          <p className="type-body-l whitespace-pre-wrap text-on-surface [overflow-wrap:anywhere]">{message.content}</p>
        }
      >
        <AnswerMarkdown content={message.content} sources={message.sources} idFor={idFor} onOpenSource={openSource} />
      </React.Suspense>
      {message.sources.length > 0 ? (
        <SourceList sources={message.sources} idFor={idFor} open={open} onToggle={toggle} headingId={`${baseId}-heading`} />
      ) : (
        <p className="type-body-m text-on-surface-variant">
          No sources listed for this answer. Check it against your materials before you rely on it.
        </p>
      )}
    </article>
  )
})

function SourceList({
  sources,
  idFor,
  open,
  onToggle,
  headingId,
}: {
  sources: ChatSource[]
  idFor: (n: number) => string
  open: ReadonlySet<number>
  onToggle: (n: number) => void
  headingId: string
}) {
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <h4 id={headingId} className="type-label-l text-on-surface-variant">
        Sources ({sources.length})
      </h4>
      <ol className="flex flex-col">
        {sources.map((source) => {
          const expanded = open.has(source.n)
          const panelId = `${idFor(source.n)}-quote`
          return (
            <li key={source.n} className="flex flex-col">
              <button
                id={idFor(source.n)}
                type="button"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => onToggle(source.n)}
                className="state-layer relative isolate -mx-2 flex min-h-11 items-center gap-3 rounded-xl px-2 py-1.5 text-left [--focus-ring-offset:-2px]"
              >
                <span
                  aria-hidden="true"
                  className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary-container type-label-m text-on-secondary-container tabular-nums"
                >
                  {source.n}
                </span>
                <span className="min-w-0 flex-1 type-body-m text-on-surface">
                  <span className="sr-only">Source {source.n}: </span>
                  {source.title ?? "A file no longer in your materials"}
                  {source.page ? <span className="text-on-surface-variant">, page {source.page}</span> : null}
                </span>
                <ChevronDownIcon
                  aria-hidden="true"
                  className={cn(
                    "size-5 shrink-0 text-on-surface-variant transition-transform duration-150 ease-standard",
                    expanded && "rotate-180"
                  )}
                />
              </button>
              <div id={panelId} hidden={!expanded} className="pb-2 pl-9">
                {source.quote ? (
                  <blockquote className="rounded-xl bg-surface-container px-4 py-3 type-body-m text-on-surface">
                    {source.quote}
                  </blockquote>
                ) : null}
                {source.missing ? (
                  <p className="pt-1 type-body-s text-on-surface-variant">
                    This file was removed from your materials after the answer.
                  </p>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/** The app's own line when retrieval finds nothing (not AI text, so no tag). */
export const NoticeBlock = React.memo(function NoticeBlock({ content }: { content: string }) {
  return (
    <article aria-label="Study Bot answered" className="flex scroll-mt-24 flex-col gap-3">
      <AnswerHeader ai={false} />
      <div className="flex items-start gap-3 rounded-2xl bg-surface-container px-4 py-3">
        <InfoIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-on-surface-variant" />
        <div className="flex flex-col gap-1">
          <p className="type-body-l text-on-surface">{content}</p>
          <Button asChild variant="link" className="self-start">
            <Link href="/plan/materials">Upload materials</Link>
          </Button>
        </div>
      </div>
    </article>
  )
})

/** A question without an answer: the failure and, for the latest one, a way to ask again. */
export function UnansweredRow({
  error,
  onRetry,
  retrying,
}: {
  error?: string
  /** Only the latest question can be asked again (its answer would land last). */
  onRetry?: () => void
  retrying?: boolean
}) {
  return (
    <div role={error ? "alert" : undefined} className="flex flex-wrap items-center gap-x-3 gap-y-1 type-body-m text-on-surface-variant">
      <span className={cn(error && "text-error")}>{error ?? "No answer was saved for this question."}</span>
      {onRetry ? (
        <Button variant="text" size="sm" className="-ml-3" onClick={onRetry} disabled={retrying}>
          Retry
        </Button>
      ) : null}
    </div>
  )
}

/** Shown while an answer is on its way. */
export function SearchingRow({ courseName }: { courseName: string }) {
  return (
    <div className="flex flex-col gap-3">
      <AnswerHeader ai={false} />
      <p className="flex items-center gap-3 type-body-l text-on-surface-variant">
        <Spinner aria-hidden="true" role={undefined} className="size-5 text-primary" />
        Searching your {courseName} materials…
      </p>
    </div>
  )
}

