"use client";

import { Suspense, use, useEffect, useRef } from "react";
import Link from "next/link";
import { BookLockIcon, BookOpenIcon, ClockIcon, CoffeeIcon, ListChecksIcon, TargetIcon } from "lucide-react";

import { breakSchedule } from "@/lib/breaks";
import {
  formatCountdown,
  formatDate,
  formatDuration,
  formatList,
  formatNumber,
  formatPercent,
  plural,
} from "@/lib/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/app/error-state";
import { LessonButton } from "@/components/lesson/lesson-button";
import { LessonProgress } from "@/components/lesson/lesson-frame";
import type { SessionErrorCopy } from "@/components/session/errors";
import { objectiveTitles, sessionHeading } from "@/components/session/session-heading";
import { Fact, FactList, SessionCloseButton, SessionScreen } from "@/components/session/session-screen";
import type { ActiveRunSummary, DeckComposition, SessionData } from "@/lib/session-types";
import { useHeadingFocus } from "@/components/session/use-heading-focus";
import { useZone } from "@/components/session/use-zone";

interface Props {
  session: SessionData;
  /** Streamed from the server; resolves to null when the preview failed. */
  deckPreview: Promise<DeckComposition | null>;
  /** The open run to resume, or null to start a new one. */
  resumable: ActiveRunSummary | null;
  /** The last finished run, for "Last time: 80% accuracy". */
  lastResult: { accuracy: number; endedAt: string | null } | null;
  starting: boolean;
  error: SessionErrorCopy | null;
  onStart: () => void;
  /** Warm up the question screen's code before it is needed. */
  onPreload: () => void;
  /**
   * Move focus to the heading (after coming back from the results). It also
   * moves there when the page opens with nothing focused, as after a link.
   */
  focusOnMount?: boolean;
}

/** The lesson intro: what this session is, how big it is, and one big Start session button. */
export function PreflightScreen({
  session,
  deckPreview,
  resumable,
  lastResult,
  starting,
  error,
  onStart,
  onPreload,
  focusOnMount = false,
}: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { timeZone, ready } = useZone(session.timezone);
  const outcome = session.target_outcome;
  const plannedCount =
    resumable?.prompt_count ?? (typeof outcome?.prompt_count === "number" ? outcome.prompt_count : null);
  const targetAccuracy = typeof outcome?.target_accuracy === "number" ? outcome.target_accuracy : null;
  const closedBook = outcome?.closed_book_required === true;
  const breaks = breakSchedule(session.break_protocol as { type?: string; cycles?: number } | null);
  const topics = objectiveTitles(session.objectives);
  const heading = sessionHeading(session.mode_label, session.topic_scope, topics);

  useHeadingFocus(headingRef, focusOnMount);

  // Enter starts the session, as it checks an answer on the question screens.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Enter" || event.repeat || event.defaultPrevented) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target && target.closest("a, button, input, textarea, select, [role='button'], [contenteditable='true']")) return;
      event.preventDefault();
      onStart();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onStart]);

  // Load the question screen's code while the student reads this one.
  useEffect(() => {
    const idle = window.requestIdleCallback?.(onPreload) ?? window.setTimeout(onPreload, 1500);
    return () => {
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
  }, [onPreload]);

  const countdown =
    session.exam_date && ready
      ? formatCountdown(session.exam_name, session.exam_date, { timeZone })
      : session.exam_name;

  return (
    <SessionScreen
      topBar={
        <SessionCloseButton hint={resumable ? "Your answers are saved." : undefined} />
      }
      footer={
        <>
          <p role="status" aria-live="polite" className="type-body-m text-lesson-muted">
            {starting ? "Preparing questions. This can take up to a minute." : ""}
          </p>
          <LessonButton
            variant="primary"
            width="full"
            className="sm:w-auto"
            kbd="Enter"
            loading={starting}
            loadingLabel={resumable ? "Resuming session…" : "Starting session…"}
            onClick={onStart}
            onPointerEnter={onPreload}
            onFocus={onPreload}
          >
            {resumable ? "Resume session" : "Start session"}
          </LessonButton>
        </>
      }
    >
      <header className="flex flex-col gap-3">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="type-headline-s font-bold text-balance text-lesson-on-surface wrap-break-word outline-none sm:type-headline-m sm:font-bold"
        >
          {heading.text}
        </h1>
        <p className="type-title-m text-lesson-muted wrap-break-word">
          {session.course_name}
          <span aria-hidden="true"> · </span>
          <span className="sr-only">, </span>
          {countdown}
        </p>
        {session.mode_description ? (
          <p className="type-body-l text-pretty text-lesson-on-surface">{session.mode_description}</p>
        ) : null}
      </header>

      {resumable ? <ResumeProgress run={resumable} isExamSim={session.mode === "EXAM_SIM"} /> : null}

      <FactList>
        <Fact
          icon={ListChecksIcon}
          label="Questions"
          detail={
            <Suspense fallback={<Skeleton aria-hidden="true" className="h-4 w-48 max-w-full" />}>
              <DeckDetail deckPreview={deckPreview} />
            </Suspense>
          }
        >
          {plannedCount != null ? (
            plural(plannedCount, { one: "# question", other: "# questions" })
          ) : (
            <Suspense fallback={<Skeleton aria-hidden="true" className="h-5 w-28" />}>
              <DeckTotal deckPreview={deckPreview} />
            </Suspense>
          )}
        </Fact>
        <Fact icon={ClockIcon} label="Planned time">
          {formatDuration(session.planned_minutes)}
        </Fact>
        {targetAccuracy != null ? (
          <Fact icon={TargetIcon} label="Target accuracy">
            {formatPercent(targetAccuracy)}
          </Fact>
        ) : null}
        {closedBook ? (
          <Fact icon={BookLockIcon} label="Notes">
            Closed until you check each answer
          </Fact>
        ) : null}
        {breaks ? (
          <Fact icon={CoffeeIcon} label="Breaks">
            {plural(breaks.blocks, {
              one: `# block of ${formatDuration(breaks.workMinutes)}`,
              other: `# blocks of ${formatDuration(breaks.workMinutes)}, with a ${formatDuration(breaks.breakMinutes)} break between blocks`,
            })}
          </Fact>
        ) : null}
        {topics.length > 0 && !heading.namesAllTopics ? (
          <Fact icon={BookOpenIcon} label={plural(topics.length, { one: "Topic", other: "Topics" })}>
            {formatList(topics)}
          </Fact>
        ) : null}
      </FactList>

      <Suspense fallback={null}>
        <PretestNote deckPreview={deckPreview} />
      </Suspense>

      {lastResult && !resumable ? (
        <p className="type-body-m text-lesson-muted">
          {lastResult.endedAt && ready
            ? `Last time: ${formatPercent(lastResult.accuracy)} accuracy, ${formatDate(lastResult.endedAt, { timeZone })}.`
            : `Last time: ${formatPercent(lastResult.accuracy)} accuracy.`}
        </p>
      ) : null}

      {error ? (
        <ErrorState
          title={error.title}
          description={
            error.signIn ? (
              <>
                {error.description}{" "}
                <Link href={`/auth/signin?callbackUrl=${encodeURIComponent(`/s/${session.session_id}`)}`}>
                  Sign in
                </Link>
              </>
            ) : (
              error.description
            )
          }
        />
      ) : null}
    </SessionScreen>
  );
}

