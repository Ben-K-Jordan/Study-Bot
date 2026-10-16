"use client"

import * as React from "react"
import Markdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

import { CITATION_HREF, rehypeKeepCitationsWithText } from "@/lib/rehype-keep-citations"
import { cn } from "@/lib/utils"

import { linkCitations } from "./question-kind"

export interface Citations {
  count: number
  /** Accessible name for source n: "Source 2: Lecture 5, page 3". */
  label: (n: number) => string
  active: number | null
  onCite: (n: number) => void
}

function blockComponents(citations?: Citations): Components {
  return {
    p: ({ children }) => <p className="whitespace-pre-line">{children}</p>,
    // AI text sometimes carries its own headings; they read as bold lines so
    // the page's heading outline stays the screen's.
    h1: ({ children }) => <p className="font-bold">{children}</p>,
    h2: ({ children }) => <p className="font-bold">{children}</p>,
    h3: ({ children }) => <p className="font-bold">{children}</p>,
    h4: ({ children }) => <p className="font-bold">{children}</p>,
    h5: ({ children }) => <p className="font-bold">{children}</p>,
    h6: ({ children }) => <p className="font-bold">{children}</p>,
    ul: ({ children }) => <ul className="flex list-disc flex-col gap-1 pl-5">{children}</ul>,
    ol: ({ children }) => <ol className="flex list-decimal flex-col gap-1 pl-5">{children}</ol>,
    blockquote: ({ children }) => <blockquote className="flex flex-col gap-2 pl-4 italic">{children}</blockquote>,
    pre: ({ children }) => (
      <pre className="max-w-full overflow-x-auto rounded-xl bg-lesson-option-hover p-3 font-mono text-sm leading-6 text-lesson-on-surface">
        {children}
      </pre>
    ),
    code: ({ children, className }) => (
      <code
        className={cn(
          "font-mono text-[0.9em]",
          // Inline code gets a chip; fenced code is styled by <pre>
          !className && "rounded-sm bg-lesson-option-hover px-1 py-0.5 text-lesson-on-surface",
          className
        )}
      >
        {children}
      </code>
    ),
    table: ({ children }) => (
      <div className="max-w-full overflow-x-auto">
        <table className="w-full border-collapse text-left type-body-m">{children}</table>
      </div>
    ),
    th: ({ children }) => <th className="border-b border-current/20 px-2 py-1 font-bold">{children}</th>,
    td: ({ children }) => <td className="border-b border-current/10 px-2 py-1 align-top">{children}</td>,
    img: () => null,
    a: ({ href, children }) => {
      const match = href?.match(CITATION_HREF)
      if (match && citations) {
        const n = Number(match[1])
        return <CitationButton n={n} citations={citations} />
      }
      // Links in generated text are shown as text, never followed.
      return <span className="underline decoration-current/40 underline-offset-2">{children}</span>
    },
  }
}

function CitationButton({ n, citations }: { n: number; citations: Citations }) {
  const active = citations.active === n
  return (
    <button
      type="button"
      aria-label={citations.label(n)}
      aria-controls={`source-${n}`}
      aria-pressed={active}
      onClick={() => citations.onCite(n)}
      // A small margin on the left only (the space before it already
      // separates it from the word), so the punctuation after a citation
      // hugs it ("revisits it [1]."), and no taller than the line it sits in.
      className={cn(
        "ml-0.5 inline-flex size-5 items-center justify-center rounded-full align-[0.1em] type-label-s font-bold tabular-nums transition-colors duration-150 ease-standard",
        active
          ? "bg-lesson-selected-border text-lesson-on-primary"
          : "bg-lesson-selected text-lesson-on-selected hover:bg-lesson-selected-border hover:text-lesson-on-primary"
      )}
    >
      {n}
    </button>
  )
}

/**
 * Markdown from the student's materials or from AI (explanations, model
 * answers, longer questions), drawn with the lesson's type. Raw HTML is
 * never rendered; [n] citations become buttons that point at the numbered
 * sources.
 */
export function RichText({
  children,
  citations,
  className,
}: {
  children: string
  citations?: Citations
  className?: string
}) {
  const text = citations ? linkCitations(children, citations.count) : children
  return (
    <div className={cn("flex min-w-0 flex-col gap-3 break-words", className)}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={citations ? [rehypeKeepCitationsWithText] : undefined}
        components={blockComponents(citations)}
      >
        {text}
      </Markdown>
    </div>
  )
}

const INLINE_ELEMENTS = ["p", "code", "em", "strong", "del"]

const inlineComponents: Components = {
  p: ({ children }) => <>{children}</>,
  code: ({ children }) => <code className="rounded-sm bg-lesson-option-hover px-1 font-mono text-[0.9em]">{children}</code>,
}

/**
 * One line inside a heading or an answer option. Only text with `code`
 * goes through markdown: a bare "a * b * c" in a math question must not
 * turn into emphasis.
 */
export function InlineText({ children }: { children: string }) {
  if (!/`[^`]+`/.test(children)) return <>{children}</>
  return (
    <Markdown allowedElements={INLINE_ELEMENTS} unwrapDisallowed components={inlineComponents}>
      {children}
    </Markdown>
  )
}
