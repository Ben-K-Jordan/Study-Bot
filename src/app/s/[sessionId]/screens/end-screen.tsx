"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { CheckIcon, ClipboardListIcon } from "lucide-react";

import { useApi } from "@/lib/swr";
import { formatDateTime, formatDuration, formatList, formatNumber, formatPercent, plural } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/app/error-state";
import { LoadingRegion } from "@/components/app/skeletons";
import { LessonButton } from "@/components/lesson/lesson-button";
import { resultsUrl } from "@/components/session/api";
import { CalibrationSection } from "@/components/session/calibration-section";
import { sessionErrorCopy, type SessionErrorCopy } from "@/components/session/errors";
import { FollowupsSection } from "@/components/session/followups-section";
import { SessionScreen } from "@/components/session/session-screen";
import type { FollowupPreview, SessionData, SessionResults } from "@/components/session/types";
import { useZone } from "@/components/session/use-zone";

interface Props {
  session: SessionData;
  /** The finished run to show. */
  runId: string;
  /** Server-rendered results for this run, when the page opened on them. */
  initialResults: SessionResults | null;
  /** Finishing the run failed: the run is still open. */
  finishError: SessionErrorCopy | null;
  finishing: boolean;
  onRetryFinish: () => void;
  onStartAgain: () => void;
  /** Move focus to the heading (after the last question). */
  focusOnMount?: boolean;
}

/**
 * The lesson-complete screen: honest stats, how confidence compared with
 * results, follow-up sessions with dates from the scheduler, and the way
 * out. No XP here (VOICE.md keeps XP on Home, Progress and Settings).
 */
export function EndScreen({
  session,
  runId,
  initialResults,
  finishError,
  finishing,
  onRetryFinish,
  onStartAgain,
  focusOnMount = false,
}: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const fallback = initialResults?.run_id === runId ? initialResults : undefined;
  const { data, error, isLoading, mutate } = useApi<SessionResults>(
    finishError ? null : resultsUrl(session.session_id, runId),
    { fallbackData: fallback, revalidateOnMount: !fallback }
  );

  useEffect(() => {
    if (focusOnMount) headingRef.current?.focus();
  }, [focusOnMount]);

  const footer = (
    <>
      <LessonButton variant="neutral" width="full" className="sm:w-auto" onClick={onStartAgain}>
        Start session again
      </LessonButton>
      <LessonButton variant="primary" width="full" className="sm:w-auto" asChild>
        <Link href="/">Go to Home</Link>
      </LessonButton>
    </>
  );

  if (finishError) {
    return (
      <SessionScreen
        footer={
          <LessonButton variant="primary" width="full" className="sm:ml-auto sm:w-auto" asChild>
            <Link href="/">Go to Home</Link>
          </LessonButton>
        }
      >
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="type-headline-s font-bold text-lesson-on-surface outline-none sm:type-headline-m sm:font-bold"
        >
          Results aren&apos;t ready
        </h1>
        <ErrorState
          title={finishError.title}
          description={finishError.description}
          onRetry={finishError.reload ? () => window.location.reload() : onRetryFinish}
          retryLabel={finishError.reload ? "Reload" : "Retry"}
          retrying={finishing}
        />
      </SessionScreen>
    );
  }

  const results = data ?? null;
  const empty = results != null && results.question_count === 0;

  if (empty) {
    return (
      <SessionScreen
        footer={
          <>
            <LessonButton variant="neutral" width="full" className="sm:w-auto" asChild>
              <Link href="/">Go to Home</Link>
            </LessonButton>
            <LessonButton variant="primary" width="full" className="sm:w-auto" onClick={onStartAgain}>
              Start session
            </LessonButton>
          </>
        }
      >
        <div className="flex flex-col items-start gap-4">
          <span className="flex size-14 items-center justify-center rounded-full bg-lesson-option-hover text-lesson-muted">
            <ClipboardListIcon className="size-7" aria-hidden="true" />
          </span>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="type-headline-s font-bold text-lesson-on-surface outline-none sm:type-headline-m sm:font-bold"
          >
            No results yet
          </h1>
          <p className="type-body-l text-lesson-on-surface">
            Finish this session to see your accuracy and follow-ups.
          </p>
        </div>
      </SessionScreen>
    );
  }

  return (
    <SessionScreen footer={footer} stickyFooter="wide">
      <ResultsHeader session={session} results={results} headingRef={headingRef} />

      {results ? (
        <>
          <ResultsStats session={session} results={results} />
          <CalibrationSection answers={results.answers} pretestCount={results.pretest_count} />
          {results.followups ? (
            <FollowupsSection
              runId={results.run_id}
              preview={results.followups}
              onChange={(next: FollowupPreview) =>
                mutate({ ...results, followups: next }, { revalidate: true })
              }
            />
          ) : null}
        </>
      ) : error ? (
        <ErrorState
          title={sessionErrorCopy(error, "results").title}
          description={sessionErrorCopy(error, "results").description}
          onRetry={() => void mutate()}
          retrying={isLoading}
        />
      ) : (
        <ResultsSkeleton />
      )}
    </SessionScreen>
  );
}

