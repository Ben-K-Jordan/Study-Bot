"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { LayersIcon, SparklesIcon, UploadIcon } from "lucide-react"

import { apiPost } from "@/lib/client-api"
import { formatCountdown, plural } from "@/lib/format"
import type { CourseDecks, DeckLibrary } from "@/services/flashcards"
import { EmptyState } from "@/components/app/empty-state"
import { PageHeader } from "@/components/app/page-header"
import { SectionHeader } from "@/components/app/section-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { DeckCard } from "@/components/cards/deck-card"
import { calendarDate } from "@/components/cards/card-format"
import { errorDetail, isPermanent } from "@/components/cards/error-copy"

/**
 * The /flashcards page body: one section per course (nearest exam first)
 * with its decks, counts and due cards, and Generate deck per course.
 */
export function DeckLibraryView({ library }: { library: DeckLibrary }) {
  const { courses, timeZone } = library
  const dueTotal = courses.reduce(
    (sum, course) => sum + course.decks.reduce((s, deck) => s + deck.counts.dueCount, 0),
    0
  )
  const deckTotal = courses.reduce((sum, course) => sum + course.decks.length, 0)

  if (courses.length === 0) {
    return (
      <EmptyState
        icon={LayersIcon}
        headingLevel="h2"
        title="No decks yet"
        description="Decks are generated from your course materials. Upload materials for a course, then generate a deck here."
        action={
          <Button asChild>
            <Link href="/plan/materials">
              <UploadIcon data-icon="inline-start" aria-hidden="true" />
              Upload materials
            </Link>
          </Button>
        }
      />
    )
  }

  return (
    <>
      <PageHeader
        title={
          deckTotal === 0
            ? "No decks yet"
            : plural(dueTotal, { zero: "Nothing due today", one: "# card due today", other: "# cards due today" })
        }
        description="Intervals shorten as each exam gets closer, so your reviews finish before it."
      />
      <div className="flex flex-col gap-10">
        {courses.map((course) => (
          <CourseSection key={course.courseName} course={course} timeZone={timeZone} />
        ))}
      </div>
    </>
  )
}

type GenerateState =
  | { status: "idle" }
  | { status: "generating" }
  | { status: "done"; title: string; cards: number }
  | { status: "failed"; detail: string; permanent: boolean }

function CourseSection({ course, timeZone }: { course: CourseDecks; timeZone: string }) {
  const router = useRouter()
  const headingId = React.useId()
  const sectionRef = React.useRef<HTMLElement>(null)
  const [state, setState] = React.useState<GenerateState>({ status: "idle" })
  const mounted = React.useRef(true)
  React.useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const canGenerate = course.readyMaterialCount > 0
  const processing = course.materialCount > 0 && course.readyMaterialCount === 0

  async function generate() {
    setState({ status: "generating" })
    try {
      const deck = (await apiPost("/api/flashcards", {
        course_name: course.courseName,
        exam_name: course.generateExamName ?? undefined,
      })) as { title: string; card_count: number }
      if (!mounted.current) return
      setState({ status: "done", title: deck.title, cards: deck.card_count })
      router.refresh()
    } catch (err) {
      if (!mounted.current) return
      setState({ status: "failed", detail: errorDetail(err), permanent: isPermanent(err) })
    }
  }

  function afterDelete() {
    setState({ status: "idle" })
    router.refresh()
    sectionRef.current?.focus()
  }

  const examLine = course.exam
    ? formatCountdown(course.exam.name, calendarDate(course.exam.date), { timeZone })
    : undefined

  const generating = state.status === "generating"

  const hasDecks = course.decks.length > 0
  // With no decks yet, the empty state carries the one action.
  const action = !hasDecks && !generating ? null : canGenerate ? (
    <Button variant="outline" size="sm" onClick={generate} disabled={generating}>
      {generating ? (
        <Spinner data-icon="inline-start" aria-hidden="true" role={undefined} />
      ) : (
        <SparklesIcon data-icon="inline-start" aria-hidden="true" />
      )}
      {generating ? "Generating…" : "Generate deck"}
    </Button>
  ) : course.materialCount === 0 ? (
    <Button asChild variant="text" size="sm">
      <Link href={materialsHref(course.courseName)}>Upload materials</Link>
    </Button>
  ) : null

  return (
    <section
      ref={sectionRef}
      aria-labelledby={headingId}
      tabIndex={-1}
      className="flex scroll-mt-24 flex-col gap-4 outline-none"
    >
      <SectionHeader
        id={headingId}
        title={course.courseName}
        description={
          processing
            ? `${examLine ? `${examLine}. ` : ""}Your materials are still processing.`
            : examLine
        }
        action={action}
      />

      <p role="status" aria-live="polite" className="sr-only">
        {generating ? `Generating a ${course.courseName} deck. This can take up to a minute.` : null}
        {state.status === "done" ? doneLine(state.title, state.cards) : null}
      </p>
      {state.status === "done" ? (
        <p aria-hidden="true" className="type-body-m text-on-surface-variant">
          {doneLine(state.title, state.cards)}
        </p>
      ) : null}

      {state.status === "failed" ? (
        <Alert variant="destructive">
          <AlertTitle>Deck not generated.</AlertTitle>
          <AlertDescription>{state.detail}</AlertDescription>
          <div className="col-start-1 -ml-3 flex gap-2 pt-1 has-[svg]:col-start-2">
            {state.permanent ? null : (
              <Button variant="text" size="sm" className="text-current" onClick={generate}>
                Retry
              </Button>
            )}
            <Button variant="text" size="sm" className="text-current" onClick={() => setState({ status: "idle" })}>
              Dismiss
            </Button>
          </div>
        </Alert>
      ) : null}

      {!hasDecks && !generating ? (
        <EmptyState
          bordered
          className="gap-3 p-6"
          title={`No decks for ${course.courseName} yet`}
          description={
            canGenerate
              ? `Generate one from your ${course.courseName} materials.`
              : processing
                ? "Generate one when your materials finish processing."
                : `Upload ${course.courseName} materials to generate a deck. Cards from your session errors also land here.`
          }
          action={
            canGenerate ? (
              <Button onClick={generate}>
                <SparklesIcon data-icon="inline-start" aria-hidden="true" />
                Generate deck
              </Button>
            ) : course.materialCount === 0 ? (
              <Button asChild variant="outline">
                <Link href={materialsHref(course.courseName)}>
                  <UploadIcon data-icon="inline-start" aria-hidden="true" />
                  Upload materials
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {generating ? <GeneratingCard /> : null}
          {course.decks.map((deck) => (
            <DeckCard key={deck.id} deck={deck} timeZone={timeZone} onDeleted={afterDelete} />
          ))}
        </div>
      )}
    </section>
  )
}

/** The materials manager, opened on one course. */
function materialsHref(courseName: string) {
  return `/plan/materials?course=${encodeURIComponent(courseName)}`
}

function doneLine(title: string, cards: number) {
  return `Deck ready: ${title}, ${plural(cards, { one: "# card", other: "# cards" })}.`
}

function GeneratingCard() {
  return (
    <Card size="sm" className="min-h-48 justify-center bg-surface-container ring-0">
      <div className="flex flex-col items-center gap-3 px-6 text-center">
        <Spinner aria-hidden="true" role={undefined} className="size-6 text-primary" />
        <p className="type-title-s text-on-surface">Generating deck…</p>
        <p className="type-body-m text-on-surface-variant">This can take up to a minute.</p>
      </div>
    </Card>
  )
}
