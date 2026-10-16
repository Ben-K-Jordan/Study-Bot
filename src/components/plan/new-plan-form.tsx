"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CircleAlertIcon, CircleCheckIcon, FileTextIcon } from "lucide-react"
import { toast } from "sonner"

import { formatDuration, plural } from "@/lib/format"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { FileDropzone } from "@/components/materials/file-dropzone"
import { UploadList } from "@/components/materials/upload-list"
import { useMaterialUploads } from "@/components/materials/use-material-uploads"
import type { MaterialDoc } from "@/components/materials/types"
import { errorMessage, fieldIssues, readJson } from "@/components/plan/api-errors"
import { samePlanTarget, type PlanSummary } from "@/components/plan/plan-model"
import { useReturnFocus } from "@/components/plan/use-return-focus"

type FieldName = "course" | "exam" | "examDate" | "studyStart" | "studyEnd" | "topics" | "materials"

/** Server issue paths to the form's fields. */
const ISSUE_FIELDS: Record<string, FieldName> = {
  course_name: "course",
  exam_name: "exam",
  exam_date: "examDate",
  availability: "studyEnd",
  objectives: "topics",
  document_ids: "materials",
}

const FIELD_ORDER: FieldName[] = ["course", "exam", "examDate", "studyStart", "studyEnd", "materials", "topics"]

const CREATE_TIMEOUT_MS = 180_000

interface CreateResponse {
  plan_id: string
  exam_name: string
  items: unknown[]
  topics_source?: "typed" | "materials" | "fallback"
  replaced: null | { plan_id: string; deleted: boolean; message?: string }
}

function parseTopics(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    return undefined
  }
}

/**
 * New plan: course, exam, exam date, the daily study window, and the
 * materials the plan reads (files already in that course, plus uploads here)
 * or typed topics. A plan for the same course and exam is replaced only
 * after asking, and the server deletes the old plan only once the new one
 * exists. The plan uses the time zone saved in Settings; only without one
 * does the browser's zone go with the request.
 */