function ResultsHeader({
  session,
  results,
  headingRef,
}: {
  session: SessionData;
  results: SessionResults | null;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const { timeZone, ready } = useZone(session.timezone);
  const endedAt = results?.ended_at && ready ? formatDateTime(results.ended_at, { timeZone }) : null;
  return (
    <header className="flex flex-col items-start gap-3">
      <span className="flex size-14 items-center justify-center rounded-full bg-lesson-correct text-lesson-on-correct">
        <CheckIcon className="size-8" strokeWidth={3} aria-hidden="true" />
      </span>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="type-headline-m font-bold text-lesson-on-surface outline-none sm:type-headline-l sm:font-bold"
      >
        Session complete
      </h1>
      <p className="type-title-m text-pretty text-lesson-on-surface wrap-break-word">
        {session.mode_label}: {session.topic_scope}
      </p>
      <p className="type-body-l text-lesson-muted wrap-break-word">
        {session.course_name}
        <span aria-hidden="true"> · </span>
        <span className="sr-only">, </span>
        {session.exam_name}
        {endedAt ? (
          <>
            <span aria-hidden="true"> · </span>
            <span className="sr-only">, finished </span>
            {endedAt}
          </>
        ) : null}
      </p>
    </header>
  );
}

function ResultsStats({ session, results }: { session: SessionData; results: SessionResults }) {
  const m = results.metrics;
  const counted = m.attempts_count > 0;
  const stats: { label: string; value: string }[] = [
    { label: "Accuracy", value: counted ? formatPercent(m.accuracy) : "Not counted" },
    { label: "Questions", value: formatNumber(results.question_count) },
    { label: "Time answering", value: formatDuration(m.time_spent_seconds / 60) },
    { label: "Errors logged", value: formatNumber(results.errors_logged) },
    { label: "Repair questions", value: formatNumber(results.repair_count) },
  ];
  if (session.mode === "EXAM_SIM" && results.answered_count != null) {
    stats.push({
      label: "Scored",
      value: `${formatNumber(results.scored_count ?? 0)} of ${formatNumber(results.answered_count)}`,
    });
  }

  const breakdown = formatList([
    `${formatNumber(m.correct_count)} correct`,
    `${formatNumber(m.partial_count)} partly correct`,
    `${formatNumber(m.incorrect_count)} incorrect`,
  ]);

  return (
    <section aria-label="Session stats" className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-5 rounded-2xl border-2 border-lesson-option-border p-5 sm:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label} className="flex min-w-0 flex-col gap-1">
            <dt className="type-label-l font-bold text-lesson-muted">{stat.label}</dt>
            <dd className="type-headline-s font-bold text-lesson-on-surface tabular-nums">{stat.value}</dd>
          </div>
        ))}
      </dl>
      <p className="type-body-m text-lesson-muted">
        {counted ? `${breakdown}.` : "No answers counted toward accuracy."}
        {results.pretest_count > 0
          ? ` ${plural(results.pretest_count, {
              one: "The pretest question doesn't count toward accuracy.",
              other: "# pretest questions don't count toward accuracy.",
            })}`
          : ""}
      </p>
    </section>
  );
}

function ResultsSkeleton() {
  return (
    <LoadingRegion label="Loading results…" className="flex flex-col gap-8">
      <div aria-hidden="true" className="grid grid-cols-2 gap-x-4 gap-y-5 rounded-2xl border-2 border-lesson-option-border p-5 sm:grid-cols-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-7 w-16" />
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="flex flex-col gap-3">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-52 w-full rounded-2xl" />
      </div>
    </LoadingRegion>
  );
}
