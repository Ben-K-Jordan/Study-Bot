"use client"

import { useEffect, useRef } from "react"
import dynamic from "next/dynamic"
import { DownloadIcon, PrinterIcon, Trash2Icon } from "lucide-react"

import { cn } from "@/lib/utils"
import { formatDate } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { AiTag } from "@/components/app/ai-tag"
import { ErrorBoundary } from "@/components/app/error-boundary"
import {
  guideFileName,
  guideFormat,
  guideToMarkdown,
  normalizeGuideSections,
  type GuideSection,
  type GuideType,
} from "@/lib/guide-format"
import type { StudyGuide } from "@/components/guides/types"

// The Markdown renderer (react-markdown, remark-gfm) loads with the first guide.
const GuideMarkdown = dynamic(() => import("@/components/guides/guide-markdown"), {
  loading: () => (
    <div aria-hidden="true" className="flex flex-col gap-2">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-4/5" />
    </div>
  ),
})

function sectionHeading(section: GuideSection, type: GuideType, index: number): string {
  if (type === "KEY_CONCEPTS") return section.concept ?? section.topic ?? `Concept ${index + 1}`
  if (type === "FAQ") return section.question ?? section.topic ?? `Question ${index + 1}`
  return section.topic ?? section.concept ?? `Topic ${index + 1}`
}

function sectionBody(section: GuideSection, type: GuideType): string {
  if (type === "KEY_CONCEPTS") return section.explanation ?? section.content ?? section.answer ?? ""
  if (type === "FAQ") return section.answer ?? section.content ?? section.explanation ?? ""
  return section.content ?? section.explanation ?? section.answer ?? ""
}

function GuideSections({ guide }: { guide: StudyGuide }) {
  const sections = normalizeGuideSections(guide.sections)
  if (sections.length === 0) {
    return <p className="type-body-l text-on-surface-variant">This guide has no content. Generate a new one.</p>
  }
  return (
    <ol
      className={cn(
        "flex flex-col divide-y divide-border",
        guide.guide_type === "CHEAT_SHEET" && "print:block print:columns-2 print:gap-8 print:divide-y-0"
      )}
    >
      {sections.map((section, index) => {
        const body = sectionBody(section, guide.guide_type)
        return (
          <li key={index} data-guide-section className="flex flex-col gap-3 py-5 first:pt-0 last:pb-0 print:py-3">
            <h3 className="type-title-l text-balance text-on-surface">{sectionHeading(section, guide.guide_type, index)}</h3>
            {body ? <GuideMarkdown text={body} /> : null}
            {guide.guide_type === "KEY_CONCEPTS" && section.importance ? (
              <GuideMarkdown text={`Why it matters: ${section.importance}`} tone="muted" />
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

export function exportGuide(guide: StudyGuide) {
  const markdown = guideToMarkdown({ title: guide.title, sections: normalizeGuideSections(guide.sections) })
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }))
  const link = document.createElement("a")
  link.href = url
  link.download = guideFileName(guide.title)
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoke after the download has started.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * One study guide, read like a document: title with the AI-written tag,
 * format and date, the disclosure line, actions, then the sections.
 * Marked data-guide-print so it prints alone.
 */
export function GuideArticle({
  guide,
  scopeName,
  timeZone,
  focusHeading,
  onFocused,
  onDelete,
}: {
  guide: StudyGuide
  /** "INFO 1300" or "Prelim 2": what the materials belong to. */
  scopeName: string
  timeZone?: string
  /** Move focus to the title once mounted (a new guide just arrived). */
  focusHeading?: boolean
  onFocused?: () => void
  onDelete: () => void
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const headingId = `guide-${guide.id}-title`
  const format = guideFormat(guide.guide_type)

  useEffect(() => {
    if (!focusHeading) return
    headingRef.current?.focus()
    onFocused?.()
  }, [focusHeading, onFocused])

  return (
    <article aria-labelledby={headingId} className="min-w-0">
      <Card data-guide-print className="gap-5 max-sm:[--card-spacing:--spacing(4)]">
        <CardHeader className="gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2
              id={headingId}
              ref={headingRef}
              tabIndex={-1}
              className="type-headline-s text-balance text-on-surface outline-none"
            >
              {guide.title}
            </h2>
            <AiTag />
          </div>
          <p className="type-body-m text-on-surface-variant tabular-nums">
            {format.label}
            <span aria-hidden="true" className="px-1.5 text-outline">
              ·
            </span>
            <span className="sr-only">, </span>
            {guide.exam_name ? `${guide.course_name} ${guide.exam_name}` : guide.course_name}
            <span aria-hidden="true" className="px-1.5 text-outline">
              ·
            </span>
            <span className="sr-only">, </span>
            {formatDate(guide.created_at, { timeZone })}
          </p>
          <p className="max-w-prose type-body-m text-pretty text-on-surface-variant">
            Written by AI from your {scopeName} materials. Check it against your files.
          </p>
        </CardHeader>

        <CardContent className="flex flex-wrap gap-2 print:hidden">
          <Button variant="outline" onClick={() => exportGuide(guide)}>
            <DownloadIcon data-icon="inline-start" aria-hidden="true" />
            Export guide (.md)
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <PrinterIcon data-icon="inline-start" aria-hidden="true" />
            Print guide
          </Button>
          <Button variant="ghost" onClick={onDelete}>
            <Trash2Icon data-icon="inline-start" aria-hidden="true" />
            Delete guide
          </Button>
        </CardContent>

        <Separator className="print:hidden" />

        <CardContent className="max-w-none">
          <ErrorBoundary title="This guide didn't display.">
            <GuideSections guide={guide} />
          </ErrorBoundary>
        </CardContent>
      </Card>
    </article>
  )
}
