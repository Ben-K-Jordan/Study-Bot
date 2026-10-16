"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { FolderUpIcon } from "lucide-react"

import { useApi } from "@/lib/swr"
import { useActiveCourse } from "@/hooks/use-active-course"
import { useCourseOptions } from "@/hooks/use-course-options"
import { useMounted } from "@/hooks/use-mounted"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CourseSwitcher } from "@/components/app/course-switcher"
import { EmptyState } from "@/components/app/empty-state"
import { ErrorState } from "@/components/app/error-state"
import { LoadingRegion } from "@/components/app/skeletons"
import { PageContainer } from "@/components/app/page-container"
import { describeRequestError } from "@/components/study/request-errors"
import { DeleteGuideDialog } from "@/components/guides/delete-guide-dialog"
import { GUIDE_FORMATS, guideFormat, isGuideType, type GuideType } from "@/components/guides/guide-format"
import { GuidePanel } from "@/components/guides/guide-panel"
import { GuidePrintStyles } from "@/components/guides/guide-print-styles"
import { GuideSkeleton, GuidesSkeleton } from "@/components/guides/guides-skeleton"
import type { GuidesResponse, StudyGuide } from "@/components/guides/types"
import { guideJobKey, useGenerateGuide } from "@/components/guides/use-generate-guide"

