"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarPlusIcon } from "lucide-react";

import { apiPost } from "@/lib/client-api";
import { daysUntil, formatDateTime, formatDateWeekday, formatList, formatRelativeDay } from "@/lib/format";
import { useMounted } from "@/hooks/use-mounted";
import { ErrorState } from "@/components/app/error-state";
import { LessonButton } from "@/components/lesson/lesson-button";
import { sessionErrorCopy, type SessionErrorCopy } from "./errors";
import { skippedText } from "./followup-copy";
import { sessionModeCopy } from "./modes";
import type { FollowupItem, FollowupPreview } from "./types";
import { useZone } from "./use-zone";

interface ScheduleResponse {
  status: "scheduled" | "already_scheduled" | "no_plan";
  plan_id?: string;
  timezone?: string;
  scheduled?: { session_id: string; date: string; days_from_now: number | null; start_time: string }[];
}

/** Follow-ups are retrieval sessions (services/followups.ts). */
const FOLLOWUP_MODE = sessionModeCopy("RETRIEVAL").label;

/**
 * "Follow-up sessions": the dates the scheduler picks for this run (sooner
 * after a weaker result) and one action to put them in the plan. Dates are
 * anchored to when the session ended, so a reload shows the same days; the
 * relative part ("in 2 days") is worked out against today.
 */
export function FollowupsSection({
  runId,
  preview,
  onChange,
}: {
  runId: string;
  preview: FollowupPreview;
  /** The preview after adding, so the results stay in step. */
  onChange: (next: FollowupPreview) => void;
}) {
  const mounted = useMounted();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<SessionErrorCopy | null>(null);
  // The plan the follow-ups went into, known once they are added here.
  const [planId, setPlanId] = useState<string | null>(null);
  // No zone means the student has neither a time zone in Settings nor a
  // plan: the days are shown in the browser's zone, after hydration.
  const { timeZone, ready } = useZone(preview.timezone);
  const scheduled = preview.status === "scheduled";
  const allPassed =
    ready && preview.items.length > 0 && preview.items.every((item) => daysUntil(item.at, { timeZone }) < 0);

  async function add() {
    if (adding) return;
    setAdding(true);
    setError(null);
    try {
      const data = (await apiPost("/api/plans/followups", { run_id: runId })) as ScheduleResponse;
      if (data.status === "no_plan") {
        onChange({ ...preview, status: "no_plan" });
      } else {
        if (data.plan_id) setPlanId(data.plan_id);
        onChange({
          ...preview,
          status: "scheduled",
          timezone: data.timezone ?? preview.timezone,
          items: (data.scheduled ?? []).map((s) => ({
            date: s.date,
            at: s.start_time,
            days_from_now: s.days_from_now,
            session_id: s.session_id,
          })),
        });
      }
    } catch (err) {
      setError(sessionErrorCopy(err, "followups"));
    } finally {
      setAdding(false);
    }
  }

  const relative = (item: FollowupItem) => (mounted ? ` (${formatRelativeDay(item.at, { timeZone })})` : "");
  const day = (item: FollowupItem) => (ready ? `, ${formatDateWeekday(item.at, { timeZone })}` : "");
  const dayList = formatList(preview.items.map((item) => formatDateWeekday(item.at, { timeZone })));

  return (
    <section aria-labelledby="followups-title" className="flex flex-col gap-4">
      <h2 id="followups-title" className="type-title-l font-bold text-lesson-on-surface">
        Follow-up sessions
      </h2>

      {preview.items.length > 0 ? (
        <ul className="flex flex-col gap-2 type-body-l text-lesson-on-surface">
          {preview.items.map((item) => (
            <li key={item.session_id ?? item.date} className="flex items-start gap-3">
              <CalendarPlusIcon className="mt-0.5 size-5 shrink-0 text-lesson-muted" aria-hidden="true" />
              {item.session_id ? (
                <span>
                  <Link
                    href={`/s/${item.session_id}`}
                    className="font-bold text-lesson-primary underline underline-offset-4"
                  >
                    {`${FOLLOWUP_MODE} session${ready ? `, ${formatDateTime(item.at, { timeZone })}` : ""}`}
                  </Link>
                  {relative(item)}
                </span>
              ) : (
                <span>{`${FOLLOWUP_MODE} session${day(item)}${relative(item)}`}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {preview.skipped.length > 0 && ready ? (
        <p className="type-body-m text-lesson-muted">{skippedText(preview, timeZone)}</p>
      ) : null}

      <p className="type-body-m text-lesson-muted">Lower accuracy brings follow-ups sooner.</p>

      <div role="status" aria-live="polite" className="flex flex-col gap-3 empty:hidden">
        {scheduled && preview.items.length > 0 ? (
          <p className="type-body-l text-lesson-on-surface">
            {ready ? `Added to your plan: ${dayList}. ` : "Added to your plan. "}
            <Link
              href={planId ? `/plan?plan=${encodeURIComponent(planId)}` : "/plan"}
              className="font-bold text-lesson-primary underline underline-offset-4"
            >
              Open plan
            </Link>
          </p>
        ) : null}
        {preview.status === "no_plan" ? (
          <p className="type-body-l text-lesson-on-surface">
            {"Follow-ups go into a plan, and you don't have one yet. "}
            <Link href="/plan/new" className="font-bold text-lesson-primary underline underline-offset-4">
              Create plan
            </Link>
          </p>
        ) : null}
      </div>

      {preview.status === "not_scheduled" && preview.items.length > 0 ? (
        allPassed ? (
          <p className="type-body-m text-lesson-muted">
            These dates have passed. Start the session again for new follow-ups.
          </p>
        ) : (
          <div>
            <LessonButton
              variant="neutral"
              loading={adding}
              loadingLabel="Adding follow-ups…"
              onClick={add}
            >
              Add follow-ups to plan
            </LessonButton>
          </div>
        )
      ) : null}

      {error ? (
        <ErrorState
          title={error.title}
          description={
            error.signIn ? (
              <>
                {error.description} <Link href="/auth/signin">Sign in</Link>
              </>
            ) : (
              error.description
            )
          }
          onRetry={error.signIn ? undefined : add}
          retrying={adding}
        />
      ) : null}
    </section>
  );
}

