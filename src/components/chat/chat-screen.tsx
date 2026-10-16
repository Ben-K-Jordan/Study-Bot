"use client"

import * as React from "react"
import Link from "next/link"
import { MessagesSquareIcon, Trash2Icon, UploadIcon } from "lucide-react"
import { toast } from "sonner"

import { ApiError, apiDelete, apiPost } from "@/lib/client-api"
import { daysUntil, formatDate, formatDateWeekday, plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useApi } from "@/lib/swr"
import { useActiveCourse } from "@/hooks/use-active-course"
import { useCourseOptions } from "@/hooks/use-course-options"
import type { CoursePreference } from "@/components/study/course-preference"
import { usePreferredCourse } from "@/components/study/use-preferred-course"
import { useMounted } from "@/hooks/use-mounted"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { CourseSwitcher } from "@/components/app/course-switcher"
import { EmptyState } from "@/components/app/empty-state"
import { ErrorState } from "@/components/app/error-state"
import { LoadingRegion } from "@/components/app/skeletons"
import { Button } from "@/components/ui/button"
import { FieldLabel } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { errorDetail } from "@/components/cards/error-copy"
import {
  AnswerBlock,
  NoticeBlock,
  QuestionBubble,
  SearchingRow,
  UnansweredRow,
  preloadAnswerMarkdown,
} from "@/components/chat/chat-message"
import { Composer, type ComposerHandle } from "@/components/chat/composer"
import type { AnswerResponse, ChatMessage, PendingQuestion } from "@/components/chat/chat-types"
import { useAppendToHistory, useChatHistory } from "@/components/chat/use-chat-history"

const DOCUMENTS_KEY = "/api/content/documents?namespace=COURSE"

/**
 * Sticky bars give their space back on short windows (a phone in landscape,
 * a laptop at 200 to 400% zoom), so the thread between them stays in view.
 */
const STATIC_WHEN_SHORT = "short:static"

/**
 * Focused controls in the thread scroll clear of the question bar and, under
 * 600px, the bottom bar beneath it (the global :focus margin covers only the
 * bottom bar). --composer-height is measured in ChatThread.
 */
const CLEAR_OF_COMPOSER =
  "[&_:focus]:scroll-mb-[calc(var(--bottom-bar-height)+var(--composer-height,8rem)+1rem)] sm:[&_:focus]:scroll-mb-[calc(var(--composer-height,8rem)+1rem)]"
/** The same margin for the end-of-thread marker that new messages scroll to. */
const CLEAR_OF_COMPOSER_SELF =
  "scroll-mb-[calc(var(--bottom-bar-height)+var(--composer-height,8rem)+1rem)] sm:scroll-mb-[calc(var(--composer-height,8rem)+1rem)]"

