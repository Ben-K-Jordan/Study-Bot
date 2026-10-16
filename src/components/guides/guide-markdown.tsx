"use client"

import Markdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

import { cn } from "@/lib/utils"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

interface MdNode {
  type: string
  value?: string
  children?: MdNode[]
}

/**
 * Single line breaks become real breaks. Guides store cheat-sheet lines
 * separated by "\n", which plain Markdown would run together into one
 * paragraph. Code and table cells are untouched (they hold no text nodes
 * with newlines).
 */
function splitSoftBreaks(node: MdNode) {
  if (!node.children) return
  const next: MdNode[] = []
  for (const child of node.children) {
    if (child.type === "text" && child.value?.includes("\n")) {
      child.value.split("\n").forEach((part, index) => {
        if (index > 0) next.push({ type: "break" })
        if (part) next.push({ type: "text", value: part })
      })
    } else {
      splitSoftBreaks(child)
      next.push(child)
    }
  }
  node.children = next
}

function remarkSoftBreaks() {
  return (tree: MdNode) => splitSoftBreaks(tree)
}

const REMARK_PLUGINS = [remarkGfm, remarkSoftBreaks]

// Headings inside a section sit below the section's h3.
const components: Components = {
  h1: ({ children }) => <h4 className="mt-2 type-title-s text-on-surface">{children}</h4>,
  h2: ({ children }) => <h4 className="mt-2 type-title-s text-on-surface">{children}</h4>,
  h3: ({ children }) => <h4 className="mt-2 type-title-s text-on-surface">{children}</h4>,
  h4: ({ children }) => <h4 className="mt-2 type-title-s text-on-surface">{children}</h4>,
  h5: ({ children }) => <h5 className="mt-2 type-label-l text-on-surface">{children}</h5>,
  h6: ({ children }) => <h5 className="mt-2 type-label-l text-on-surface">{children}</h5>,
  p: ({ children }) => <p className="text-pretty">{children}</p>,
  ul: ({ children }) => <ul className="flex list-disc flex-col gap-1 pl-6 marker:text-on-surface-variant">{children}</ul>,
  ol: ({ children }) => <ol className="flex list-decimal flex-col gap-1 pl-6 marker:text-on-surface-variant">{children}</ol>,
  li: ({ children }) => <li className="pl-1">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-on-surface">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  // Guides are AI-written, so a link could point anywhere: show its text only.
  a: ({ children }) => <span className="underline decoration-current/40 underline-offset-2">{children}</span>,
  blockquote: ({ children }) => (
    <blockquote className="flex flex-col gap-2 border-l border-outline pl-4 text-on-surface-variant">{children}</blockquote>
  ),
  hr: () => <Separator className="my-2" />,
  // No remote images in guides: show the description instead.
  img: ({ alt }) => (alt ? <span className="text-on-surface-variant">{alt}</span> : null),
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-xl bg-surface-container p-4 font-mono type-body-m text-on-surface [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
  code: ({ children, className }) => (
    <code className={cn("rounded-sm bg-surface-container px-1 py-0.5 font-mono text-on-surface", className)}>
      {children}
    </code>
  ),
  table: ({ children }) => (
    <div className="overflow-hidden rounded-xl ring-1 ring-border">
      <Table>{children}</Table>
    </div>
  ),
  thead: ({ children }) => <TableHeader className="bg-surface-container">{children}</TableHeader>,
  tbody: ({ children }) => <TableBody>{children}</TableBody>,
  tr: ({ children }) => <TableRow>{children}</TableRow>,
  th: ({ children, style }) => (
    <TableHead className="h-10 px-3 text-left type-label-l text-on-surface" style={style}>
      {children}
    </TableHead>
  ),
  td: ({ children, style }) => (
    <TableCell className="px-3 py-2 align-top whitespace-normal" style={style}>
      {children}
    </TableCell>
  ),
}

/**
 * Guide text as Markdown (GFM: tables, lists, code in the mono font). Raw
 * HTML in the text stays escaped, and link URLs pass react-markdown's
 * default sanitizer.
 */
export default function GuideMarkdown({
  text,
  tone = "default",
}: {
  text: string
  /** "muted" for supporting lines such as "Why it matters". */
  tone?: "default" | "muted"
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-3",
        tone === "muted" ? "type-body-m text-on-surface-variant" : "type-body-l text-on-surface"
      )}
    >
      <Markdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {text}
      </Markdown>
    </div>
  )
}
