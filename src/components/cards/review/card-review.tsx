"use client"

import * as React from "react"
import Link from "next/link"
import { CheckIcon, CircleAlertIcon, LayersIcon, XIcon } from "lucide-react"

import { apiGet, apiPost } from "@/lib/client-api"
import { formatDateWeekday, formatNumber, formatRelativeDay, plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { ReviewRating, StudyData } from "@/services/spaced-repetition"
import { useMounted } from "@/hooks/use-mounted"
import { readShortcutsEnabled, writeShortcutsEnabled } from "@/components/session/runner/storage"
import { AiTag } from "@/components/app/ai-tag"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { LessonAnnouncer } from "@/components/lesson/lesson-announcer"
import { LessonButton } from "@/components/lesson/lesson-button"
import { DeckCounts } from "@/components/cards/deck-counts"
import { STATUS_LABELS, intervalLabel } from "@/components/cards/card-format"
import { errorDetail } from "@/components/cards/error-copy"
import { ReviewKeyboardHelp } from "@/components/cards/review/review-keyboard-help"
import { ReviewProgress } from "@/components/cards/review/review-progress"
import {
  currentCard,
  initialReviewState,
  keyIntent,
  reviewReducer,
  type RatingResult,
  type ReviewState,
} from "@/components/cards/review/review-state"

const RATINGS: { rating: ReviewRating; label: string; key: string; variant: "wrong" | "neutral" | "check" | "primary" }[] = [
  { rating: "AGAIN", label: "Again", key: "1", variant: "wrong" },
  { rating: "HARD", label: "Hard", key: "2", variant: "neutral" },
  { rating: "GOOD", label: "Good", key: "3", variant: "check" },
  { rating: "EASY", label: "Easy", key: "4", variant: "primary" },
]

/**
 * Sticky bars give their space back on short windows (a phone in landscape,
 * a laptop at 200 to 400% zoom), so the card between them stays in view.
 */
const STATIC_WHEN_SHORT = "short:static"

/**
 * A flashcard review in the lesson grammar: one card at a time, Show answer,
 * then Again, Hard, Good or Easy (keys 1 to 4) with the interval each gives,
 * a progress bar, and a summary at the end. Cards rated Again come back at
 * the end of the review. Counts by status update after every rating.
 */
export function CardReview({ data, timeZone }: { data: StudyData; timeZone: string }) {
  const [review, setReview] = React.useState(data)
  const [state, dispatch] = React.useReducer(reviewReducer, data, (d) => initialReviewState(d.cards, d.stats))
  const [restarting, setRestarting] = React.useState<string | null>(null)
  const deck = review.deck

  // Single-key shortcuts (1 to 4) are on unless the student turned them off,
  // here or in a study session. Read after hydration: the server can't know.
  const mounted = useMounted()
  const [shortcutsChoice, setShortcutsChoice] = React.useState<boolean | null>(null)
  const shortcutsEnabled = shortcutsChoice ?? (mounted ? readShortcutsEnabled() : true)
  const shortcutsRef = React.useRef(shortcutsEnabled)
  React.useEffect(() => {
    shortcutsRef.current = shortcutsEnabled
  })
  const onShortcutsEnabledChange = React.useCallback((enabled: boolean) => {
    setShortcutsChoice(enabled)
    writeShortcutsEnabled(enabled)
  }, [])
  const card = currentCard(state)

  const frontRef = React.useRef<HTMLHeadingElement>(null)
  const answerRef = React.useRef<HTMLElement>(null)
  const doneRef = React.useRef<HTMLHeadingElement>(null)

  // The latest state for the key handler and async callbacks, without
  // re-registering the listener on every change.
  const stateRef = React.useRef(state)
  React.useEffect(() => {
    stateRef.current = state
  })

  const rate = React.useCallback(
    async (rating: ReviewRating) => {
      const s = stateRef.current
      const target = currentCard(s)
      if (!target || s.phase !== "answer" || s.submitting) return
      dispatch({ type: "rate-start", rating })
      stateRef.current = { ...s, submitting: rating }
      try {
        const result = (await apiPost(`/api/flashcards/${encodeURIComponent(deck.id)}/review`, {
          card_id: target.id,
          rating,
        })) as RatingResult
        dispatch({ type: "rate-success", rating, result })
      } catch (err) {
        dispatch({ type: "rate-failure", message: `Rating not saved. ${errorDetail(err)}` })
      }
    },
    [deck.id]
  )

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return
      const intent = keyIntent(event, event.target instanceof Element ? event.target : null, stateRef.current, {
        singleKeys: shortcutsRef.current,
      })
      if (!intent) return
      event.preventDefault()
      if (intent.type === "reveal") dispatch({ type: "reveal" })
      else void rate(intent.rating)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [rate])

  // Move focus with the review so screen readers read the new side and the
  // keyboard never falls back to the page: front on a new card, the answer
  // once shown, the summary at the end. Focus scrolls only when that part is
  // out of view (on a short window, where the bars don't stick).
  const position = state.position
  const phase = state.phase
  React.useEffect(() => {
    if (phase === "question") frontRef.current?.focus()
    else if (phase === "answer") answerRef.current?.focus()
    else doneRef.current?.focus()
  }, [phase, position])

  async function restart(scope: "due" | "all") {
    setRestarting(scope)
    try {
      const next = (await apiGet(
        `/api/flashcards/${encodeURIComponent(deck.id)}/study?scope=${scope}`
      )) as StudyData
      setReview(next)
      dispatch({ type: "reset", cards: next.cards, stats: next.stats })
      window.history.replaceState(null, "", `${window.location.pathname}${scope === "all" ? "?scope=all" : ""}`)
    } catch (err) {
      dispatch({ type: "rate-failure", message: `Cards didn't load. ${errorDetail(err)}` })
    } finally {
      setRestarting(null)
    }
  }

  const closeHref = "/flashcards"

  return (
    <LessonAnnouncer>
      <div className="flex min-h-dvh flex-1 flex-col">
        <TopBar
          state={state}
          closeHref={closeHref}
          shortcutsEnabled={shortcutsEnabled}
          onShortcutsEnabledChange={onShortcutsEnabledChange}
        />

        {state.total === 0 ? (
          <EmptyReview
            data={review}
            timeZone={timeZone}
            headingRef={doneRef}
            restarting={restarting}
            onReviewAll={() => restart("all")}
            error={state.error}
          />
        ) : state.phase === "done" ? (
          <ReviewSummary
            state={state}
            data={review}
            timeZone={timeZone}
            headingRef={doneRef}
            restarting={restarting}
            onReviewAgain={() => restart("all")}
            error={state.error}
          />
        ) : card ? (
          <>
            <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 pt-4 pb-10 sm:px-8 sm:pt-8">
              <div className="flex flex-col gap-3">
                <h1
                  ref={frontRef}
                  tabIndex={-1}
                  className="type-headline-s font-bold text-pretty whitespace-pre-line text-lesson-on-surface outline-none [overflow-wrap:anywhere] sm:type-headline-m sm:font-bold"
                >
                  {card.front}
                </h1>
                <ul aria-label="About this card" className="flex flex-wrap gap-2">
                  <li>
                    <Badge variant="secondary">{STATUS_LABELS[card.status]}</Badge>
                  </li>
                  {deck.kind === "generated"
                    ? card.tags.map((tag) => (
                        <li key={tag}>
                          <Badge variant="outline" className="max-w-56">
                            <span className="truncate">{tag}</span>
                          </Badge>
                        </li>
                      ))
                    : null}
                </ul>
              </div>

              {state.phase === "answer" ? (
                <section
                  ref={answerRef}
                  tabIndex={-1}
                  aria-labelledby="card-answer"
                  className={cn(
                    "flex animate-in fade-in-0 slide-in-from-bottom-2 duration-250 ease-emphasized flex-col gap-3 rounded-2xl border-2 border-lesson-option-border bg-lesson-option p-5 outline-none sm:p-6",
                    // Focus brings the whole answer out from under the top bar and the ratings
                    "scroll-mt-32 scroll-mb-56 short:scroll-m-4"
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 id="card-answer" className="type-title-m font-bold text-lesson-on-surface">
                      Answer
                    </h2>
                    {deck.kind === "generated" ? <AiTag tone="lesson" /> : null}
                  </div>
                  <p className="type-body-l whitespace-pre-line text-lesson-on-surface [overflow-wrap:anywhere]">
                    {card.back}
                  </p>
                  {deck.kind === "generated" ? (
                    <p className="type-body-s text-lesson-muted">
                      Written by AI from {deck.sourceTitle ?? `your ${deck.courseName} materials`}. Fix a wrong card on the
                      deck page.
                    </p>
                  ) : null}
                </section>
              ) : null}
            </div>

            <div
              className={cn(
                "sticky bottom-0 z-10 border-t-2 border-lesson-option-border bg-lesson-surface",
                STATIC_WHEN_SHORT
              )}
            >
              <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-8 sm:py-6">
                {state.error ? (
                  <p role="alert" className="flex items-start gap-2 type-body-m font-bold text-lesson-on-wrong">
                    <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    {state.error}
                  </p>
                ) : null}
                {state.phase === "question" ? (
                  <div className="flex justify-end">
                    <LessonButton
                      variant="primary"
                      kbd="Space"
                      className="w-full sm:w-auto sm:min-w-48"
                      onClick={() => dispatch({ type: "reveal" })}
                    >
                      Show answer
                    </LessonButton>
                  </div>
                ) : (
                  <fieldset className="flex flex-col gap-3">
                    <legend className="mb-3 type-title-s font-bold text-lesson-on-surface">
                      How well did you know it?
                    </legend>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {RATINGS.map((r) => (
                        <LessonButton
                          key={r.rating}
                          variant={r.variant}
                          kbd={shortcutsEnabled ? r.key : undefined}
                          width="full"
                          className="min-h-16 min-w-0 px-3"
                          loading={state.submitting === r.rating}
                          loadingLabel="Saving…"
                          disabled={state.submitting !== null && state.submitting !== r.rating}
                          onClick={() => void rate(r.rating)}
                        >
                          <span className="flex flex-col items-center leading-tight">
                            <span>{r.label}</span>
                            <span className="type-label-m font-medium">
                              <span className="sr-only">, next review in </span>
                              {intervalLabel(card.previews[r.rating])}
                            </span>
                          </span>
                        </LessonButton>
                      ))}
                    </div>
                  </fieldset>
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </LessonAnnouncer>
  )
}

function TopBar({
  state,
  closeHref,
  shortcutsEnabled,
  onShortcutsEnabledChange,
}: {
  state: ReviewState
  closeHref: string
  shortcutsEnabled: boolean
  onShortcutsEnabledChange: (enabled: boolean) => void
}) {
  const reviewing = state.total > 0 && state.phase !== "done"
  return (
    <div className={cn("sticky top-0 z-10 bg-lesson-surface", STATIC_WHEN_SHORT)}>
      <div className="mx-auto flex w-full max-w-4xl items-center gap-3 px-4 py-4 sm:gap-4 sm:px-8 sm:py-6">
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href={closeHref}
              aria-label="Leave review"
              className="flex size-11 shrink-0 items-center justify-center rounded-full text-lesson-muted transition-colors hover:bg-lesson-option-hover hover:text-lesson-on-surface"
            >
              <XIcon className="size-6" strokeWidth={2.5} aria-hidden="true" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="bottom">Leave review. Your ratings are saved.</TooltipContent>
        </Tooltip>
        <ReviewProgress done={state.phase === "done" ? state.total : state.finished} total={state.total} className="flex-1" />
        {reviewing ? (
          <p className="shrink-0 type-label-l font-bold text-lesson-muted tabular-nums">
            {formatNumber(state.finished)} of {formatNumber(state.total)}
            <span className="sr-only sm:not-sr-only"> done</span>
          </p>
        ) : null}
        {reviewing ? (
          <ReviewKeyboardHelp shortcutsEnabled={shortcutsEnabled} onShortcutsEnabledChange={onShortcutsEnabledChange} />
        ) : null}
      </div>
      {reviewing ? (
        <div className="mx-auto -mt-2 w-full max-w-4xl px-4 pb-2 sm:px-8">
          <DeckCounts counts={state.stats} size="compact" className="text-lesson-muted" />
        </div>
      ) : null}
    </div>
  )
}

function ReviewSummary({
  state,
  data,
  timeZone,
  headingRef,
  restarting,
  onReviewAgain,
  error,
}: {
  state: ReviewState
  data: StudyData
  timeZone: string
  headingRef: React.Ref<HTMLHeadingElement>
  restarting: string | null
  onReviewAgain: () => void
  error: string | null
}) {
  const reviewed = state.finished
  const next = nextDueText(state, data, timeZone)
  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-8 px-4 py-12 text-center sm:px-8">
      <span className="flex size-16 items-center justify-center rounded-full bg-lesson-check text-lesson-on-check">
        <CheckIcon className="size-8" strokeWidth={3} aria-hidden="true" />
      </span>
      <div className="flex flex-col gap-2">
        <h1 ref={headingRef} tabIndex={-1} className="type-headline-m font-bold text-lesson-on-surface outline-none">
          Deck reviewed
        </h1>
        <p className="type-body-l text-lesson-muted">
          {plural(reviewed, { one: "# card reviewed in", other: "# cards reviewed in" })} {data.deck.title}.
          {state.xp > 0 ? ` ${formatNumber(state.xp)} XP earned.` : null}
        </p>
      </div>

      <dl className="grid w-full grid-cols-4 gap-2 rounded-2xl border-2 border-lesson-option-border p-4">
        {RATINGS.map((r) => (
          <div key={r.rating} className="flex flex-col-reverse gap-0.5">
            <dt className="type-label-m text-lesson-muted">{r.label}</dt>
            <dd className="type-title-l font-bold text-lesson-on-surface tabular-nums">
              {formatNumber(state.ratings[r.rating])}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex w-full flex-col gap-2">
        <DeckCounts counts={state.stats} className="text-left" />
        {state.perfectDeck ? (
          <p className="type-body-m text-lesson-muted">Every card in this deck was rated Hard or better today.</p>
        ) : null}
        {next ? <p className="type-body-m text-lesson-muted">{next}</p> : null}
      </div>

      {error ? (
        <p role="alert" className="type-body-m font-bold text-lesson-on-wrong">
          {error}
        </p>
      ) : null}

      <div className="flex w-full flex-col-reverse gap-3 sm:flex-row sm:justify-center">
        <LessonButton
          variant="neutral"
          onClick={onReviewAgain}
          loading={restarting === "all"}
          loadingLabel="Loading cards…"
          disabled={restarting !== null && restarting !== "all"}
        >
          {/* It reviews every card, which is "again" only after a whole-deck review */}
          {data.scope === "all" ? "Review again" : "Review deck"}
        </LessonButton>
        <LessonButton asChild variant="primary">
          <Link href="/flashcards">Go to Flashcards</Link>
        </LessonButton>
      </div>
    </div>
  )
}

function nextDueText(state: ReviewState, data: StudyData, timeZone: string): string | null {
  if (state.stats.dueCount > 0) {
    return plural(state.stats.dueCount, {
      one: "1 card in this deck is still due today.",
      other: "# cards in this deck are still due today.",
    })
  }
  // Cards left out of a due-only review keep the server's next date; every
  // rated card reports its own.
  const candidates = [state.earliestNext, data.scope === "due" ? data.nextDueAt : null].filter(
    (d): d is string => Boolean(d)
  )
  if (candidates.length === 0) return null
  const when = candidates.sort()[0]
  return `Next card due ${formatDateWeekday(when, { timeZone })} (${formatRelativeDay(when, { timeZone })}).`
}

function EmptyReview({
  data,
  timeZone,
  headingRef,
  restarting,
  onReviewAll,
  error,
}: {
  data: StudyData
  timeZone: string
  headingRef: React.Ref<HTMLHeadingElement>
  restarting: string | null
  onReviewAll: () => void
  error: string | null
}) {
  const emptyDeck = data.stats.newCount + data.stats.learningCount + data.stats.reviewCount + data.stats.masteredCount === 0
  const next = data.nextDueAt
    ? `The next card is due ${formatDateWeekday(data.nextDueAt, { timeZone })} (${formatRelativeDay(data.nextDueAt, { timeZone })}).`
    : null

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-secondary-container text-on-secondary-container">
        <LayersIcon className="size-8" aria-hidden="true" />
      </span>
      <div className="flex flex-col gap-2">
        <h1 ref={headingRef} tabIndex={-1} className="type-headline-s font-bold text-balance text-lesson-on-surface outline-none">
          {emptyDeck ? `No cards in ${data.deck.title}` : `Nothing due in ${data.deck.title}`}
        </h1>
        <p className="type-body-l text-pretty text-lesson-muted">
          {emptyDeck
            ? "Add cards to this deck, then review them here."
            : `${next ? `${next} ` : ""}Reviewing a card before it's due moves it further out.`}
        </p>
      </div>
      {error ? (
        <p role="alert" className="type-body-m font-bold text-lesson-on-wrong">
          {error}
        </p>
      ) : null}
      <div className="flex w-full flex-col-reverse gap-3 sm:flex-row sm:justify-center">
        {emptyDeck ? (
          <LessonButton asChild variant="neutral">
            <Link href="/flashcards">Go to Flashcards</Link>
          </LessonButton>
        ) : (
          <LessonButton variant="neutral" onClick={onReviewAll} loading={restarting === "all"} loadingLabel="Loading cards…">
            Review deck
          </LessonButton>
        )}
        {emptyDeck ? (
          <LessonButton asChild variant="primary">
            <Link href={`/flashcards/${data.deck.id}`}>Add cards</Link>
          </LessonButton>
        ) : (
          <LessonButton asChild variant="primary">
            <Link href="/flashcards">Go to Flashcards</Link>
          </LessonButton>
        )}
      </div>
    </div>
  )
}
