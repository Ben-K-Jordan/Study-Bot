import type {
  CardStatus,
  IntervalPreviews,
  ReviewRating,
  StudyCard,
  StudyStats,
} from "@/services/spaced-repetition"
import { formatNumber } from "@/lib/format"

/**
 * The review's state machine, kept free of React so it can be tested:
 * question (front only) -> answer (back shown, ratings live) -> next card
 * or done. A card rated Again goes to the back of the queue (the 10-minute
 * learning step happens inside the review), so the review ends when every
 * card has been rated Hard, Good or Easy once.
 */

export type ReviewPhase = "question" | "answer" | "done"

export interface ReviewCardState {
  id: string
  front: string
  back: string
  tags: string[]
  status: CardStatus
  due: boolean
  previews: IntervalPreviews
}

export interface ReviewState {
  cards: Record<string, ReviewCardState>
  /** Card ids in review order; a card rated Again is appended again. */
  queue: string[]
  /** Index in `queue` of the card on screen. */
  position: number
  /** Distinct cards in this review. */
  total: number
  /** Cards rated Hard, Good or Easy. */
  finished: number
  phase: ReviewPhase
  /** The rating being saved, if any. */
  submitting: ReviewRating | null
  /** Why the last rating didn't save. */
  error: string | null
  ratings: Record<ReviewRating, number>
  xp: number
  perfectDeck: boolean
  /** Counts over the whole deck, kept current as cards are rated. */
  stats: StudyStats
  /** Earliest next review among cards rated in this review that left today. */
  earliestNext: string | null
}

export interface RatingResult {
  status: CardStatus
  intervalDays: number
  nextDueAt: string
  previews: IntervalPreviews
  xpEarned?: number
  perfectDeck?: boolean
}

export type ReviewAction =
  | { type: "reveal" }
  | { type: "rate-start"; rating: ReviewRating }
  | { type: "rate-success"; rating: ReviewRating; result: RatingResult }
  | { type: "rate-failure"; message: string }
  | { type: "reset"; cards: StudyCard[]; stats: StudyStats }

const STATUS_KEY: Record<CardStatus, keyof Omit<StudyStats, "dueCount">> = {
  new: "newCount",
  learning: "learningCount",
  review: "reviewCount",
  mastered: "masteredCount",
}

export function initialReviewState(cards: StudyCard[], stats: StudyStats): ReviewState {
  const byId: Record<string, ReviewCardState> = {}
  for (const card of cards) {
    byId[card.id] = {
      id: card.id,
      front: card.front,
      back: card.back,
      tags: (card.tags ?? []).filter((t) => t !== "auto-repair"),
      status: card.status,
      due: card.due,
      previews: card.previews,
    }
  }
  return {
    cards: byId,
    queue: cards.map((c) => c.id),
    position: 0,
    total: cards.length,
    finished: 0,
    phase: cards.length === 0 ? "done" : "question",
    submitting: null,
    error: null,
    ratings: { AGAIN: 0, HARD: 0, GOOD: 0, EASY: 0 },
    xp: 0,
    perfectDeck: false,
    stats: { ...stats },
    earliestNext: null,
  }
}

/** The card on screen, or null when the review is done. */
export function currentCard(state: ReviewState): ReviewCardState | null {
  if (state.phase === "done") return null
  const id = state.queue[state.position]
  return id ? (state.cards[id] ?? null) : null
}

/**
 * The tab title for the screen on view, before " · Study Bot": "Card 2 of 12
 * · Recursion", "Deck reviewed · Recursion", "Nothing due · Recursion" or
 * "No cards · Recursion". A card rated Again keeps its number until a card
 * is rated Hard or better, like the "2 of 12 done" counter.
 */
