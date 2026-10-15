"use client"

import * as React from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

import type { ChatSource } from "@/components/chat/chat-types"

/**
 * Renders an AI answer's Markdown with the app's type scale, and turns
 * inline markers like "[2]" into links to numbered source 2 under the
 * answer. Raw HTML in the Markdown is not rendered.
 */

interface MdNode {
  type: string
  value?: string
  children?: MdNode[]
  data?: { hName?: string; hProperties?: Record<string, unknown> }
}

const MARKER = /\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g
const HAS_MARKER = /\[\d/

/** remark plugin: split text nodes at citation markers into `cite-ref` elements. */
function remarkCitations(options: { count: number }) {
  return (tree: MdNode) => {
    const visit = (node: MdNode) => {
      if (!node.children) return
      if (node.type === "link" || node.type === "linkReference" || node.type === "code" || node.type === "inlineCode") return
      const next: MdNode[] = []
      for (const child of node.children) {
        if (child.type !== "text" || !child.value || !HAS_MARKER.test(child.value)) {
          visit(child)
          next.push(child)
          continue
        }
        let last = 0
        for (const match of child.value.matchAll(MARKER)) {
          const index = match.index ?? 0
          const numbers = match[1].split(",").map((n) => Number(n.trim()))
          if (!numbers.every((n) => n >= 1 && n <= options.count)) continue
          if (index > last) next.push({ type: "text", value: child.value.slice(last, index) })
          for (const n of numbers) {
            next.push({ type: "citeRef", data: { hName: "cite-ref", hProperties: { n } } })
          }
          last = index + match[0].length
        }
        if (last < child.value.length) next.push({ type: "text", value: child.value.slice(last) })
      }
      node.children = next
    }
    visit(tree)
  }
}

const SourceLinkContext = React.createContext<{
  sources: ChatSource[]
  idFor: (n: number) => string
  onOpen: (n: number) => void
} | null>(null)

export function sourceLabel(source: ChatSource): string {
  const title = source.title ?? "A file no longer in your materials"
  return source.page ? `${title}, page ${source.page}` : title
}

function CiteRef({ n }: { n: number }) {
  const ctx = React.useContext(SourceLinkContext)
  const source = ctx?.sources[n - 1]
  if (!ctx || !source) return <>[{n}]</>
  return (
    <a
      href={`#${ctx.idFor(n)}`}
      aria-label={`Source ${n}: ${sourceLabel(source)}`}
      onClick={(event) => {
        event.preventDefault()
        ctx.onOpen(n)
      }}
      className="mx-0.5 inline-flex h-5 min-w-5 -translate-y-px items-center justify-center rounded-full bg-secondary-container px-1.5 align-baseline type-label-s text-on-secondary-container no-underline tabular-nums hover:bg-primary hover:text-on-primary"
    >
      {n}
    </a>
  )
}

const components: Components = {
  p: ({ children }) => <p className="text-pretty">{children}</p>,
  h1: ({ children }) => <h4 className="type-title-m text-on-surface">{children}</h4>,
  h2: ({ children }) => <h4 className="type-title-m text-on-surface">{children}</h4>,
  h3: ({ children }) => <h4 className="type-title-s text-on-surface">{children}</h4>,
  h4: ({ children }) => <h5 className="type-title-s text-on-surface">{children}</h5>,
  h5: ({ children }) => <h5 className="type-label-l text-on-surface">{children}</h5>,
  h6: ({ children }) => <h5 className="type-label-l text-on-surface">{children}</h5>,
  ul: ({ children }) => <ul className="flex list-disc flex-col gap-1.5 pl-6 marker:text-on-surface-variant">{children}</ul>,
  ol: ({ children }) => <ol className="flex list-decimal flex-col gap-1.5 pl-6 marker:text-on-surface-variant">{children}</ol>,
  li: ({ children }) => <li className="pl-1">{children}</li>,
  strong: ({ children }) => <strong className="font-medium text-on-surface">{children}</strong>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-4">
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="flex flex-col gap-2 border-l border-outline-variant pl-4 text-on-surface-variant">
      {children}
    </blockquote>
  ),
  code: ({ className, children }) => {
    const block = /language-/.test(className ?? "")
    return block ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded-sm bg-surface-container-high px-1 py-0.5 font-mono text-[0.9em]">{children}</code>
    )
  },
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-xl bg-surface-container p-4 font-mono type-body-m">{children}</pre>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto rounded-xl border border-outline-variant">
      <table className="w-full border-collapse type-body-m">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-outline-variant bg-surface-container px-3 py-2 text-left type-label-l">{children}</th>
  ),
  td: ({ children }) => <td className="border-b border-outline-variant px-3 py-2 align-top">{children}</td>,
  hr: () => <hr className="border-outline-variant" />,
}

const extendedComponents = {
  ...components,
  "cite-ref": ({ n }: { n: number }) => <CiteRef n={Number(n)} />,
} as Components

export function AnswerMarkdown({
  content,
  sources,
  idFor,
  onOpenSource,
}: {
  content: string
  sources: ChatSource[]
  /** Element id of source n, for the inline links. */
  idFor: (n: number) => string
  onOpenSource: (n: number) => void
}) {
  const plugins = React.useMemo(
    () => [remarkGfm, [remarkCitations, { count: sources.length }]] as NonNullable<React.ComponentProps<typeof ReactMarkdown>["remarkPlugins"]>,
    [sources.length]
  )
  const ctx = React.useMemo(() => ({ sources, idFor, onOpen: onOpenSource }), [sources, idFor, onOpenSource])
  return (
    <SourceLinkContext.Provider value={ctx}>
      <div className="flex min-w-0 flex-col gap-3 type-body-l text-on-surface [overflow-wrap:anywhere]">
        <ReactMarkdown remarkPlugins={plugins} components={extendedComponents}>
          {content}
        </ReactMarkdown>
      </div>
    </SourceLinkContext.Provider>
  )
}
