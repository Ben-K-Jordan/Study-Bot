"use client"

import { useEffect, useId, useRef } from "react"
import { BookOpenTextIcon, SparklesIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { formatDateTime } from "@/lib/format"
import { useApi } from "@/lib/swr"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { EmptyState } from "@/components/app/empty-state"
import { ErrorState } from "@/components/app/error-state"
import { LoadingRegion } from "@/components/app/skeletons"
import { ProgressLinear } from "@/components/app/progress-linear"
import { describeRequestError } from "@/components/study/request-errors"
import { GuideArticle } from "@/components/guides/guide-article"
import type { GuideFormat } from "@/lib/guide-format"
import { GuideSkeleton } from "@/components/guides/guides-skeleton"
import type { GuideResponse, StudyGuide, StudyGuideSummary } from "@/components/guides/types"
import type { GuideJob } from "@/components/guides/use-generate-guide"

function GenerateButton({
  pending,
  onGenerate,
  variant,
}: {
  pending: boolean
  onGenerate: () => void
  variant: "default" | "outline"
}) {
  return (
    <Button variant={variant} onClick={onGenerate} disabled={pending}>
      {pending ? (
        <Spinner data-icon="inline-start" aria-hidden="true" role={undefined} />
      ) : (
        <SparklesIcon data-icon="inline-start" aria-hidden="true" />
      )}
      {pending ? "Generating guide…" : "Generate guide"}
    </Button>
  )
}

function VersionSelect({
  guides,
  value,
  onChange,
  timeZone,
}: {
  guides: StudyGuideSummary[]
  value: string
  onChange: (id: string) => void
  timeZone?: string
}) {
  const id = useId()
  const mixedExams = new Set(guides.map((g) => g.exam_name ?? "")).size > 1
  return (
    <Field className="w-full gap-2 sm:w-auto">
      <FieldLabel htmlFor={id}>Version</FieldLabel>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} size="sm" className="w-full min-w-0 sm:w-72">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          <SelectGroup>
            {guides.map((guide, index) => (
              <SelectItem key={guide.id} value={guide.id}>
                <span className="tabular-nums">{formatDateTime(guide.created_at, { timeZone })}</span>
                {mixedExams && guide.exam_name ? `, ${guide.exam_name}` : null}
                {index === 0 ? " (latest)" : null}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  )
}

/**
 * The chosen guide with its sections. The list carries sections only for
 * the newest guide of each format; an older version loads on its own,
 * cached per guide.
 */
function useGuideContent(summary: StudyGuideSummary | null) {
  const needsFetch = summary !== null && summary.sections === undefined
  const res = useApi<GuideResponse>(needsFetch ? `/api/guides/${encodeURIComponent(summary.id)}` : null)
  let guide: StudyGuide | null = null
  if (summary?.sections) guide = { ...summary, sections: summary.sections }
  else if (summary && res.data?.guide.id === summary.id) guide = res.data.guide
  return {
    guide,
    error: needsFetch && !res.data ? res.error : undefined,
    retrying: res.isValidating,
    retry: () => void res.mutate(),
  }
}

/**
 * One format tab: the chosen version of the guide (newest by default), a
 * version picker when there are several, generation progress and errors,
 * or the empty state with Generate guide.
 */
export function GuidePanel({
  format,
  guides,
  selectedId,
  onSelect,
  scopeName,
  timeZone,
  job,
  onGenerate,
  onDismissError,
  focusGuideId,
  onFocused,
  onDelete,
}: {
  format: GuideFormat
  /** This format's guides, newest first. */
  guides: StudyGuideSummary[]
  selectedId: string | null
  onSelect: (id: string) => void
  scopeName: string
  timeZone?: string
  job: GuideJob | undefined
  onGenerate: () => void
  onDismissError: () => void
  focusGuideId: string | null
  onFocused: () => void
  onDelete: (guide: StudyGuide) => void
}) {
  const selected = guides.find((g) => g.id === selectedId) ?? guides[0] ?? null
  const content = useGuideContent(selected)
  const pending = job?.status === "pending"
  const jobStatus = job?.status ?? "idle"
  const statusRef = useRef<HTMLDivElement>(null)

  // Generate guide in the empty state unmounts the button that had focus,
  // the Generate button above a guide is disabled while it runs, and Retry
  // unmounts with the failure. When focus is lost that way, put it on the
  // status area so keyboard and screen reader users keep their place. A
  // finished guide takes focus to its own title.
  useEffect(() => {
    if (jobStatus === "idle") return
    const active = document.activeElement
    const lost =
      !active || active === document.body || (active instanceof HTMLButtonElement && active.disabled)
    if (lost) statusRef.current?.focus()
  }, [jobStatus])

  return (
    <div className="flex flex-col gap-4">
      {jobStatus === "idle" ? null : (
        <div ref={statusRef} tabIndex={-1} className="flex flex-col gap-4 outline-none print:hidden">
          {pending ? (
            <div className="flex flex-col gap-2 rounded-xl bg-surface-container px-4 py-3">
              <p className="type-body-m text-on-surface">
                Generating guide… This can take up to a minute.
              </p>
              <ProgressLinear value={null} label={`Generating ${format.noun}`} />
            </div>
          ) : null}

          {job?.status === "failed" ? (
            <ErrorState
              title="Guide not generated."
              description={job.message}
              onRetry={() => {
                onDismissError()
                onGenerate()
              }}
            />
          ) : null}
        </div>
      )}

      {selected ? (
        <>
          <div
            className={cn(
              "flex flex-wrap items-end gap-3 print:hidden",
              guides.length > 1 ? "justify-between" : "justify-end"
            )}
          >
            {guides.length > 1 ? (
              <VersionSelect guides={guides} value={selected.id} onChange={onSelect} timeZone={timeZone} />
            ) : null}
            <GenerateButton pending={pending} onGenerate={onGenerate} variant="outline" />
          </div>
          {content.guide ? (
            <GuideArticle
              key={content.guide.id}
              guide={content.guide}
              scopeName={scopeName}
              timeZone={timeZone}
              focusHeading={focusGuideId === content.guide.id}
              onFocused={onFocused}
              onDelete={() => {
                if (content.guide) onDelete(content.guide)
              }}
            />
          ) : content.error ? (
            <ErrorState
              title="Guide didn't load."
              description={describeRequestError(content.error)}
              onRetry={content.retry}
              retrying={content.retrying}
            />
          ) : (
            <LoadingRegion label="Loading guide…">
              <GuideSkeleton />
            </LoadingRegion>
          )}
        </>
      ) : pending ? null : (
        <EmptyState
          bordered
          icon={BookOpenTextIcon}
          headingLevel="h2"
          title={`No ${format.noun} for ${scopeName} yet`}
          description={`${format.description} Written by AI from your ${scopeName} materials.`}
          action={<GenerateButton pending={false} onGenerate={onGenerate} variant="default" />}
        />
      )}
    </div>
  )
}