export function NewPlanForm({
  todayKey,
  savedTimeZone,
  defaults,
  plans,
  materials,
  initial,
}: {
  /** Today in the student's zone (YYYY-MM-DD), the earliest exam date. */
  todayKey: string
  /** The zone saved in Settings, or null. Plan and Home show times in it. */
  savedTimeZone?: string | null
  defaults: { studyStart: string; studyEnd: string; dailyCap: number }
  plans: PlanSummary[]
  materials: MaterialDoc[]
  initial?: { course?: string; exam?: string; examDate?: string }
}) {
  const router = useRouter()
  const [course, setCourse] = React.useState(initial?.course ?? "")
  const [exam, setExam] = React.useState(initial?.exam ?? "")
  const [examDate, setExamDate] = React.useState(initial?.examDate && initial.examDate >= todayKey ? initial.examDate : "")
  const [studyStart, setStudyStart] = React.useState(defaults.studyStart)
  const [studyEnd, setStudyEnd] = React.useState(defaults.studyEnd)
  const [typeTopics, setTypeTopics] = React.useState(false)
  const [topicsText, setTopicsText] = React.useState("")
  const [errors, setErrors] = React.useState<Partial<Record<FieldName, string>>>({})
  const [formError, setFormError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [confirmTarget, setConfirmTarget] = React.useState<PlanSummary | null>(null)
  const [removeOldEvents, setRemoveOldEvents] = React.useState(true)
  const uploads = useMaterialUploads()
  // The Replace plan dialog opens from submitting the form, not from a
  // trigger, so focus goes back by hand when it closes
  const submitRef = React.useRef<HTMLButtonElement | null>(null)
  const replaceFocus = useReturnFocus(submitRef)

  const ids = {
    course: React.useId(),
    exam: React.useId(),
    examDate: React.useId(),
    studyStart: React.useId(),
    studyEnd: React.useId(),
    topics: React.useId(),
    removeEvents: React.useId(),
  }
  const fieldRefs = React.useRef<Partial<Record<FieldName, HTMLElement | null>>>({})
  const courseNames = React.useMemo(
    () =>
      [...new Set([...plans.map((p) => p.course_name), ...materials.flatMap((m) => (m.course_name ? [m.course_name] : []))])].sort(
        (a, b) => a.localeCompare(b)
      ),
    [plans, materials]
  )

  const courseKey = course.trim().toLowerCase()
  const examKey = exam.trim().toLowerCase()
  // Ready files already in this course: for this exam, else all of the course's
  const existing = React.useMemo(() => {
    if (!courseKey) return []
    const forCourse = materials.filter(
      (m) => m.status === "PROCESSED" && (m.course_name ?? "").trim().toLowerCase() === courseKey
    )
    const forExam = forCourse.filter((m) => (m.exam_name ?? "").trim().toLowerCase() === examKey)
    return forExam.length > 0 ? forExam : forCourse
  }, [materials, courseKey, examKey])

  const topics = parseTopics(topicsText)
  const documentIds = [...new Set([...existing.map((m) => m.document_id), ...uploads.readyIds])]

  function clearError(field: FieldName) {
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current))
  }

  function validate(): Partial<Record<FieldName, string>> {
    const next: Partial<Record<FieldName, string>> = {}
    if (!course.trim()) next.course = "Enter a course name."
    if (!exam.trim()) next.exam = "Enter an exam name."
    if (!examDate) next.examDate = "Choose the exam date."
    else if (examDate < todayKey) next.examDate = "Choose today or a later date."
    if (!studyStart) next.studyStart = "Choose a start time."
    if (!studyEnd) next.studyEnd = "Choose an end time."
    else if (studyStart && studyEnd <= studyStart) next.studyEnd = "Choose an end time after the start time."
    if (typeTopics && topics.length > 0 && topics.length < 3) {
      next.topics = "Type at least 3 topics, one per line."
    } else if (documentIds.length === 0 && topics.length < 3) {
      if (typeTopics) next.topics = "Type at least 3 topics, one per line."
      else next.materials = "Upload materials, or type at least 3 topics instead."
    }
    return next
  }

  function firstInvalid(found: Partial<Record<FieldName, string>>): HTMLElement | null {
    const first = FIELD_ORDER.find((name) => found[name])
    return first ? (fieldRefs.current[first] ?? null) : null
  }

  function focusFirst(found: Partial<Record<FieldName, string>>) {
    const element = firstInvalid(found)
    if (element) requestAnimationFrame(() => element.focus())
  }

  async function create(target: PlanSummary | null) {
    setSubmitting(true)
    setFormError(null)
    // With a saved zone the server uses it; the browser's zone could differ
    // (travel, a school VM) and put the study window at the wrong hours
    const zone = savedTimeZone ? undefined : browserTimeZone()
    const body = {
      course_name: course.trim(),
      exam_name: exam.trim(),
      exam_date: examDate,
      ...(zone ? { timezone: zone } : {}),
      objectives: typeTopics && topics.length >= 3 ? topics : undefined,
      document_ids: documentIds.length > 0 ? documentIds : undefined,
      availability: Array.from({ length: 7 }, () => ({ start: studyStart, end: studyEnd })),
      daily_study_cap_minutes: defaults.dailyCap,
      break_protocol_default: "25_5",
      ...(target
        ? {
            replace_plan_id: target.plan_id,
            remove_replaced_calendar_events: target.in_google_calendar && removeOldEvents,
          }
        : {}),
    }

    let result: CreateResponse
    try {
      const res = await fetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
      })
      result = (await readJson(res)) as CreateResponse
    } catch (error) {
      setSubmitting(false)
      setConfirmTarget(null)
      const issues = fieldIssues(error)
      const mapped: Partial<Record<FieldName, string>> = {}
      for (const [path, message] of Object.entries(issues)) {
        const field = ISSUE_FIELDS[path]
        if (field) mapped[field === "topics" && !typeTopics ? "materials" : field] = message
      }
      if (Object.keys(mapped).length > 0) {
        setErrors(mapped)
        setFormError("Check the highlighted fields.")
        // From the Replace plan dialog, focus lands on the field once it closes
        if (target) replaceFocus.remember(firstInvalid(mapped))
        else focusFirst(mapped)
      } else {
        setFormError(
          errorMessage(error, target ? "Plan not created. Your current plan is unchanged." : "Plan not created.")
        )
      }
      return
    }

    const count = result.items.length
    toast(
      `Plan created. ${plural(count, {
        zero: `No sessions fit before ${result.exam_name}`,
        one: `# session between today and ${result.exam_name}`,
        other: `# sessions between today and ${result.exam_name}`,
      })}`,
      result.topics_source === "fallback"
        ? {
            description:
              "Your materials didn't give enough topics yet, so it uses general review topics. Replace the plan once your files are ready.",
            // A warning to act on stays until it is dismissed
            duration: Infinity,
          }
        : undefined
    )
    if (result.replaced && !result.replaced.deleted) {
      toast(result.replaced.message ?? "The old plan wasn't deleted. Delete it from its plan page.", {
        duration: Infinity,
      })
    }
    router.push(`/plan?plan=${encodeURIComponent(result.plan_id)}`)
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (submitting) return
    if (uploads.busy) {
      setFormError("Wait for your files to finish processing, then create the plan.")
      return
    }
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0) {
      setFormError("Check the highlighted fields.")
      focusFirst(found)
      return
    }
    setFormError(null)
    const target = plans.find((p) => samePlanTarget(p, { course_name: course, exam_name: exam })) ?? null
    if (target) {
      // Enter in a field or the Create plan button: focus returns there
      const opener = document.activeElement
      replaceFocus.remember(opener instanceof HTMLElement && opener !== document.body ? opener : null)
      setRemoveOldEvents(true)
      setConfirmTarget(target)
      return
    }
    void create(null)
  }

  const remainingInTarget = confirmTarget
    ? confirmTarget.counts.scheduled + confirmTarget.counts.missed + confirmTarget.counts.in_progress
    : 0
  const describe = (field: FieldName, help?: string) =>
    [help, errors[field] ? `${ids[field as keyof typeof ids] ?? field}-error` : undefined].filter(Boolean).join(" ") ||
    undefined

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <fieldset disabled={submitting} className="contents">
        <Card className="[--card-spacing:--spacing(4)] sm:[--card-spacing:--spacing(6)]">
          <CardContent className="flex flex-col gap-8">
            <FieldSet>
              <FieldLegend>Course and exam</FieldLegend>
              <FieldGroup className="grid gap-6 sm:grid-cols-2">
                <Field data-invalid={errors.course ? true : undefined}>
                  <FieldLabel htmlFor={ids.course}>Course</FieldLabel>
                  <Input
                    id={ids.course}
                    ref={(el) => {
                      fieldRefs.current.course = el
                    }}
                    value={course}
                    onChange={(e) => {
                      setCourse(e.target.value)
                      clearError("course")
                    }}
                    list={`${ids.course}-courses`}
                    autoComplete="off"
                    maxLength={120}
                    required
                    aria-invalid={errors.course ? true : undefined}
                    aria-describedby={describe("course", `${ids.course}-help`)}
                  />
                  <datalist id={`${ids.course}-courses`}>
                    {courseNames.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                  <FieldDescription id={`${ids.course}-help`}>Like CS 2110.</FieldDescription>
                  {errors.course ? <FieldError id={`${ids.course}-error`}>{errors.course}</FieldError> : null}
                </Field>
                <Field data-invalid={errors.exam ? true : undefined}>
                  <FieldLabel htmlFor={ids.exam}>Exam</FieldLabel>
                  <Input
                    id={ids.exam}
                    ref={(el) => {
                      fieldRefs.current.exam = el
                    }}
                    value={exam}
                    onChange={(e) => {
                      setExam(e.target.value)
                      clearError("exam")
                    }}
                    autoComplete="off"
                    maxLength={120}
                    required
                    aria-invalid={errors.exam ? true : undefined}
                    aria-describedby={describe("exam", `${ids.exam}-help`)}
                  />
                  <FieldDescription id={`${ids.exam}-help`}>Like Prelim 1 or Final.</FieldDescription>
                  {errors.exam ? <FieldError id={`${ids.exam}-error`}>{errors.exam}</FieldError> : null}
                </Field>
                <Field data-invalid={errors.examDate ? true : undefined}>
                  <FieldLabel htmlFor={ids.examDate}>Exam date</FieldLabel>
                  <Input
                    id={ids.examDate}
                    ref={(el) => {
                      fieldRefs.current.examDate = el
                    }}
                    type="date"
                    value={examDate}
                    min={todayKey}
                    onChange={(e) => {
                      setExamDate(e.target.value)
                      clearError("examDate")
                    }}
                    required
                    aria-invalid={errors.examDate ? true : undefined}
                    aria-describedby={describe("examDate", `${ids.examDate}-help`)}
                  />
                  <FieldDescription id={`${ids.examDate}-help`}>
                    Sessions are scheduled from today up to this day.
                  </FieldDescription>
                  {errors.examDate ? <FieldError id={`${ids.examDate}-error`}>{errors.examDate}</FieldError> : null}
                </Field>
              </FieldGroup>
            </FieldSet>

            <FieldSet>
              <FieldLegend>Study hours</FieldLegend>
              <FieldDescription id={`${ids.studyStart}-help`} className="-mt-3">
                Sessions in this plan fall between these times each day, up to{" "}
                {formatDuration(defaults.dailyCap)} a day (from{" "}
                <Link href="/settings" className="underline underline-offset-4">
                  Settings
                </Link>
                ).
              </FieldDescription>
              <FieldGroup className="grid gap-6 sm:grid-cols-2">
                <Field data-invalid={errors.studyStart ? true : undefined}>
                  <FieldLabel htmlFor={ids.studyStart}>Daily start time</FieldLabel>
                  <Input
                    id={ids.studyStart}
                    ref={(el) => {
                      fieldRefs.current.studyStart = el
                    }}
                    type="time"
                    value={studyStart}
                    onChange={(e) => {
                      setStudyStart(e.target.value)
                      clearError("studyStart")
                      clearError("studyEnd")
                    }}
                    required
                    aria-invalid={errors.studyStart ? true : undefined}
                    aria-describedby={describe("studyStart", `${ids.studyStart}-help`)}
                  />
                  {errors.studyStart ? (
                    <FieldError id={`${ids.studyStart}-error`}>{errors.studyStart}</FieldError>
                  ) : null}
                </Field>
                <Field data-invalid={errors.studyEnd ? true : undefined}>
                  <FieldLabel htmlFor={ids.studyEnd}>Daily end time</FieldLabel>
                  <Input
                    id={ids.studyEnd}
                    ref={(el) => {
                      fieldRefs.current.studyEnd = el
                    }}
                    type="time"
                    value={studyEnd}
                    onChange={(e) => {
                      setStudyEnd(e.target.value)
                      clearError("studyEnd")
                    }}
                    required
                    aria-invalid={errors.studyEnd ? true : undefined}
                    aria-describedby={describe("studyEnd", `${ids.studyStart}-help`)}
                  />
                  {errors.studyEnd ? <FieldError id={`${ids.studyEnd}-error`}>{errors.studyEnd}</FieldError> : null}
                </Field>
              </FieldGroup>
            </FieldSet>

            <FieldSet>
              <FieldLegend>Materials</FieldLegend>
              <FieldDescription className="-mt-3">
                The plan picks its topics from your course files. Flashcards, guides, and chat use them too.
              </FieldDescription>

              {existing.length > 0 ? (
                <div className="flex flex-col gap-2 rounded-2xl bg-surface-container-low px-4 py-3">
                  <p className="flex items-center gap-2 type-title-s text-on-surface">
                    <CircleCheckIcon className="size-4 text-tertiary" aria-hidden="true" />
                    {plural(existing.length, {
                      one: `Uses # file already in your ${course.trim()} materials`,
                      other: `Uses # files already in your ${course.trim()} materials`,
                    })}
                  </p>
                  <ul className="flex flex-col gap-1 pl-6">
                    {existing.slice(0, 6).map((doc) => (
                      <li key={doc.document_id} className="flex min-w-0 items-center gap-2 type-body-m text-on-surface-variant">
                        <FileTextIcon className="size-4 shrink-0" aria-hidden="true" />
                        <span className="truncate">{doc.original_filename || doc.title}</span>
                      </li>
                    ))}
                    {existing.length > 6 ? (
                      <li className="type-body-m text-on-surface-variant">
                        {plural(existing.length - 6, { one: "and # more", other: "and # more" })}
                      </li>
                    ) : null}
                  </ul>
                </div>
              ) : null}

              <div
                ref={(el) => {
                  fieldRefs.current.materials = el
                }}
                tabIndex={-1}
                className="flex flex-col gap-3 outline-none"
              >
                <FileDropzone
                  label={existing.length > 0 ? "Add more files" : "Upload materials"}
                  description="PDF, text, or Markdown, up to 10 MB each."
                  onFiles={(files) => {
                    clearError("materials")
                    uploads.addFiles(files, { courseName: course, examName: exam })
                  }}
                  disabled={!course.trim() || submitting}
                  disabledReason={course.trim() ? undefined : "Enter the course name first. Files are saved to that course."}
                />
                <UploadList
                  entries={uploads.entries}
                  announcement={uploads.announcement}
                  onRetry={uploads.retry}
                  onRemove={uploads.remove}
                  removeLabel="Remove"
                  showCourse
                />
                {errors.materials ? (
                  <FieldError className="flex items-start gap-2">
                    <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    {errors.materials}
                  </FieldError>
                ) : null}
              </div>

              <Field orientation="horizontal">
                <Checkbox
                  id={`${ids.topics}-toggle`}
                  checked={typeTopics}
                  onCheckedChange={(value) => {
                    setTypeTopics(value === true)
                    clearError("topics")
                    clearError("materials")
                  }}
                />
                <FieldContent>
                  <FieldLabel htmlFor={`${ids.topics}-toggle`}>Type topics instead</FieldLabel>
                  <FieldDescription>Use your own list when you don&apos;t have files yet.</FieldDescription>
                </FieldContent>
              </Field>

              {typeTopics ? (
                <Field data-invalid={errors.topics ? true : undefined}>
                  <FieldLabel htmlFor={ids.topics}>Topics</FieldLabel>
                  <Textarea
                    id={ids.topics}
                    ref={(el) => {
                      fieldRefs.current.topics = el
                    }}
                    value={topicsText}
                    onChange={(e) => {
                      setTopicsText(e.target.value)
                      clearError("topics")
                    }}
                    rows={5}
                    aria-invalid={errors.topics ? true : undefined}
                    aria-describedby={describe("topics", `${ids.topics}-help`)}
                  />
                  <FieldDescription id={`${ids.topics}-help`}>
                    One per line, at least 3.{" "}
                    <span className="tabular-nums">
                      {plural(topics.length, { zero: "None typed yet.", one: "# typed.", other: "# typed." })}
                    </span>
                  </FieldDescription>
                  {errors.topics ? <FieldError id={`${ids.topics}-error`}>{errors.topics}</FieldError> : null}
                </Field>
              ) : null}
            </FieldSet>
          </CardContent>
        </Card>

        {formError ? (
          <Alert variant="destructive">
            <CircleAlertIcon aria-hidden="true" />
            <AlertTitle>{formError}</AlertTitle>
          </Alert>
        ) : null}

        <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
          <p role="status" aria-live="polite" className="type-body-m text-on-surface-variant sm:mr-auto">
            {submitting
              ? "Creating plan… This can take up to a minute."
              : uploads.busy
                ? "Files are still processing."
                : ""}
          </p>
          <Button asChild variant="text">
            <Link href="/plan">Cancel</Link>
          </Button>
          <Button ref={submitRef} type="submit" size="lg" disabled={submitting}>
            {submitting ? <Spinner data-icon="inline-start" aria-hidden="true" role={undefined} /> : null}
            {submitting ? "Creating plan…" : "Create plan"}
          </Button>
        </div>
      </fieldset>

      <AlertDialog
        open={confirmTarget !== null}
        onOpenChange={(open) => {
          if (!open && !submitting) setConfirmTarget(null)
        }}
      >
        <AlertDialogContent onCloseAutoFocus={replaceFocus.onCloseAutoFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace your {confirmTarget?.course_name} plan?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmTarget
                ? `Creating this plan deletes the current one for ${confirmTarget.exam_name}${
                    remainingInTarget > 0
                      ? ` and ${plural(remainingInTarget, {
                          one: "its # remaining session",
                          other: "its # remaining sessions",
                        })}`
                      : ""
                  }. The old plan is deleted only after the new one is ready. Your answers and progress stay.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmTarget?.in_google_calendar ? (
            <Field orientation="horizontal">
              <Checkbox
                id={ids.removeEvents}
                checked={removeOldEvents}
                onCheckedChange={(value) => setRemoveOldEvents(value === true)}
                disabled={submitting}
              />
              <FieldContent>
                <FieldLabel htmlFor={ids.removeEvents}>Also remove the old plan&apos;s events from Google Calendar</FieldLabel>
                <FieldDescription>Left unchecked, they stay in Google Calendar.</FieldDescription>
              </FieldContent>
            </Field>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={submitting} onClick={() => void create(confirmTarget)}>
              {submitting ? <Spinner data-icon="inline-start" aria-hidden="true" role={undefined} /> : null}
              {submitting ? "Creating plan…" : "Replace plan"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  )
}
