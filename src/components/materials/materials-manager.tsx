"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { CheckIcon, FolderOpenIcon } from "lucide-react"

import { useApi } from "@/lib/swr"
import { cn } from "@/lib/utils"
import { plural } from "@/lib/format"
import { EmptyState } from "@/components/app/empty-state"
import { ErrorState } from "@/components/app/error-state"
import { SectionHeader } from "@/components/app/section-header"
import { Card, CardContent } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { FileDropzone } from "@/components/materials/file-dropzone"
import { MaterialRow } from "@/components/materials/material-row"
import { UploadList } from "@/components/materials/upload-list"
import { useMaterialUploads } from "@/components/materials/use-material-uploads"
import type { MaterialDoc } from "@/components/materials/types"

const DOCUMENTS_URL = "/api/content/documents?namespace=COURSE"

interface CourseGroup {
  course: string
  docs: MaterialDoc[]
}

function groupByCourse(docs: readonly MaterialDoc[]): CourseGroup[] {
  const groups = new Map<string, MaterialDoc[]>()
  for (const doc of docs) {
    const course = doc.course_name?.trim() || "No course"
    const list = groups.get(course) ?? []
    list.push(doc)
    groups.set(course, list)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([course, list]) => ({ course, docs: list }))
}

function slug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

/**
 * The course materials screen: upload files to a course (drag and drop or
 * Choose files), then every file grouped by course with its status, summary,
 * Retry and Delete. The list is the same SWR key the course switchers read,
 * so uploads and deletes show up everywhere.
 */