/** Keeps ?format= and ?guide= in the address bar so a guide can be linked to. */
function syncUrl(type: GuideType, guideId: string | null) {
  const params = new URLSearchParams(window.location.search)
  params.set("format", guideFormat(type).slug)
  if (guideId) params.set("guide", guideId)
  else params.delete("guide")
  window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`)
}

/**
 * Study guides for the active course and exam: one tab per format, the
 * guide rendered as a document, Generate guide with progress and errors,
 * export, print and delete.
 *
 * The page seeds the course list from the server. The active course lives
 * in the browser, so the guides wait for hydration (skeleton until then,
 * never another course's guides or name), and their request starts right
 * away instead of after the course list.
 */
export function GuidesView({
  initialType,
  initialGuideId,
  timeZone,
}: {
  initialType: GuideType
  initialGuideId: string | null
  timeZone?: string
}) {
  const mounted = useMounted()
  const courses = useCourseOptions()
  const { activeCourse, course } = useActiveCourse(courses.keys)
  const listUrl = mounted && course
    ? `/api/guides?${new URLSearchParams({
        course_name: course.courseName,
        ...(course.examName ? { exam_name: course.examName } : {}),
      }).toString()}`
    : null
  const list = useApi<GuidesResponse>(listUrl)

  const [type, setType] = useState<GuideType>(initialType)
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const [linkedGuideId, setLinkedGuideId] = useState<string | null>(initialGuideId)
  const [focusGuideId, setFocusGuideId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<{ guide: StudyGuide | null; open: boolean }>({
    guide: null,
    open: false,
  })
  const [announcement, setAnnouncement] = useState("")
  const panelRef = useRef<HTMLDivElement>(null)
  const { jobs, generate, dismiss } = useGenerateGuide()

  // Where the student is now, read when a slow generation finishes.
  const current = useRef({ courseKey: activeCourse, type })
  useEffect(() => {
    current.current = { courseKey: activeCourse, type }
  })

  const clearFocus = useCallback(() => setFocusGuideId(null), [])

  if (courses.error && !courses.options) {
    return (
      <PageContainer size="narrow">
        <ErrorState
          title="Courses didn't load."
          description={describeRequestError(courses.error)}
          onRetry={courses.retry}
        />
      </PageContainer>
    )
  }

  if (!courses.options || !course || !activeCourse || !listUrl) {
    if (courses.options && courses.options.length === 0) {
      return (
        <PageContainer size="narrow">
          <EmptyState
            icon={FolderUpIcon}
            headingLevel="h2"
            title="No course materials yet"
            description="Guides are written from your course files. Upload them on Plan first."
            action={
              <Button asChild>
                <Link href="/plan/materials">Upload materials</Link>
              </Button>
            }
          />
        </PageContainer>
      )
    }
    return (
      <PageContainer size="narrow">
        <GuidesSkeleton />
      </PageContainer>
    )
  }

  const scopeName = course.examName ? `${course.courseName} ${course.examName}` : course.courseName
  const guides = list.data?.guides ?? []

  const selectedFor = (t: GuideType): string | null => {
    const ofType = guides.filter((g) => g.guide_type === t)
    const picked = chosen[guideJobKey(activeCourse, t)]
    if (picked && ofType.some((g) => g.id === picked)) return picked
    if (linkedGuideId && ofType.some((g) => g.id === linkedGuideId)) return linkedGuideId
    return ofType[0]?.id ?? null
  }

  const startGeneration = (t: GuideType) => {
    const key = guideJobKey(activeCourse, t)
    const format = guideFormat(t)
    setAnnouncement(`Generating ${format.noun}…`)
    void generate({
      key,
      listUrl,
      courseName: course.courseName,
      examName: course.examName,
      type: t,
      onReady: (guide) => {
        const here = current.current.courseKey === activeCourse && current.current.type === t
        setChosen((prev) => ({ ...prev, [key]: guide.id }))
        if (here) {
          setFocusGuideId(guide.id)
          setAnnouncement("Guide ready")
          syncUrl(t, guide.id)
        } else {
          setAnnouncement("")
          toast(`${guide.title} ready`)
        }
      },
    })
  }

  const handleDeleted = async (guide: StudyGuide) => {
    await list.mutate(
      (data) => ({ guides: (data?.guides ?? []).filter((g) => g.id !== guide.id) }),
      { revalidate: false }
    )
    setChosen((prev) => {
      const next = { ...prev }
      for (const [key, id] of Object.entries(next)) if (id === guide.id) delete next[key]
      return next
    })
    if (linkedGuideId === guide.id) setLinkedGuideId(null)
    syncUrl(guide.guide_type, null)
    toast("Guide deleted")
  }

  return (
    <PageContainer size="narrow">
      <GuidePrintStyles />
      <div className="flex print:hidden">
        <CourseSwitcher />
      </div>

      <Tabs
        value={type}
        onValueChange={(next) => {
          if (!isGuideType(next)) return
          setType(next)
          setLinkedGuideId(null)
          syncUrl(next, null)
        }}
        className="gap-4"
      >
        <TabsList aria-label="Guide format" className="print:hidden">
          {GUIDE_FORMATS.map((format) => (
            <TabsTrigger key={format.type} value={format.type}>
              {format.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {GUIDE_FORMATS.map((format) => (
          <TabsContent
            key={format.type}
            value={format.type}
            // Radix keeps every panel in the DOM (hidden); only the shown one is the focus target.
            ref={type === format.type ? panelRef : undefined}
          >
            {list.error && !list.data ? (
              <ErrorState
                title="Guides didn't load."
                description={describeRequestError(list.error)}
                onRetry={() => list.mutate()}
                retrying={list.isValidating}
              />
            ) : !list.data ? (
              <LoadingRegion label="Loading guides…">
                <GuideSkeleton />
              </LoadingRegion>
            ) : (
              <GuidePanel
                format={format}
                guides={guides.filter((g) => g.guide_type === format.type)}
                selectedId={selectedFor(format.type)}
                onSelect={(id) => {
                  setChosen((prev) => ({ ...prev, [guideJobKey(activeCourse, format.type)]: id }))
                  syncUrl(format.type, id)
                }}
                scopeName={scopeName}
                timeZone={timeZone}
                job={jobs[guideJobKey(activeCourse, format.type)]}
                onGenerate={() => startGeneration(format.type)}
                onDismissError={() => dismiss(guideJobKey(activeCourse, format.type))}
                focusGuideId={focusGuideId}
                onFocused={clearFocus}
                onDelete={(guide) => setDeleting({ guide, open: true })}
              />
            )}
          </TabsContent>
        ))}
      </Tabs>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <DeleteGuideDialog
        guide={deleting.guide}
        open={deleting.open}
        onOpenChange={(open) => setDeleting((prev) => ({ ...prev, open }))}
        onDeleted={handleDeleted}
        returnFocus={() => panelRef.current}
      />
    </PageContainer>
  )
}
