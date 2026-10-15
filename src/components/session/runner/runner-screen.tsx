"use client"

import * as React from "react"
import { CircleCheckBigIcon, ClipboardCheckIcon } from "lucide-react"

import { plural } from "@/lib/format"
import { useApi } from "@/lib/swr"
import { ErrorState } from "@/components/app/error-state"
import { LessonAnnouncer, useLessonAnnounce } from "@/components/lesson/lesson-announcer"
import { LessonButton } from "@/components/lesson/lesson-button"
import { LessonFrame } from "@/components/lesson/lesson-frame"
import { QuestionSkeleton } from "@/components/session/skeletons"

import { promptUrl, runUrl } from "./api"
import type { Outcome } from "./question-reducer"
import { QuestionScreen, type SavedAnswer } from "./question-screen"
import { readShortcutsEnabled, writeShortcutsEnabled } from "./storage"
import {
  resultCompletesRun,
  resultStartsBreak,
  type AttemptSubmitResult,
  type RunnerAttemptRecord,
  type RunnerPrompt,
  type RunnerRun,
  type RunnerSession,
} from "./types"

export interface RunnerScreenProps {
  run: RunnerRun
  session: RunnerSession
  /**
   * Saves an attempt. Resolves with the server's answer; null when a break
   * started first (nothing saved, the typed answer stays); rejects with an
   * error whose message is written for the student.
   */
  onSubmit: (attempt: Record<string, unknown>) => Promise<AttemptSubmitResult | null>
  /** Ends a run that is still open (POST /complete), then shows the results. */
  onComplete: () => void | Promise<void>
  /** After the last answer's feedback: "See results". Defaults to onComplete. */
  onFinish?: () => void | Promise<void>
  /** After feedback, when a break is due: "Take a break". */
  onBreak?: () => void
  /**
   * The question on screen changed (zero-based). While feedback is up the
   * run has already moved on, so the tab title follows this, not the run.
   */
  onQuestionShown?: (index: number) => void
}

/** The question on screen while its feedback is up, though the run has moved on. */
interface HeldQuestion {
  phase: string
  index: number
  prompt: RunnerPrompt
}

/**
 * The study loop as a lesson: one question per screen, a thick progress bar,
 * tactile answers and a feedback sheet. Owns which question is on screen;
 * each question's own state lives in QuestionScreen, keyed per question.
 */
export function RunnerScreen(props: RunnerScreenProps) {
  return (
    <LessonAnnouncer>
      <Runner {...props} />
    </LessonAnnouncer>
  )
}