export function reviewTitle(
  state: Pick<ReviewState, "phase" | "total" | "finished" | "stats">,
  deckTitle: string,
): string {
  if (state.total === 0) {
    const { newCount, learningCount, reviewCount, masteredCount } = state.stats
    const empty = newCount + learningCount + reviewCount + masteredCount === 0
    return `${empty ? "No cards" : "Nothing due"} · ${deckTitle}`
  }
  if (state.phase === "done") return `Deck reviewed · ${deckTitle}`
  const n = Math.min(state.finished + 1, state.total)
  return `Card ${formatNumber(n)} of ${formatNumber(state.total)} · ${deckTitle}`
}

export function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case "reveal":
      return state.phase === "question" ? { ...state, phase: "answer", error: null } : state

    case "rate-start":
      if (state.phase !== "answer" || state.submitting) return state
      return { ...state, submitting: action.rating, error: null }

    case "rate-failure":
      return { ...state, submitting: null, error: action.message }

    case "rate-success": {
      const card = currentCard(state)
      if (!card || state.phase !== "answer") return state
      const again = action.rating === "AGAIN"

      const stats = { ...state.stats }
      stats[STATUS_KEY[card.status]] = Math.max(0, stats[STATUS_KEY[card.status]] - 1)
      stats[STATUS_KEY[action.result.status]] += 1
      // Again keeps the card due today (10 minutes); any other rating moves
      // it to a later day.
      const stillDue = again || action.result.intervalDays === 0
      if (card.due && !stillDue) stats.dueCount = Math.max(0, stats.dueCount - 1)
      if (!card.due && stillDue) stats.dueCount += 1

      const updated: ReviewCardState = {
        ...card,
        status: action.result.status,
        due: stillDue,
        previews: action.result.previews,
      }
      const queue = again ? [...state.queue, card.id] : state.queue
      const position = state.position + 1
      return {
        ...state,
        cards: { ...state.cards, [card.id]: updated },
        queue,
        position,
        finished: again ? state.finished : state.finished + 1,
        phase: position >= queue.length ? "done" : "question",
        submitting: null,
        error: null,
        ratings: { ...state.ratings, [action.rating]: state.ratings[action.rating] + 1 },
        xp: state.xp + (action.result.xpEarned ?? 0),
        perfectDeck: state.perfectDeck || Boolean(action.result.perfectDeck),
        stats,
        earliestNext:
          stillDue || (state.earliestNext && state.earliestNext <= action.result.nextDueAt)
            ? state.earliestNext
            : action.result.nextDueAt,
      }
    }

    case "reset":
      return initialReviewState(action.cards, action.stats)
  }
}

/**
 * Whether a key press should act on the review, and how. Number keys rate
 * only after the answer is shown; they and "?" (the shortcuts help, with the
 * switch that turns them off) act only while single-key shortcuts are on
 * (WCAG 2.1.4). Space and Enter reveal the answer only when focus isn't on a
 * control (they keep activating a focused button or link). Nothing acts on
 * the done screen, while a rating saves, inside text fields or open menus
 * and dialogs, or with Alt, Ctrl or Cmd.
 */
export function keyIntent(
  event: { key: string; repeat: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean },
  target: { closest: (selector: string) => unknown } | null,
  state: Pick<ReviewState, "phase" | "submitting">,
  { singleKeys = true }: { singleKeys?: boolean } = {},
): { type: "reveal" } | { type: "help" } | { type: "rate"; rating: ReviewRating } | null {
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return null
  if (state.phase === "done" || state.submitting) return null
  if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]')) {
    return null
  }

  if (event.key === "?") return singleKeys ? { type: "help" } : null

  if (state.phase === "question" && (event.key === " " || event.key === "Enter")) {
    if (target?.closest('button, a[href], [role="button"], summary')) return null
    return { type: "reveal" }
  }

  if (state.phase === "answer" && singleKeys) {
    const rating = ({ "1": "AGAIN", "2": "HARD", "3": "GOOD", "4": "EASY" } as const)[event.key as "1"]
    if (rating) return { type: "rate", rating }
  }
  return null
}