interface DocumentsResponse {
  documents?: { course_name: string | null; exam_name: string | null; suggested_questions: string[] | null }[]
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/**
 * Chat over one course's materials: the course picker, the history (newest
 * 50, older on demand), answers with numbered sources, and the question
 * box. Questions and answers are stored by the answer route, so a failed
 * answer never duplicates or loses the question.
 */
export function ChatScreen({
  timeZone,
  coursePreferences,
}: {
  timeZone: string
  /** Courses to open on when none is chosen: today's session, then exams by date. */
  coursePreferences?: CoursePreference[]
}) {
  const mounted = useMounted()
  const { options, keys: courseKeys, error: coursesError, retry } = useCourseOptions()
  const keys = usePreferredCourse(courseKeys, coursePreferences)
  const { activeCourse, course } = useActiveCourse(keys)

  const [pending, setPending] = React.useState<PendingQuestion[]>([])
  const [failedAnswers, setFailedAnswers] = React.useState<Record<string, string>>({})
  const [status, setStatus] = React.useState("")
  const append = useAppendToHistory()
  const composerRef = React.useRef<ComposerHandle>(null)
  const activeRef = React.useRef(activeCourse)
  React.useEffect(() => {
    activeRef.current = activeCourse
  })

  // The answer renderer loads alongside the history request, not after it
  React.useEffect(() => preloadAnswerMarkdown(), [])

  const ask = React.useCallback(
    async (question: string, opts: { questionId?: string; localId?: string } = {}) => {
      if (!activeCourse || !course) return
      const courseKey = activeCourse
      const localId = opts.localId ?? `local-${Date.now()}-${Math.random().toString(36).slice(2)}`
      setPending((prev) => [
        ...prev.filter((p) => p.localId !== localId),
        { localId, courseKey, question, status: "sending", questionId: opts.questionId },
      ])
      if (opts.questionId) {
        const id = opts.questionId
        setFailedAnswers((prev) => {
          const next = { ...prev }
          delete next[id]
          return next
        })
      }
      setStatus(`Searching your ${course.courseName} materials…`)

      try {
        const res = (await apiPost("/api/assistant/answer", {
          question,
          course_name: course.courseName,
          exam_name: course.examName ?? undefined,
          save: true,
          question_id: opts.questionId,
        })) as AnswerResponse
        append(courseKey, [res.question, res.answer].filter((m): m is ChatMessage => Boolean(m)))
        setPending((prev) => prev.filter((p) => p.localId !== localId))
        if (activeRef.current === courseKey) setStatus(res.kind === "notice" ? "No answer from your materials." : "Answer ready.")
      } catch (err) {
        const message = `Answer not generated. ${errorDetail(err)}`
        const saved =
          err instanceof ApiError ? (err.body as { question?: ChatMessage } | null)?.question : undefined
        if (saved) {
          append(courseKey, [saved])
          setFailedAnswers((prev) => ({ ...prev, [saved.id]: message }))
          setPending((prev) => prev.filter((p) => p.localId !== localId))
        } else {
          setPending((prev) =>
            prev.map((p) => (p.localId === localId ? { ...p, status: "failed", error: message } : p))
          )
        }
        if (activeRef.current === courseKey) setStatus(message)
      }
    },
    [activeCourse, course, append]
  )

  if (!mounted || (!options && !coursesError)) return <ChatSkeleton />

  if (!options) {
    return <ErrorState title="Courses didn't load." description="Chat needs your course list. Retry in a minute." onRetry={retry} />
  }

  if (options.length === 0 || !activeCourse || !course) {
    return (
      <EmptyState
        icon={MessagesSquareIcon}
        headingLevel="h2"
        title="No materials yet"
        description="Chat answers questions from your course materials and lists the files and pages it used. Upload materials for a course to start."
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
    <ChatThread
      key={activeCourse}
      courseKey={activeCourse}
      courseName={course.courseName}
      examName={course.examName}
      timeZone={timeZone}
      pending={pending.filter((p) => p.courseKey === activeCourse)}
      failedAnswers={failedAnswers}
      onAsk={ask}
      onDismissPending={(localId) => setPending((prev) => prev.filter((p) => p.localId !== localId))}
      onHistoryDeleted={() => {
        setFailedAnswers({})
        setPending((prev) => prev.filter((p) => p.courseKey !== activeCourse || p.status === "sending"))
      }}
      composerRef={composerRef}
      status={status}
    />
  )
}

type Row =
  | { type: "day"; key: string; label: string }
  | { type: "message"; key: string; message: ChatMessage; unanswered: boolean }

function dayLabel(iso: string, timeZone: string): string {
  const diff = daysUntil(iso, { timeZone })
  if (diff === 0) return "Today"
  if (diff === -1) return "Yesterday"
  return diff > -7 ? formatDateWeekday(iso, { timeZone }) : formatDate(iso, { timeZone })
}

function buildRows(messages: ChatMessage[], timeZone: string): Row[] {
  const rows: Row[] = []
  let lastDay = ""
  messages.forEach((message, i) => {
    const day = dayLabel(message.createdAt, timeZone)
    if (day !== lastDay) {
      rows.push({ type: "day", key: `day-${message.id}`, label: day })
      lastDay = day
    }
    const next = messages[i + 1]
    rows.push({
      type: "message",
      key: message.id,
      message,
      unanswered: message.role === "user" && (!next || next.role !== "assistant"),
    })
  })
  return rows
}

function ChatThread({
  courseKey,
  courseName,
  examName,
  timeZone,
  pending,
  failedAnswers,
  onAsk,
  onDismissPending,
  onHistoryDeleted,
  composerRef,
  status,
}: {
  courseKey: string
  courseName: string
  examName: string | null
  timeZone: string
  pending: PendingQuestion[]
  failedAnswers: Record<string, string>
  onAsk: (question: string, retry?: { questionId?: string; localId?: string }) => void
  onDismissPending: (localId: string) => void
  onHistoryDeleted: () => void
  composerRef: React.RefObject<ComposerHandle | null>
  status: string
}) {
  const history = useChatHistory(courseKey)
  const { data: docs } = useApi<DocumentsResponse>(DOCUMENTS_KEY)
  const sending = pending.some((p) => p.status === "sending")
  const messages = history.messages
  const rows = React.useMemo(() => (messages ? buildRows(messages, timeZone) : []), [messages, timeZone])

  const suggestions = React.useMemo(() => {
    const out: string[] = []
    for (const doc of docs?.documents ?? []) {
      if (doc.course_name !== courseName || (doc.exam_name ?? null) !== examName) continue
      for (const q of doc.suggested_questions ?? []) if (q && !out.includes(q)) out.push(q)
    }
    return out.slice(0, 3)
  }, [docs, courseName, examName])

  // Scrolling: to the end when the history first arrives; to the newest
  // row as questions and answers are added; and kept in place when older
  // messages load above.
  const lastRowRef = React.useRef<HTMLDivElement>(null)
  const endRef = React.useRef<HTMLDivElement>(null)
  const olderAnchor = React.useRef<{ height: number; y: number } | null>(null)
  const firstId = messages?.[0]?.id
  const lastKey = pending.length > 0 ? `${pending[pending.length - 1].localId}-${pending[pending.length - 1].status}` : messages?.[messages.length - 1]?.id
  const initialScrollDone = React.useRef(false)

  React.useLayoutEffect(() => {
    if (!messages || initialScrollDone.current) return
    initialScrollDone.current = true
    // An empty chat stays at the top, with the course picker in view
    if (messages.length > 0) window.scrollTo({ top: document.documentElement.scrollHeight })
  }, [messages])

  React.useLayoutEffect(() => {
    const anchor = olderAnchor.current
    if (!anchor) return
    olderAnchor.current = null
    window.scrollTo({ top: anchor.y + (document.documentElement.scrollHeight - anchor.height) })
  }, [firstId])

  const previousLast = React.useRef(lastKey)
  React.useEffect(() => {
    if (previousLast.current === lastKey) return
    const first = previousLast.current === undefined
    previousLast.current = lastKey
    if (first) return
    const behavior = prefersReducedMotion() ? "auto" : "smooth"
    const last = lastRowRef.current
    if (last?.dataset.kind === "answer") last.scrollIntoView({ block: "start", behavior })
    else endRef.current?.scrollIntoView({ block: "end", behavior })
  }, [lastKey])

  function loadOlder() {
    olderAnchor.current = { height: document.documentElement.scrollHeight, y: window.scrollY }
    void history.loadOlder()
  }

  function retryOlder() {
    olderAnchor.current = { height: document.documentElement.scrollHeight, y: window.scrollY }
    void history.retryOlder()
  }

  // The question bar sticks above the bottom bar while the thread scrolls.
  // Its height goes in --composer-height, so controls focused in the thread
  // stop above it instead of under it. On a short window the bar doesn't
  // stick (see STATIC_WHEN_SHORT) and reserves nothing.
  const composerId = React.useId()
  const rootRef = React.useRef<HTMLDivElement>(null)
  const composerBarRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const root = rootRef.current
    const bar = composerBarRef.current
    if (!root || !bar) return
    const measure = () => {
      const sticky = getComputedStyle(bar).position === "sticky"
      root.style.setProperty("--composer-height", sticky ? `${bar.offsetHeight}px` : "0px")
    }
    measure()
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure)
    observer?.observe(bar)
    window.addEventListener("resize", measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [])

  // After Delete chat history the button goes with the history, so focus
  // moves to the question box; after Cancel it returns to the button.
  const afterDeleteRef = React.useRef<HTMLElement | null>(null)

  async function deleteHistory() {
    await apiDelete(`/api/chat/messages?courseKey=${encodeURIComponent(courseKey)}`)
    afterDeleteRef.current = document.getElementById(composerId)
    await history.mutate([{ messages: [], has_more: false, total: 0 }], { revalidate: false })
    onHistoryDeleted()
    toast("Chat history deleted")
    composerRef.current?.focus()
  }

  const lastMessage = messages?.[messages.length - 1]

  // An empty thread keeps the label in the question bar, where it's always
  // in view; see the bar below.
  const labelInBar = !messages || (messages.length === 0 && pending.length === 0)
  const composerLabel = (className?: string) => (
    <FieldLabel htmlFor={composerId} className={cn("type-label-l", className)}>
      Ask about your {courseName} materials
    </FieldLabel>
  )

  return (
    <div ref={rootRef} className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <CourseSwitcher className="min-w-0" />
          {history.total > 0 ? (
            <ConfirmDialog
              trigger={
                <Button variant="text" disabled={sending}>
                  <Trash2Icon data-icon="inline-start" aria-hidden="true" />
                  Delete chat history
                </Button>
              }
              title={`Delete all ${courseName} chat messages?`}
              description={plural(history.total, {
                one: "This deletes 1 message. Your materials stay.",
                other: "This deletes # messages. Your materials stay.",
              })}
              confirmLabel="Delete messages"
              pendingLabel="Deleting messages…"
              failedMessage="Messages not deleted. Check your connection and retry."
              onOpenChange={(open) => {
                if (open) afterDeleteRef.current = null
              }}
              returnFocus={afterDeleteRef}
              onConfirm={deleteHistory}
            />
          ) : null}
        </div>
        <p className="type-body-m text-on-surface-variant">
          Answers are written by AI from your {courseName} materials and list their sources.
        </p>
      </div>

      <section aria-label={`Chat about ${courseName}`} className={cn("flex flex-1 flex-col gap-6", CLEAR_OF_COMPOSER)}>
        {history.error && !messages ? (
          <ErrorState
            title="Chat history didn't load."
            description={errorDetail(history.error)}
            onRetry={() => void history.mutate()}
          />
        ) : !messages ? (
          <ThreadSkeleton />
        ) : (
          <>
            {/* A failed page swaps the button for the failure and its Retry */}
            {history.error ? (
              <ErrorState title="Older messages didn't load." description={errorDetail(history.error)} onRetry={retryOlder} />
            ) : history.hasMore ? (
              <div className="flex justify-center">
                <Button variant="text" onClick={loadOlder} disabled={history.loadingOlder}>
                  {history.loadingOlder ? <Spinner data-icon="inline-start" aria-hidden="true" role={undefined} /> : null}
                  {history.loadingOlder ? "Loading older messages…" : "Load older messages"}
                </Button>
              </div>
            ) : null}

            {rows.length === 0 && pending.length === 0 ? (
              <EmptyState
                icon={MessagesSquareIcon}
                headingLevel="h2"
                title={`No questions about ${courseName} yet`}
                description={`Ask about anything in your ${courseName} materials. Each answer lists the files and pages it used.`}
                action={
                  suggestions.length > 0 ? (
                    <div className="flex w-full max-w-md flex-col gap-2">
                      <p className="type-label-l text-on-surface-variant">Questions from your materials</p>
                      <ul className="flex flex-col gap-2">
                        {suggestions.map((q) => (
                          <li key={q}>
                            <Button
                              variant="outline"
                              className="h-auto min-h-10 w-full justify-start rounded-2xl py-2.5 text-left whitespace-normal"
                              onClick={() => composerRef.current?.fill(q)}
                            >
                              {q}
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : undefined
                }
              />
            ) : null}

            {rows.map((row, i) => {
              if (row.type === "day") {
                return (
                  <h2 key={row.key} className="flex items-center gap-3 type-label-m text-on-surface-variant">
                    <span aria-hidden="true" className="h-px flex-1 bg-outline-variant" />
                    {row.label}
                    <span aria-hidden="true" className="h-px flex-1 bg-outline-variant" />
                  </h2>
                )
              }
              const { message } = row
              const isLast = i === rows.length - 1 && pending.length === 0
              const retrying = pending.find((p) => p.questionId === message.id && p.status === "sending")
              return (
                <div
                  key={row.key}
                  ref={isLast ? lastRowRef : undefined}
                  data-kind={message.kind}
                  className="flex flex-col gap-3"
                >
                  {message.kind === "question" ? (
                    <QuestionBubble content={message.content} />
                  ) : message.kind === "notice" ? (
                    <NoticeBlock content={message.content} />
                  ) : (
                    <AnswerBlock message={message} />
                  )}
                  {retrying ? <SearchingRow courseName={courseName} /> : null}
                  {row.unanswered && !retrying ? (
                    <UnansweredRow
                      error={failedAnswers[message.id]}
                      onRetry={
                        message.id === lastMessage?.id && !sending
                          ? () => onAsk(message.content, { questionId: message.id })
                          : undefined
                      }
                    />
                  ) : null}
                </div>
              )
            })}

            {pending
              .filter((p) => !p.questionId)
              .map((p, i, list) => (
                <div
                  key={p.localId}
                  ref={i === list.length - 1 ? lastRowRef : undefined}
                  data-kind="pending"
                  className="flex flex-col gap-3"
                >
                  <QuestionBubble content={p.question} pending={p.status === "sending"} />
                  {p.status === "sending" ? (
                    <SearchingRow courseName={courseName} />
                  ) : (
                    <div className="flex flex-wrap items-center gap-x-1">
                      <UnansweredRow
                        error={p.error}
                        onRetry={sending ? undefined : () => onAsk(p.question, { localId: p.localId })}
                      />
                      <Button variant="text" size="sm" onClick={() => onDismissPending(p.localId)}>
                        Dismiss
                      </Button>
                    </div>
                  )}
                </div>
              ))}
          </>
        )}
        <div ref={endRef} className={CLEAR_OF_COMPOSER_SELF} />
      </section>

      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>

      {/* Once the thread has messages, the label sits just above the bar
          (the thread opens scrolled to the end, so it shows there), which
          keeps the part that sticks over the thread short. */}
      {labelInBar ? null : composerLabel("-mb-6")}
      <div
        ref={composerBarRef}
        className={cn(
          "sticky bottom-[calc(var(--bottom-bar-height)+env(safe-area-inset-bottom))] z-10 -mx-4 flex flex-col gap-2 bg-background px-4 pt-2 pb-4 sm:bottom-0 sm:-mx-6 sm:px-6 md:-mx-8 md:px-8",
          STATIC_WHEN_SHORT
        )}
      >
        {labelInBar ? composerLabel() : null}
        <Composer ref={composerRef} id={composerId} busy={sending} onAsk={(q) => onAsk(q)} />
      </div>
    </div>
  )
}

function ThreadSkeleton() {
  return (
    <LoadingRegion label="Loading chat history…" className="flex flex-col gap-6">
      <div aria-hidden="true" className="flex flex-col gap-6">
        <div className="flex justify-end">
          <Skeleton className="h-11 w-3/5 rounded-3xl" />
        </div>
        <div className="flex flex-col gap-2.5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <div className="flex justify-end">
          <Skeleton className="h-11 w-2/5 rounded-3xl" />
        </div>
      </div>
    </LoadingRegion>
  )
}

/** The whole chat area before the course list (and the stored course) is known. */
export function ChatSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div aria-hidden="true" className="flex flex-col gap-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-10 w-56 rounded-md" />
        <Skeleton className="mt-1 h-4 w-80 max-w-full" />
      </div>
      <ThreadSkeleton />
    </div>
  )
}
