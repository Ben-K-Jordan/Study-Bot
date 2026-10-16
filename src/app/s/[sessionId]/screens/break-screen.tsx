"use client";

import { useEffect, useRef, useState } from "react";

import { breakEndsAt, breakRemainingSeconds } from "@/lib/breaks";
import { formatTime } from "@/lib/format";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ErrorState } from "@/components/app/error-state";
import { LessonButton } from "@/components/lesson/lesson-button";
import { LessonFrame } from "@/components/lesson/lesson-frame";
import { useLessonAnnounce } from "@/components/lesson/lesson-announcer";
import type { SessionErrorCopy } from "@/components/session/errors";
import type { RunData } from "@/lib/session-types";
import { useZone } from "@/components/session/use-zone";

interface Props {
  run: RunData;
  timezone: string | null;
  /** The break started while an answer was on its way, so that answer wasn't saved. */
  interrupted: boolean;
  ending: boolean;
  error: SessionErrorCopy | null;
  onEndBreak: () => void;
}

const HEADING_ID = "break-title";

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * The rest between work blocks: a countdown, what comes next, and End
 * break. The timer reads server timestamps, so it survives a refresh; it is
 * not announced every second (role="timer" is silent by default), only at
 * the start and with one minute left.
 */
export function BreakScreen({ run, timezone, interrupted, ending, error, onEndBreak }: Props) {
  const state = run.break_state;
  const [remaining, setRemaining] = useState(() => breakRemainingSeconds(state));
  const endedRef = useRef(false);
  const { timeZone, ready } = useZone(timezone);
  const endsAt = breakEndsAt(state);
  const canEndEarly = run.policies?.allowEndBreakEarly !== false;

  // Tick once a second against the server's start time.
  useEffect(() => {
    const tick = () => setRemaining(breakRemainingSeconds(state));
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [state]);

  // When time is up, end the break once (also when the break was already over on arrival).
  useEffect(() => {
    if (remaining > 0 || endedRef.current) return;
    endedRef.current = true;
    onEndBreak();
  }, [remaining, onEndBreak]);

  // A failed end lets the timer path try again on the next press.
  useEffect(() => {
    if (error) endedRef.current = false;
  }, [error]);

  // Focus the heading so screen readers start here.
  useEffect(() => {
    const heading = document.getElementById(HEADING_ID);
    if (!heading) return;
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  }, []);

  const nextBlock = state.current_cycle + 2;
  const answered = run.answered_count ?? run.current_index;

  return (
    <LessonFrame
      current={answered}
      total={run.prompt_count}
      questionNumber={Math.min(run.current_index + 1, run.prompt_count)}
      question="Break"
      questionId={HEADING_ID}
      footer={
        <>
          <p className="type-body-m text-lesson-muted">Your answers are saved.</p>
          <LessonButton
            variant="check"
            width="full"
            className="sm:w-auto"
            loading={ending}
            loadingLabel="Ending break…"
            disabled={!canEndEarly && remaining > 0}
            onClick={onEndBreak}
          >
            End break
          </LessonButton>
        </>
      }
    >
      <BreakAnnouncements remaining={remaining} interrupted={interrupted} />

      <div className="flex flex-col items-start gap-2">
        <p className="type-label-l font-bold text-lesson-muted" id="break-timer-label">
          Time left
        </p>
        <p
          role="timer"
          aria-live="off"
          aria-atomic="true"
          aria-labelledby="break-timer-label"
          className="type-display-l font-bold text-lesson-on-surface tabular-nums"
        >
          {formatClock(remaining)}
        </p>
        <p className="type-body-l text-lesson-muted">
          {endsAt && ready ? `Ends at ${formatTime(endsAt, { timeZone })}. ` : ""}
          {nextBlock <= state.total_cycles ? `Next: block ${nextBlock} of ${state.total_cycles}.` : ""}
        </p>
        {!canEndEarly && remaining > 0 ? (
          <p className="type-body-m text-lesson-muted">You can end the break when the timer runs out.</p>
        ) : null}
      </div>

      {interrupted ? (
        <Alert variant="info" role="note">
          <AlertDescription>
            Your last answer wasn&apos;t submitted because the break started. Submit it after the break.
          </AlertDescription>
        </Alert>
      ) : null}

      <section aria-labelledby="during-break" className="flex flex-col gap-3">
        <h2 id="during-break" className="type-title-l font-bold text-lesson-on-surface">
          During the break
        </h2>
        <ul className="flex list-disc flex-col gap-2 pl-6 type-body-l text-lesson-on-surface marker:text-lesson-muted">
          <li>Stand up and stretch</li>
          <li>Get water</li>
          <li>Look at something far away for 20 seconds</li>
          <li>Leave your phone alone</li>
        </ul>
      </section>

      {error ? (
        <ErrorState
          title={error.title}
          description={error.description}
          onRetry={error.reload ? () => window.location.reload() : onEndBreak}
          retryLabel={error.reload ? "Reload" : "Retry"}
          retrying={ending}
        />
      ) : null}
    </LessonFrame>
  );
}

/** Says when the break starts and when one minute is left; never each second. */
function BreakAnnouncements({ remaining, interrupted }: { remaining: number; interrupted: boolean }) {
  const announce = useLessonAnnounce();
  const saidMinute = useRef(false);

  useEffect(() => {
    announce?.(interrupted ? "Break started before your answer was submitted." : "Break started.");
  }, [announce, interrupted]);

  useEffect(() => {
    if (remaining <= 60 && remaining > 55 && !saidMinute.current) {
      saidMinute.current = true;
      announce?.("1 minute left in the break.");
    }
  }, [announce, remaining]);

  return null;
}