export function MaterialsManager({
  initialMaterials,
  knownCourses,
  timeZone,
}: {
  initialMaterials: MaterialDoc[]
  /** Course names from plans and files, for suggestions. */
  knownCourses: string[]
  timeZone: string
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const filter = searchParams.get("course")?.trim() || null

  // The server just rendered this list, so don't fetch it again on mount.
  // Put it in the shared cache instead: the course switchers read the same
  // key, and an older cached copy would otherwise win over the fresh one.
  const { data, error, isLoading, mutate } = useApi<{ documents: MaterialDoc[] }>(DOCUMENTS_URL, {
    fallbackData: { documents: initialMaterials },
    revalidateOnMount: false,
    revalidateIfStale: false,
  })
  React.useEffect(() => {
    void mutate({ documents: initialMaterials }, { revalidate: false })
  }, [initialMaterials, mutate])
  const docs = React.useMemo(() => data?.documents ?? [], [data])

  const [course, setCourse] = React.useState(filter ?? "")
  const [exam, setExam] = React.useState("")
  const refresh = React.useCallback(() => {
    void mutate()
  }, [mutate])
  const uploads = useMaterialUploads({ onDocumentChange: refresh })

  const groups = React.useMemo(() => groupByCourse(docs), [docs])
  const visible = filter ? groups.filter((g) => g.course.toLowerCase() === filter.toLowerCase()) : groups
  const activeCourse = filter ? (visible[0]?.course ?? filter) : null
  const courseNames = React.useMemo(
    () =>
      [...new Set([...knownCourses, ...groups.map((g) => g.course).filter((c) => c !== "No course")])].sort(
        (a, b) => a.localeCompare(b)
      ),
    [groups, knownCourses]
  )

  const listHeadingRef = React.useRef<HTMLHeadingElement>(null)
  const courseInputId = React.useId()
  const examInputId = React.useId()
  const datalistId = React.useId()
  const courseHelpId = React.useId()
  const courseMissing = course.trim().length === 0

  function onFiles(files: File[]) {
    if (courseMissing) return
    uploads.addFiles(files, { courseName: course, examName: exam })
  }

  // The deleted row's dialog hands focus to the list heading as it closes.
  async function afterDelete() {
    await mutate()
  }

  const chipHref = (value: string | null) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set("course", value)
    else params.delete("course")
    const query = params.toString()
    return query ? `${pathname}?${query}` : pathname
  }

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="upload-materials" className="flex flex-col gap-3">
        <SectionHeader
          id="upload-materials"
          title="Upload materials"
          description="Lecture slides and notes for a course. Plans, flashcards, guides, and chat answer from them."
        />
        <Card className="[--card-spacing:--spacing(4)] sm:[--card-spacing:--spacing(6)]">
          <CardContent className="flex flex-col gap-6">
            <FieldGroup className="grid gap-6 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={courseInputId}>Course</FieldLabel>
                <Input
                  id={courseInputId}
                  value={course}
                  onChange={(event) => setCourse(event.target.value)}
                  list={datalistId}
                  autoComplete="off"
                  aria-describedby={courseHelpId}
                  maxLength={120}
                />
                <datalist id={datalistId}>
                  {courseNames.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
                <FieldDescription id={courseHelpId}>
                  Like CS 2110. Use the same name as in your plans.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor={examInputId}>Exam (optional)</FieldLabel>
                <Input
                  id={examInputId}
                  value={exam}
                  onChange={(event) => setExam(event.target.value)}
                  autoComplete="off"
                  maxLength={120}
                />
                <FieldDescription>Like Prelim 1. Leave it empty when the files cover the whole course.</FieldDescription>
              </Field>
            </FieldGroup>
            <FileDropzone
              label="Course files"
              description="PDF, text, or Markdown, up to 10 MB each."
              onFiles={onFiles}
              disabled={courseMissing}
              disabledReason="Enter the course name first."
            />
            <UploadList
              entries={uploads.entries}
              announcement={uploads.announcement}
              onRetry={uploads.retry}
              onRemove={uploads.remove}
              removeLabel="Dismiss"
              showCourse
            />
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="your-materials" className="flex flex-col gap-4">
        <h2
          id="your-materials"
          ref={listHeadingRef}
          tabIndex={-1}
          className="type-title-m text-on-surface outline-none"
        >
          Your materials
        </h2>

        {groups.length > 1 ? (
          // The 4px inset at every width leaves room for the chips' 2px focus ring and 2px offset inside the scroller
          <nav aria-label="Filter by course" className="-mx-4 -my-1 overflow-x-auto px-4 py-1 sm:-mx-1 sm:px-1">
            <ul className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
              {[null, ...groups.map((g) => g.course)].map((value) => {
                const active = value === activeCourse
                return (
                  <li key={value ?? "all"}>
                    <Link
                      href={chipHref(value)}
                      scroll={false}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "state-layer relative isolate inline-flex h-8 items-center gap-2 rounded-md border px-3 type-label-l whitespace-nowrap",
                        active
                          ? "border-transparent bg-secondary-container text-on-secondary-container"
                          : "border-outline-variant text-on-surface-variant"
                      )}
                    >
                      {active ? <CheckIcon className="size-4" aria-hidden="true" /> : null}
                      {value ?? "All courses"}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>
        ) : null}

        {error && !data ? (
          <ErrorState title="Materials didn't load." onRetry={() => void mutate()} retrying={isLoading} />
        ) : docs.length === 0 ? (
          <EmptyState
            icon={FolderOpenIcon}
            title="No materials yet"
            description="Upload lecture slides or notes above. Plans, flashcards, guides, and chat use them."
            bordered
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={FolderOpenIcon}
            title={`No materials for ${filter} yet`}
            description={`Upload files above with ${filter} as the course.`}
            bordered
          />
        ) : (
          <div className="flex flex-col gap-6">
            {error ? (
              <ErrorState title="The list didn't refresh." description="It may be out of date." onRetry={() => void mutate()} />
            ) : null}
            {visible.map((group) => {
              const headingId = `course-${slug(group.course)}`
              return (
                <section key={group.course} aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2">
                  <SectionHeader
                    id={headingId}
                    as="h3"
                    title={group.course}
                    description={plural(group.docs.length, { one: "# file", other: "# files" })}
                  />
                  <ul className="flex flex-col divide-y divide-outline-variant rounded-2xl bg-card ring-1 ring-outline-variant">
                    {group.docs.map((doc) => (
                      <MaterialRow
                        key={doc.document_id}
                        doc={doc}
                        timeZone={timeZone}
                        busy={uploads.busyIds.has(doc.document_id)}
                        onChanged={() => mutate()}
                        onDeleted={afterDelete}
                        returnFocus={listHeadingRef}
                      />
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
