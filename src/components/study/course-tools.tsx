"use client"

import Link from "next/link"
import {
  BookOpenTextIcon,
  ChevronRightIcon,
  FolderOpenIcon,
  LayersIcon,
  MessagesSquareIcon,
  type LucideIcon,
} from "lucide-react"

import { formatList, plural } from "@/lib/format"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/app/error-state"
import { SectionHeader } from "@/components/app/section-header"
import type { StudyCourseSummary } from "@/components/study/types"

interface Tool {
  href: string
  label: string
  icon: LucideIcon
  /** Supporting line; undefined while counts load, null when there is nothing to add. */
  detail: string | null | undefined
}

function flashcardDetail(course: StudyCourseSummary): string {
  if (course.deckCount === 0) return "No decks yet"
  const parts: string[] = []
  if (course.dueReviewCount > 0) parts.push(plural(course.dueReviewCount, { one: "# card due", other: "# cards due" }))
  if (course.newCardCount > 0) parts.push(plural(course.newCardCount, { one: "# new card", other: "# new cards" }))
  if (parts.length > 0) return formatList(parts)
  return plural(course.deckCount, { one: "# deck, nothing due", other: "# decks, nothing due" })
}

function materialsDetail(course: StudyCourseSummary): string {
  const ready =
    course.processedDocCount === course.docCount
      ? plural(course.docCount, { one: "# file ready", other: "# files ready" })
      : `${course.processedDocCount} of ${plural(course.docCount, { one: "# file", other: "# files" })} ready`
  if (course.failedDocCount > 0) {
    return `${ready}. ${plural(course.failedDocCount, { one: "# couldn't be read", other: "# couldn't be read" })}`
  }
  return ready
}

function ToolRow({ tool }: { tool: Tool }) {
  const Icon = tool.icon
  return (
    <li>
      <Link
        href={tool.href}
        className="state-layer relative isolate flex min-h-16 items-center gap-4 px-4 py-3 text-on-surface outline-none [--focus-ring-offset:-2px]"
      >
        <Icon className="size-5 shrink-0 text-on-surface-variant" aria-hidden="true" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="type-title-s">{tool.label}</span>
          {tool.detail === undefined ? (
            <Skeleton aria-hidden="true" className="h-3.5 w-32" />
          ) : tool.detail ? (
            <span className="type-body-m text-pretty text-on-surface-variant">{tool.detail}</span>
          ) : null}
        </span>
        <ChevronRightIcon className="size-5 shrink-0 text-on-surface-variant" aria-hidden="true" />
      </Link>
    </li>
  )
}

/**
 * The course's other tools, always reachable from Study whatever the
 * counts say: flashcards, study guides, chat and materials.
 */
export function CourseTools({
  courseName,
  course,
  loading,
  failed,
  onRetry,
}: {
  courseName: string
  course: StudyCourseSummary | null
  loading: boolean
  failed: boolean
  onRetry: () => void
}) {
  const counts = loading ? undefined : course
  const tools: Tool[] = [
    {
      href: "/flashcards",
      label: "Flashcards",
      icon: LayersIcon,
      detail: counts === undefined ? undefined : counts ? flashcardDetail(counts) : null,
    },
    {
      href: "/guides",
      label: "Study guides",
      icon: BookOpenTextIcon,
      detail:
        counts === undefined
          ? undefined
          : counts
            ? plural(counts.guideCount, { zero: "No guides yet", one: "# guide", other: "# guides" })
            : null,
    },
    {
      href: "/chat",
      label: "Chat",
      icon: MessagesSquareIcon,
      detail: `Ask about your ${courseName} materials`,
    },
    {
      href: `/plan/materials?course=${encodeURIComponent(courseName)}`,
      label: "Materials",
      icon: FolderOpenIcon,
      detail: counts === undefined ? undefined : counts ? materialsDetail(counts) : null,
    },
  ]

  return (
    <section aria-labelledby="course-tools-title" className="flex flex-col gap-2">
      <SectionHeader id="course-tools-title" title="Course tools" />
      {failed ? (
        <ErrorState title="Course details didn't load." description="The links below still work." onRetry={onRetry} />
      ) : null}
      <Card className="gap-0 py-2">
        <ul className="flex flex-col">
          {tools.map((tool) => (
            <ToolRow key={tool.href} tool={tool} />
          ))}
        </ul>
      </Card>
    </section>
  )
}