function ResumeProgress({ run, isExamSim }: { run: ActiveRunSummary; isExamSim: boolean }) {
  const total = run.prompt_count;
  const scoring = isExamSim && run.phase === "REVIEW";
  const answered = scoring ? run.current_index : (run.answered_count ?? run.current_index);
  const done = formatNumber(answered);
  let message: string;
  if (scoring && answered === 0) {
    message = plural(total, {
      one: "The question is answered. Next, score it against its model answer.",
      other: "All # questions are answered. Next, score each one against its model answer.",
    });
  } else if (scoring) {
    message = plural(total, {
      one: `${done} of # answer scored. Your answers are saved.`,
      other: `${done} of # answers scored. Your answers are saved.`,
    });
  } else {
    message = plural(total, {
      one: `${done} of # question answered. Your answers are saved.`,
      other: `${done} of # questions answered. Your answers are saved.`,
    });
  }
  return (
    <div className="flex flex-col gap-3">
      <LessonProgress current={answered} total={total} />
      <p className="type-body-m text-lesson-muted">{message}</p>
    </div>
  );
}

/** "7 new, 2 due for review, 1 pretest, and 1 repair" */
function compositionParts(deck: DeckComposition): string[] {
  const parts: string[] = [];
  if (deck.new_count > 0) parts.push(`${deck.new_count} new`);
  if (deck.review_count > 0) parts.push(`${deck.review_count} due for review`);
  if (deck.diagnostic_count > 0) parts.push(`${deck.diagnostic_count} pretest`);
  if (deck.repair_count > 0) parts.push(`${deck.repair_count} repair`);
  return parts;
}

function DeckDetail({ deckPreview }: { deckPreview: Promise<DeckComposition | null> }) {
  const deck = use(deckPreview);
  if (!deck) return null;
  const parts = compositionParts(deck);
  // A deck of only new questions needs no breakdown.
  if (parts.length < 2) return null;
  return <>{formatList(parts)}</>;
}

function DeckTotal({ deckPreview }: { deckPreview: Promise<DeckComposition | null> }) {
  const deck = use(deckPreview);
  if (!deck) return <>Set when the session starts</>;
  return <>{plural(deck.total, { one: "# question", other: "# questions" })}</>;
}

function PretestNote({ deckPreview }: { deckPreview: Promise<DeckComposition | null> }) {
  const deck = use(deckPreview);
  const count = deck?.diagnostic_count ?? 0;
  if (count === 0) return null;
  return (
    <Alert variant="info" role="note">
      <AlertTitle>{plural(count, { one: "# pretest question", other: "# pretest questions" })}</AlertTitle>
      <AlertDescription>
        {plural(count, {
          one: "It covers a topic you haven't studied yet, so answer what you can. A wrong answer is expected and doesn't count toward accuracy.",
          other:
            "They cover topics you haven't studied yet, so answer what you can. Wrong answers are expected and don't count toward accuracy.",
        })}
      </AlertDescription>
    </Alert>
  );
}