function Runner({ run, session, onSubmit, onComplete, onFinish, onBreak, onQuestionShown }: RunnerScreenProps) {
  const announce = useLessonAnnounce()
  const [held, setHeld] = React.useState<HeldQuestion | null>(null)
  const [shortcutsEnabled, setShortcutsEnabled] = React.useState(readShortcutsEnabled)
  // The deck can grow when a missed question brings a repair question.
  const [baseTotal] = React.useState(run.prompt_count)

  // After the last exam answer the run turns to scoring: say so once.
  const [phaseSeen, setPhaseSeen] = React.useState(run.phase)
  const [scoringIntro, setScoringIntro] = React.useState(false)
  if (run.phase !== phaseSeen) {
    setPhaseSeen(run.phase)
    if (phaseSeen === "EXAM" && run.phase === "REVIEW") setScoringIntro(true)
  }

  const examSim = run.mode === "EXAM_SIM"
  const finished =
    run.status === "COMPLETED" ||
    (run.phase !== "EXAM" && run.prompt_count > 0 && run.current_index >= run.prompt_count)
  const livePrompt =
    run.current_prompt && run.current_prompt.prompt_index === run.current_index ? run.current_prompt : null

  // The next question didn't come with the run: load it here, so a failed
  // load shows Retry instead of a false "all done".
  const needPrompt = !held && !finished && !scoringIntro && !livePrompt
  const recovery = useApi<RunnerPrompt>(needPrompt ? promptUrl(run.run_id, run.current_index) : null)

  // Exam scoring shows each saved answer; load them when the run lacks them.
  const scoring = run.phase === "REVIEW"
  const needAttempts = scoring && !run.attempts
  const fetchedRun = useApi<{ attempts?: RunnerAttemptRecord[] }>(needAttempts ? runUrl(run.run_id) : null)
  const attempts = run.attempts ?? fetchedRun.data?.attempts

  const finish = onFinish ?? onComplete

  const submit = React.useCallback(
    async (attempt: Record<string, unknown>) => {
      // Keep this question on screen while the run advances underneath.
      const shownPrompt = held?.prompt ?? livePrompt ?? recovery.data ?? null
      if (shownPrompt) setHeld({ phase: run.phase, index: run.current_index, prompt: shownPrompt })
      try {
        const result = await onSubmit(attempt)
        if (result === null) setHeld(null)
        return result
      } catch (error) {
        setHeld(null)
        throw error
      }
    },
    [held, livePrompt, recovery.data, run.phase, run.current_index, onSubmit]
  )

  // An exam answer has no feedback to show, so a break it starts begins now.
  const examAnswered = React.useCallback(
    (result: AttemptSubmitResult) => {
      setHeld(null)
      if (resultStartsBreak(result) && !resultCompletesRun(result) && onBreak) onBreak()
    },
    [onBreak]
  )

  const continueAfter = React.useCallback(
    async (outcome: Outcome) => {
      if (outcome.completes) {
        await finish()
        return
      }
      if (outcome.startsBreak && onBreak) {
        onBreak()
        return
      }
      setHeld(null)
    },
    [finish, onBreak]
  )

  const onShortcutsEnabledChange = React.useCallback((enabled: boolean) => {
    setShortcutsEnabled(enabled)
    writeShortcutsEnabled(enabled)
  }, [])

  const injected = Math.max(0, run.prompt_count - baseTotal)
  const status: React.ReactNode = examSim ? (
    run.phase === "EXAM" ? (
      "Answering"
    ) : (
      "Scoring"
    )
  ) : injected > 0 ? (
    <>
      {session.mode_label}
      <span aria-hidden="true"> · </span>
      <span className="sr-only">, </span>
      <span>{plural(injected, { one: "# repair question added", other: "# repair questions added" })}</span>
    </>
  ) : (
    session.mode_label
  )

  const question = held ?? (livePrompt ? { phase: run.phase, index: run.current_index, prompt: livePrompt } : null)
  const recovered =
    !question && recovery.data && recovery.data.prompt_index === run.current_index
      ? { phase: run.phase, index: run.current_index, prompt: recovery.data }
      : null
  const shown = question ?? recovered
  const shownIndex = shown?.index ?? null

  React.useEffect(() => {
    if (shownIndex !== null) onQuestionShown?.(shownIndex)
  }, [shownIndex, onQuestionShown])

  if (shown && (held || (!finished && !scoringIntro))) {
    const attempt = shown.phase === "REVIEW" ? attempts?.find((a) => a.prompt_index === shown.index) : undefined
    const saved: SavedAnswer | null =
      shown.phase === "REVIEW"
        ? {
            status: attempt ? "ready" : fetchedRun.error ? "failed" : "loading",
            answer: attempt?.user_answer ?? null,
            confidence: attempt?.confidence_rating ?? null,
            retry: () => void fetchedRun.mutate(),
          }
        : null
    return (
      <QuestionScreen
        key={`${shown.phase}:${shown.index}`}
        runId={run.run_id}
        mode={run.mode}
        phase={shown.phase}
        index={shown.index}
        prompt={shown.prompt}
        total={Math.max(run.prompt_count, shown.index + 1)}
        status={status}
        saved={saved}
        submit={submit}
        onExamAnswered={examAnswered}
        onContinue={continueAfter}
        announce={(message) => announce?.(message)}
        shortcutsEnabled={shortcutsEnabled}
        onShortcutsEnabledChange={onShortcutsEnabledChange}
      />
    )
  }

  if (finished) {
    return <AllAnswered total={run.prompt_count} onFinish={run.status === "COMPLETED" ? finish : onComplete} />
  }

  if (scoringIntro) {
    return <ScoringIntro total={run.prompt_count} onStart={() => setScoringIntro(false)} />
  }

  if (recovery.error) {
    return (
      <LessonFrame
        current={run.current_index}
        total={run.prompt_count}
        status={status}
        question="The next question didn't load."
      >
        <ErrorState
          title="Your answers so far are saved."
          description="Check your connection, then retry."
          onRetry={() => void recovery.mutate()}
          retrying={recovery.isValidating}
        />
      </LessonFrame>
    )
  }

  return <QuestionSkeleton />
}

/** Every question is answered but the run is still open (a resumed run). */
function AllAnswered({ total, onFinish }: { total: number; onFinish: () => void | Promise<void> }) {
  const [finishing, setFinishing] = React.useState(false)
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    buttonRef.current?.focus()
  }, [])
  return (
    <LessonFrame
      current={total}
      total={total}
      questionNumber={total}
      question="All questions answered"
      footer={
        <LessonButton
          ref={buttonRef}
          variant="primary"
          kbd="Enter"
          loading={finishing}
          loadingLabel="Finishing session…"
          className="w-full sm:ml-auto sm:w-auto sm:min-w-44"
          onClick={async () => {
            if (finishing) return
            setFinishing(true)
            try {
              await onFinish()
            } finally {
              setFinishing(false)
            }
          }}
        >
          See results
        </LessonButton>
      }
    >
      <div className="flex items-start gap-3 type-body-l font-medium text-lesson-neutral-text">
        <CircleCheckBigIcon aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-lesson-on-correct" />
        <p>Your answers are saved. See your accuracy and the follow-up sessions this one sets up.</p>
      </div>
    </LessonFrame>
  )
}

/** Between the last exam answer and the first score. */
function ScoringIntro({ total, onStart }: { total: number; onStart: () => void }) {
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    buttonRef.current?.focus()
  }, [])
  return (
    <LessonFrame
      current={0}
      total={total}
      questionNumber={1}
      status="Scoring"
      question="All answers saved"
      footer={
        <LessonButton
          ref={buttonRef}
          variant="primary"
          kbd="Enter"
          className="w-full sm:ml-auto sm:w-auto sm:min-w-44"
          onClick={onStart}
        >
          Start scoring
        </LessonButton>
      }
    >
      <div className="flex items-start gap-3 type-body-l font-medium text-lesson-neutral-text">
        <ClipboardCheckIcon aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-lesson-muted" />
        <p>
          Now score each answer against its model answer. Feedback from your materials comes after each score.
        </p>
      </div>
    </LessonFrame>
  )
}
