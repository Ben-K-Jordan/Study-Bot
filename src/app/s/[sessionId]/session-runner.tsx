"use client";

import { startTransition, useCallback, useEffect, useReducer, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { preload } from "swr";

import { ApiError, apiGet, apiPost } from "@/lib/client-api";
import { fetcher } from "@/lib/swr";
import { loadDeckPreview, promptToView, resultsUrl } from "@/components/session/api";
import { fetchPrompt, promptUrl, runUrl } from "@/components/session/runner/api";
import {
  breakStateFromRejection,
  sessionErrorCopy,
  toSessionError,
  type SessionErrorCopy,
} from "@/components/session/errors";
import { nextLoads } from "@/components/session/next-loads";
import { QuestionSkeleton } from "@/components/session/skeletons";
import type {
  ActiveRunSummary,
  AttemptSubmitResult,
  BreakState,
  DeckComposition,
  PromptView,
  RunData,
  SessionData,
  SessionResults,
} from "@/lib/session-types";
import { sessionTitle, useDocumentTitle } from "@/components/session/use-document-title";
import { BreakScreen } from "./screens/break-screen";
import { EndScreen } from "./screens/end-screen";
import { PreflightScreen } from "./screens/preflight";

// The question screen is the largest part of a session. It loads while the
// student reads the intro (see onPreload), not with the page.
const loadRunner = () => import("./screens/runner");
const RunnerScreen = dynamic(() => loadRunner().then((m) => m.RunnerScreen), {
  loading: () => <QuestionSkeleton />,
});

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type Screen = "preflight" | "runner" | "break" | "end";

interface ShellState {
  screen: Screen;
  run: RunData | null;
  /** The open run Start session resumes; null starts a new one. */
  resumable: ActiveRunSummary | null;
  /** The finished run the results screen shows. */
  resultsRunId: string | null;
  starting: boolean;
  startError: SessionErrorCopy | null;
  /** The break started while an answer was on its way. */
  breakInterrupted: boolean;
  endingBreak: boolean;
  breakError: SessionErrorCopy | null;
  finishing: boolean;
  finishError: SessionErrorCopy | null;
  /**
   * Move focus into the screen once it mounts (not on first load; a screen
   * opened by a client-side navigation focuses its heading by itself).
   */
  moveFocus: boolean;
}

type Action =
  | { type: "start" }
  | { type: "start_failed"; error: SessionErrorCopy }
  | { type: "started"; run: RunData }
  | { type: "run_updated"; run: RunData }
  | { type: "break_started"; breakState: BreakState; interrupted: boolean }
  | { type: "show_break" }
  | { type: "end_break" }
  | { type: "break_ended"; breakState: BreakState }
  | { type: "end_break_failed"; error: SessionErrorCopy }
  | { type: "finish" }
  | { type: "finished"; runId: string }
  | { type: "finish_failed"; runId: string; error: SessionErrorCopy }
  | { type: "start_again" };

function summarize(run: RunData): ActiveRunSummary {
  return {
    run_id: run.run_id,
    phase: run.phase,
    current_index: run.current_index,
    prompt_count: run.prompt_count,
    answered_count: run.answered_count ?? null,
    started_at: null,
  };
}

function initialState(session: SessionData): ShellState {
  const base: ShellState = {
    screen: "preflight",
    run: null,
    resumable: session.active_run,
    resultsRunId: null,
    starting: false,
    startError: null,
    breakInterrupted: false,
    endingBreak: false,
    breakError: null,
    finishing: false,
    finishError: null,
    moveFocus: false,
  };
  // A finished session opens on its results; an open run waits on the intro with Resume session.
  if (!session.active_run && session.last_completed_run) {
    return { ...base, screen: "end", resultsRunId: session.last_completed_run.run_id };
  }
  return base;
}

function reducer(state: ShellState, action: Action): ShellState {
  switch (action.type) {
    case "start":
      return { ...state, starting: true, startError: null };
    case "start_failed":
      return { ...state, starting: false, startError: action.error };
    case "started":
      return {
        ...state,
        starting: false,
        run: action.run,
        resumable: summarize(action.run),
        screen: action.run.break_state?.on_break ? "break" : "runner",
        breakInterrupted: false,
        breakError: null,
        moveFocus: true,
      };
    case "run_updated":
      return { ...state, run: action.run };
    case "break_started":
      if (!state.run) return state;
      return {
        ...state,
        run: { ...state.run, break_state: action.breakState },
        screen: "break",
        breakInterrupted: action.interrupted,
        endingBreak: false,
        breakError: null,
        moveFocus: true,
      };
    case "show_break":
      if (!state.run?.break_state?.on_break) return state;
      return { ...state, screen: "break", breakInterrupted: false, breakError: null, moveFocus: true };
    case "end_break":
      return { ...state, endingBreak: true, breakError: null };
    case "break_ended":
      if (!state.run) return state;
      return {
        ...state,
        run: { ...state.run, break_state: action.breakState },
        screen: "runner",
        endingBreak: false,
        breakInterrupted: false,
        moveFocus: true,
      };
    case "end_break_failed":
      return { ...state, endingBreak: false, breakError: action.error };
    case "finish":
      return { ...state, finishing: true };
    case "finished":
      return {
        ...state,
        finishing: false,
        finishError: null,
        run: state.run ? { ...state.run, status: "COMPLETED" } : null,
        resumable: null,
        resultsRunId: action.runId,
        screen: "end",
        moveFocus: true,
      };
    case "finish_failed":
      return {
        ...state,
        finishing: false,
        finishError: action.error,
        resultsRunId: action.runId,
        screen: "end",
        moveFocus: true,
      };
    case "start_again":
      return {
        ...state,
        screen: "preflight",
        run: null,
        resumable: null,
        startError: null,
        finishError: null,
        moveFocus: true,
      };
  }
}

function runnerTitle(run: RunData | null, shownIndex: number | null): string | null {
  if (!run || run.prompt_count <= 0) return null;
  const index = shownIndex ?? run.current_index;
  return `Question ${Math.min(index + 1, run.prompt_count)} of ${run.prompt_count}`;
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

interface Props {
  session: SessionData;
  /** Streamed deck composition for the intro. */
  deckPreview: Promise<DeckComposition | null>;
  /** Server-rendered results of the last finished run, when the page opens on them. */
  initialResults: SessionResults | null;
}

/**
 * The session at /s/[sessionId]: intro, questions, breaks and results, one
 * screen at a time. Owns the run and every request that moves it forward;
 * the screens only draw.
 *
 * Contract with the question screen (RunnerScreen):
 * - onSubmit(attempt) resolves with the server's answer, null when a break
 *   started before the answer arrived (nothing was saved), and rejects with
 *   an ApiError whose message is already written for the student. Outside
 *   exam answering it resolves before the next question has loaded: the
 *   answered question stays on screen with its feedback, and the next one
 *   arrives as run.current_prompt, or through the runner's own GET of the
 *   same SWR key if it is still on its way.
 * - When an answer finishes the run or starts a break, onSubmit only updates
 *   the run, so the screen can show that answer's feedback first. It then
 *   calls onFinish() ("See results") or onBreak().
 * - onComplete() is the older name for onFinish().
 */
export function SessionRunner({ session, deckPreview, initialResults }: Props) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, session, initialState);
  const sessionId = session.session_id;
  // The intro's deck preview: streamed with the page, or loaded again for
  // Start session again (the page skips it when it opens on results).
  const [preview, setPreview] = useState(deckPreview);

  // Handlers read the latest run through a ref, so their identities stay
  // stable for the runner and an answer never builds on a stale run.
  const runRef = useRef<RunData | null>(state.run);
  const busy = useRef({ starting: false, finishing: false, endingBreak: false });
  useEffect(() => {
    runRef.current = state.run;
  }, [state.run]);

  // The question the runner shows, which lags the run while feedback is up.
  const [shownIndex, setShownIndex] = useState<number | null>(null);

  const updateRun = useCallback((run: RunData) => {
    runRef.current = run;
    dispatch({ type: "run_updated", run });
  }, []);

  /** Puts a question that loaded in the background into the run, if it is still the one due. */
  const attachPrompt = useCallback(
    (runId: string, index: number, prompt: PromptView | null) => {
      const latest = runRef.current;
      if (!prompt || !latest || latest.run_id !== runId) return;
      if (latest.current_index !== index || latest.current_prompt) return;
      updateRun({ ...latest, current_prompt: prompt });
    },
    [updateRun]
  );

  const preloadRunner = useCallback(() => {
    void loadRunner();
  }, []);

  const start = useCallback(async () => {
    if (busy.current.starting) return;
    busy.current.starting = true;
    setShownIndex(null);
    dispatch({ type: "start" });
    try {
      // apiPost gives up after 60 seconds: a stuck deck build ends in a clear error, not an endless spinner.
      const data = await apiPost(`/api/sessions/${encodeURIComponent(sessionId)}/runs/start`, undefined);
      let currentPrompt = data.current_prompt ?? null;
      if (!currentPrompt && Array.isArray(data.prompts) && data.prompts.length > 0) {
        const index = data.current_index ?? 0;
        if (data.prompts[index]) currentPrompt = promptToView(data.prompts[index], index);
      }
      // Scoring in exam simulation shows each saved answer, so load them.
      let attempts: RunData["attempts"];
      if (data.phase === "REVIEW" && data.resumed) {
        attempts = await apiGet(runUrl(data.run_id))
          .then((full) => full.attempts)
          .catch(() => undefined);
      }
      await loadRunner().catch(() => undefined);
      const run: RunData = {
        ...data,
        prompt_count: data.prompt_count ?? data.prompts?.length ?? 0,
        current_prompt: currentPrompt,
        mode: data.mode ?? session.mode,
        phase: data.phase ?? "ACTIVE",
        attempts,
      };
      runRef.current = run;
      dispatch({ type: "started", run });
    } catch (error) {
      dispatch({ type: "start_failed", error: sessionErrorCopy(error, "start") });
    } finally {
      busy.current.starting = false;
    }
  }, [sessionId, session.mode]);

  const submit = useCallback(
    async (attempt: Record<string, unknown>): Promise<AttemptSubmitResult | null> => {
      const current = runRef.current;
      if (!current) return null;

      let data;
      try {
        data = await apiPost(`/api/runs/${encodeURIComponent(current.run_id)}/attempt`, attempt);
      } catch (error) {
        // A break started before the answer arrived: nothing was saved, so
        // there is no feedback to show. Go straight to the break.
        const breakState =
          breakStateFromRejection(error) ??
          (error instanceof ApiError && error.status === 409 && error.code === "on_break"
            ? { ...current.break_state, on_break: true, break_started_at: new Date().toISOString() }
            : null);
        if (breakState) {
          dispatch({ type: "break_started", breakState, interrupted: true });
          return null;
        }
        throw toSessionError(error, "submit");
      }

      const completed = data.status === "COMPLETED";
      const newIndex: number = typeof data.current_index === "number" ? data.current_index : current.current_index;
      const promptCount: number = data.prompt_count ?? current.prompt_count;
      const phase: string = data.phase ?? current.phase;
      const { nextIndex, awaitNext, scoringBegins, deckFallback } = nextLoads({
        completed,
        index: newIndex,
        promptCount,
        phase,
        previousPhase: current.phase,
      });

      // An exam answer gets no feedback, so the next question replaces it at
      // once: load it first. Every other answer shows feedback first, and
      // the next question loads while the student reads it.
      // If that load fails, the start-time deck can stand in (see deckFallback).
      const fallbackPrompt = () => {
        const deckPrompt = deckFallback ? current.prompts?.[newIndex] : undefined;
        return deckPrompt ? promptToView(deckPrompt, newIndex) : null;
      };
      const nextPrompt =
        nextIndex !== null && awaitNext ? await fetchPrompt(current.run_id, nextIndex, phase).catch(fallbackPrompt) : null;

      // Finishing the run or starting a break doesn't switch screens here:
      // the runner shows this answer's feedback, then calls onFinish or onBreak.
      updateRun({
        ...current,
        status: data.status ?? current.status,
        current_index: newIndex,
        prompt_count: promptCount,
        current_prompt: nextPrompt,
        metrics: data.metrics ?? current.metrics,
        break_state: data.break_state ?? current.break_state,
        phase,
        answered_count: data.answered_count ?? current.answered_count,
        scored_count: data.scored_count ?? current.scored_count,
        last_attempt_id: data.attempt_id ?? current.last_attempt_id,
        // Scoring reads the saved answers; the runner loads them under runUrl.
        attempts: scoringBegins ? undefined : current.attempts,
      });

      // Same SWR keys as the runner's own loads, so a question or answer
      // list still on its way when the runner needs it is reused, not
      // requested twice. GET /prompt for the current question can adapt its
      // difficulty, which is why the runner must not fetch it a second time.
      // A failed load attaches nothing: the start-time deck is no stand-in
      // here (no answer keys, maybe not the question the server grades), so
      // the runner's own GET of this key takes the failure and offers Retry.
      if (nextIndex !== null && !awaitNext) {
        // With the run's phase, so a scoring question shares the runner's key (promptUrl).
        void preload(promptUrl(current.run_id, nextIndex, phase), fetcher<PromptView>).then(
          (prompt) => attachPrompt(current.run_id, nextIndex, prompt),
          () => undefined
        );
      }
      if (scoringBegins) void preload(runUrl(current.run_id), fetcher).catch(() => undefined);

      return data as AttemptSubmitResult;
    },
    [updateRun, attachPrompt]
  );

  const finish = useCallback(async () => {
    const current = runRef.current;
    if (!current || busy.current.finishing) return;
    busy.current.finishing = true;
    dispatch({ type: "finish" });
    try {
      if (current.status !== "COMPLETED") {
        await apiPost(`/api/runs/${encodeURIComponent(current.run_id)}/complete`, undefined);
      }
      // Load the full results before switching, so the screen opens complete.
      // A failure here is shown by the results screen, with Retry.
      await preload(resultsUrl(sessionId, current.run_id), fetcher).catch(() => undefined);
      dispatch({ type: "finished", runId: current.run_id });
      // Refresh the page's server data, so the intro's "Last time" line and a
      // later Back navigation show this run. The page now opens on results,
      // which skips the deck preview, so this reloads the results only. The
      // refresh streams the metadata <title> again; useDocumentTitle keeps
      // the tab named in between.
      startTransition(() => router.refresh());
    } catch (error) {
      dispatch({ type: "finish_failed", runId: current.run_id, error: sessionErrorCopy(error, "finish") });
    } finally {
      busy.current.finishing = false;
    }
  }, [sessionId, router]);

  const showBreak = useCallback(() => dispatch({ type: "show_break" }), []);

  const endBreak = useCallback(async () => {
    const current = runRef.current;
    if (!current || busy.current.endingBreak) return;
    busy.current.endingBreak = true;
    dispatch({ type: "end_break" });
    try {
      const data = await apiPost(`/api/runs/${encodeURIComponent(current.run_id)}/end-break`, undefined);
      dispatch({ type: "break_ended", breakState: data.break_state });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // The server says the break is already over (another tab ended it).
        dispatch({ type: "break_ended", breakState: { ...current.break_state, on_break: false } });
      } else {
        dispatch({ type: "end_break_failed", error: sessionErrorCopy(error, "endBreak") });
      }
    } finally {
      busy.current.endingBreak = false;
    }
  }, []);

  const startAgain = useCallback(() => {
    // The deck changes with every run, so the intro asks for a fresh preview.
    setPreview(loadDeckPreview(sessionId));
    dispatch({ type: "start_again" });
  }, [sessionId]);

  const course = session.course_name;
  // The results screen names its own title, which depends on what loads.
  const title =
    state.screen === "runner"
      ? sessionTitle(runnerTitle(state.run, shownIndex), course)
      : state.screen === "break"
        ? sessionTitle("Break", course)
        : state.screen === "end" && state.resultsRunId
          ? null
          : sessionTitle(session.mode_label, course);
  useDocumentTitle(title);

  const lastMetrics = session.last_completed_run?.metrics as { accuracy?: unknown; attempts_count?: unknown } | undefined;
  const lastResult =
    session.last_completed_run && typeof lastMetrics?.accuracy === "number" && Number(lastMetrics.attempts_count) > 0
      ? { accuracy: lastMetrics.accuracy, endedAt: session.last_completed_run.ended_at }
      : null;

  if (state.screen === "runner" && state.run) {
    return (
      <RunnerScreen
        run={state.run}
        session={session}
        onSubmit={submit}
        onComplete={finish}
        onFinish={finish}
        onBreak={showBreak}
        onQuestionShown={setShownIndex}
      />
    );
  }

  if (state.screen === "break" && state.run) {
    return (
      <BreakScreen
        run={state.run}
        timezone={session.timezone}
        interrupted={state.breakInterrupted}
        ending={state.endingBreak}
        error={state.breakError}
        onEndBreak={endBreak}
      />
    );
  }

  if (state.screen === "end" && state.resultsRunId) {
    return (
      <EndScreen
        session={session}
        runId={state.resultsRunId}
        initialResults={initialResults}
        finishError={state.finishError}
        finishing={state.finishing}
        onRetryFinish={finish}
        onStartAgain={startAgain}
        focusOnMount={state.moveFocus}
      />
    );
  }

  return (
    <PreflightScreen
      session={session}
      deckPreview={preview}
      resumable={state.resumable}
      lastResult={lastResult}
      starting={state.starting}
      error={state.startError}
      onStart={start}
      onPreload={preloadRunner}
      focusOnMount={state.moveFocus}
    />
  );
}
