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
import { sessionTitle, useDocumentTitle } from "@/components/session/use-document-title"
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
  reviewTitle,
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
  const [helpOpen, setHelpOpen] = React.useState(false)

  // The tab follows the screen: "Card 2 of 12 · Recursion · Study Bot"
  useDocumentTitle(sessionTitle(reviewTitle(state, deck.title)))

  const topBarRef = React.useRef<HTMLDivElement>(null)
  const footerRef = React.useRef<HTMLDivElement>(null)
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
      else if (intent.type === "help") setHelpOpen(true)
      else void rate(intent.rating)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [rate])

  // Move focus with the review so screen readers read the new side and the
  // keyboard never falls back to the page: front on a new card, the answer
  // once shown, the summary at the end. Focus never scrolls by itself, since
  // a scroll margin can't know the sticky bars' height (the counts can wrap):
  // a new card or the summary starts at the top of the page, and a revealed
  // answer scrolls into view only as far as keeps the question clear of the
  // top bar.
  const position = state.position
  const phase = state.phase
  React.useEffect(() => {
    if (phase === "answer") {
      answerRef.current?.focus({ preventScroll: true })
      revealAnswer(answerRef.current, frontRef.current, topBarRef.current, footerRef.current)
      return
    }
    const target = phase === "question" ? frontRef.current : doneRef.current
    target?.focus({ preventScroll: true })
    window.scrollTo({ top: 0 })
  }, [phase, position])

  async function restart(scope: "due" | "all") {
    setRestarting(scope)
    setHelpOpen(false)
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
          ref={topBarRef}
          state={state}
          closeHref={closeHref}
          shortcutsEnabled={shortcutsEnabled}
          onShortcutsEnabledChange={onShortcutsEnabledChange}
          helpOpen={helpOpen}
          onHelpOpenChange={setHelpOpen}
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
                {/* On a phone the counts sit here: wrapped in the top bar, they would
                    take a second line from the card. */}
                <DeckCounts counts={state.stats} size="compact" className="text-lesson-muted sm:hidden" />
              </div>

              {state.phase === "answer" ? (
                <section
                  ref={answerRef}
                  tabIndex={-1}
                  aria-labelledby="card-answer"
                  className="flex animate-in fade-in-0 slide-in-from-bottom-2 duration-250 ease-emphasized flex-col gap-3 rounded-2xl border-2 border-lesson-option-border bg-lesson-option p-5 outline-none sm:p-6"
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
              ref={footerRef}
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
                            {/* The name reads "Again, next review in 10 min". The two lines are
                                blocks, and so is an sr-only span, and browsers put a space
                                before a block; zero-size inline text joins the label instead. */}
                            <span>
                              {r.label}
                              <span className="text-[0px]">, next review in</span>
                            </span>
                            <span className="type-label-m font-medium">{intervalLabel(card.previews[r.rating])}</span>
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

/**
 * Brings a revealed answer into view between the sticky bars: all of it when
 * that keeps the question clear of the top bar, else as much as does, and
 * always the answer's heading (on a small phone that may be all, until the
 * student scrolls). On a short window the bars don't stick, so the window's
 * edges count instead.
 */
function revealAnswer(
  answer: HTMLElement | null,
  question: HTMLElement | null,
  topBar: HTMLElement | null,
  footer: HTMLElement | null
) {
  if (!answer || !question) return
  const sticks = (el: HTMLElement | null): el is HTMLElement => el !== null && getComputedStyle(el).position === "sticky"
  const top = sticks(topBar) ? topBar.getBoundingClientRect().bottom : 0
  const bottom = sticks(footer) ? footer.getBoundingClientRect().top : window.innerHeight
  const gap = 16
  const box = answer.getBoundingClientRect()
  const toShowAll = box.bottom + gap - bottom
  if (toShowAll <= 0) return
  const toKeepQuestion = question.getBoundingClientRect().top - gap - top
  const toShowHeading = box.top + 56 - bottom
  const delta = Math.max(Math.min(toShowAll, toKeepQuestion), toShowHeading)
  if (delta > 0) window.scrollBy({ top: delta })
}

function TopBar({
  ref,
  state,
  closeHref,
  shortcutsEnabled,
  onShortcutsEnabledChange,
  helpOpen,
  onHelpOpenChange,
}: {
  ref: React.Ref<HTMLDivElement>
  state: ReviewState
  closeHref: string
  shortcutsEnabled: boolean
  onShortcutsEnabledChange: (enabled: boolean) => void
  helpOpen: boolean
  onHelpOpenChange: (open: boolean) => void
}) {
  const reviewing = state.total > 0 && state.phase !== "done"
  return (
    <div ref={ref} className={cn("sticky top-0 z-10 bg-lesson-surface", STATIC_WHEN_SHORT)}>
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
          <ReviewKeyboardHelp
            open={helpOpen}
            onOpenChange={onHelpOpenChange}
            shortcutsEnabled={shortcutsEnabled}
            onShortcutsEnabledChange={onShortcutsEnabledChange}
          />
        ) : null}
      </div>
      {reviewing ? (
        // From 600px up the counts fit on one line here; below, they sit under the question
        <div className="mx-auto -mt-2 hidden w-full max-w-4xl px-4 pb-2 sm:block sm:px-8">
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
