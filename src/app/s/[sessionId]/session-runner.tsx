"use client";

import { useState, useCallback } from "react";
import { getOrCreateUserId } from "@/lib/client-utils";
import { PreflightScreen } from "./screens/preflight";
import { RunnerScreen } from "./screens/runner";
import { BreakScreen } from "./screens/break-screen";
import { EndScreen } from "./screens/end-screen";

// --- Types shared across screens ---

export interface Prompt {
  id: string;
  objective_id?: string;
  text: string;
  difficulty: number;
  format?: "FREE_RECALL" | "MCQ";
  choices?: string[];
  meta?: {
    source_error_log_id?: string;
    original_prompt_text?: string;
    expected_correction_rule?: string;
    variant_question?: string;
  };
}

/** Server-graded MCQ outcome, returned by POST /attempt for MCQ prompts. */
export interface McqResult {
  selected_index: number;
  correct_index: number;
  is_correct: boolean;
  correct_choice: string;
  rationale?: string;
}

/** Response payload of a successful attempt submission. */
export interface AttemptSubmitResult {
  attempt_id?: string;
  status?: string;
  mcq_result?: McqResult | null;
  [key: string]: unknown;
}

export interface PromptView {
  prompt_index: number;
  text: string;
  objective_id?: string;
  difficulty?: number;
  source_type?: string;
  format?: "FREE_RECALL" | "MCQ";
  choices?: string[];
  /** Only present during EXAM_SIM REVIEW — the server withholds the answer key pre-answer. */
  correctIndex?: number;
  meta?: {
    distractorRationales?: string[];
    original_prompt_text?: string;
    [key: string]: unknown;
  };
}

export interface RunMetrics {
  attempts_count: number;
  correct_count: number;
  partial_count: number;
  incorrect_count: number;
  accuracy: number;
  time_spent_seconds: number;
  recommended_followups?: { label: string; days_from_now: number; date: string }[];
}

export interface BreakState {
  work_started_at: string;
  current_cycle: number;
  total_cycles: number;
  on_break: boolean;
  break_started_at?: string;
  break_duration_seconds?: number;
  work_duration_seconds: number;
  completed_breaks: string[];
}

export interface RunPolicies {
  scoring: "IMMEDIATE" | "DELAYED";
  requiresErrorLogOn: string[];
  allowHintsBeforeAnswer: boolean;
  allowEndBreakEarly: boolean;
}

export interface FeedbackExcerpt {
  chunk_id: string;
  doc_title: string;
  page_number: number | null;
  snippet: string;
  rank: number;
}

export interface FeedbackResult {
  status: string;
  excerpts: FeedbackExcerpt[];
  // AI explanation (wrong/partial)
  explanation?: string;
  key_takeaway?: string;
  // Concept connections (all scores)
  concept_connection?: string;
  // Mnemonic (wrong/partial)
  mnemonic?: string;
  // Mistake pattern advice
  pattern_advice?: string;
  // Reinforcement (correct)
  reinforcement?: string;
  deeper_insight?: string;
  // Socratic follow-up (all scores)
  socratic_followup?: string;
  socratic_purpose?: string;
}

export interface RunData {
  run_id: string;
  status: string;
  mode: string;
  phase: string;
  current_index: number;
  prompt_count: number;
  current_prompt: PromptView | null;
  answered_count?: number | null;
  scored_count?: number | null;
  // Legacy: full prompt array (kept for backward compat, may be absent)
  prompts?: Prompt[];
  policies: RunPolicies;
  metrics: RunMetrics;
  break_state: BreakState;
  // Attempts are available on resumed runs (from GET /api/runs/:runId)
  attempts?: { id: string; prompt_index: number; user_answer: string; self_score: string | null; confidence_rating?: number | null }[];
  // Deferred feedback: set by UI after fetching from /api/attempts/:attemptId/feedback
  feedback?: { excerpts: FeedbackExcerpt[] };
  // Last attempt info for deferred feedback
  last_attempt_id?: string;
  last_feedback_status?: "PENDING" | "NONE";
}

export interface SessionData {
  session_id: string;
  course_name: string;
  exam_name: string;
  mode: string;
  mode_label: string;
  topic_scope: string;
  planned_minutes: number;
  target_outcome: Record<string, unknown> | null;
  break_protocol: Record<string, unknown> | null;
  objectives: { id: string; title: string }[] | null;
  has_active_run: boolean;
  active_run_id: string | null;
  last_completed_run: {
    run_id: string;
    metrics: Record<string, unknown>;
    ended_at: string | null;
  } | null;
}

type Screen = "preflight" | "runner" | "break" | "end";

// --- API helpers ---

async function apiPost(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": getOrCreateUserId(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function apiGet(url: string) {
  const res = await fetch(url, {
    headers: { "X-User-Id": getOrCreateUserId() },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

/** Fetch a single prompt by index */
async function fetchPrompt(runId: string, index: number): Promise<PromptView> {
  return apiGet(`/api/runs/${runId}/prompt?index=${index}`);
}

/** Fetch deferred feedback for an attempt */
export async function fetchFeedback(attemptId: string): Promise<FeedbackResult> {
  return apiGet(`/api/attempts/${attemptId}/feedback`);
}

/** Attach post-review metacognition (explanation/example) to an existing attempt */
export async function patchAttemptMeta(
  attemptId: string,
  meta: { self_explanation?: string; generated_example?: string }
): Promise<void> {
  const res = await fetch(`/api/attempts/${attemptId}/meta`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": getOrCreateUserId(),
    },
    body: JSON.stringify(meta),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to save reflection");
  }
}

/** Map a raw deck prompt to a PromptView (fallback when GET /prompt fails).
 *  Preserves MCQ fields so a multiple-choice prompt never degrades to a
 *  free-recall textarea. The deck is redacted server-side (no answer key). */
function promptToView(p: Prompt, index: number): PromptView {
  return {
    prompt_index: index,
    text: p.text,
    objective_id: p.objective_id,
    difficulty: p.difficulty,
    format: p.format,
    choices: p.choices,
    meta: p.meta?.original_prompt_text
      ? { original_prompt_text: p.meta.original_prompt_text }
      : undefined,
  };
}

// --- Main Component ---

interface Props {
  session: SessionData;
}

export function SessionRunner({ session }: Props) {
  const [screen, setScreen] = useState<Screen>(() => {
    if (session.last_completed_run && !session.has_active_run) return "end";
    return "preflight";
  });

  const [run, setRun] = useState<RunData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const startRun = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiPost(
        `/api/sessions/${session.session_id}/runs/start`
      );

      // Build current_prompt from response
      let currentPrompt: PromptView | null = data.current_prompt ?? null;

      // Fallback for backward compat: if no current_prompt but prompts array exists
      if (!currentPrompt && data.prompts && data.prompts.length > 0) {
        const idx = data.current_index ?? 0;
        const p = data.prompts[idx];
        if (p) {
          currentPrompt = promptToView(p, idx);
        }
      }

      // For EXAM_SIM REVIEW phase, fetch attempts so we can show saved answers
      let attempts: RunData["attempts"] = undefined;
      if (data.phase === "REVIEW" && data.resumed) {
        const full = await apiGet(`/api/runs/${data.run_id}`);
        attempts = full.attempts;
      }

      const runData: RunData = {
        ...data,
        prompt_count: data.prompt_count ?? data.prompts?.length ?? 0,
        current_prompt: currentPrompt,
        mode: data.mode ?? session.mode,
        phase: data.phase ?? "ACTIVE",
        policies: data.policies ?? { scoring: "IMMEDIATE", requiresErrorLogOn: ["PARTIAL", "INCORRECT"], allowHintsBeforeAnswer: false, allowEndBreakEarly: true },
        attempts,
      };
      setRun(runData);
      if (data.status === "COMPLETED") {
        setScreen("end");
      } else if (data.break_state?.on_break) {
        setScreen("break");
      } else {
        setScreen("runner");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to start session");
    } finally {
      setLoading(false);
    }
  }, [session.session_id, session.mode]);

  const handleAttemptSubmit = useCallback(
    async (attempt: Record<string, unknown>): Promise<AttemptSubmitResult | null> => {
      if (!run) return null;
      setError(null);
      try {
        const data = await apiPost(
          `/api/runs/${run.run_id}/attempt`,
          attempt
        );

        const newIndex = data.current_index;
        const promptCount = data.prompt_count ?? run.prompt_count;

        // Fetch next prompt if there are more
        let nextPrompt: PromptView | null = null;
        if (data.status !== "COMPLETED" && newIndex < promptCount) {
          try {
            nextPrompt = await fetchPrompt(run.run_id, newIndex);
          } catch {
            // Fallback to prompts array if available (stale but better than blank)
            if (run.prompts && run.prompts[newIndex]) {
              nextPrompt = promptToView(run.prompts[newIndex], newIndex);
            }
          }
        }

        const updatedRun: RunData = {
          ...run,
          current_index: newIndex,
          prompt_count: promptCount,
          current_prompt: nextPrompt,
          metrics: data.metrics,
          break_state: data.break_state,
          status: data.status,
          phase: data.phase ?? run.phase,
          answered_count: data.answered_count ?? run.answered_count,
          scored_count: data.scored_count ?? run.scored_count,
          last_attempt_id: data.attempt_id,
          last_feedback_status: data.feedback_status,
          feedback: undefined, // Clear previous feedback
        };

        // When transitioning to REVIEW, fetch attempts for display
        if (data.phase === "REVIEW" && run.phase === "EXAM") {
          try {
            const full = await apiGet(`/api/runs/${run.run_id}`);
            updatedRun.attempts = full.attempts;
          } catch { /* non-fatal — review can refetch */ }
        }

        setRun(updatedRun);

        if (data.status === "COMPLETED") {
          // Fetch full run data with confidence ratings for calibration dashboard
          try {
            const full = await apiGet(`/api/runs/${run.run_id}`);
            updatedRun.attempts = full.attempts;
            setRun({ ...updatedRun });
          } catch { /* non-fatal */ }
          setScreen("end");
        } else if (data.break_state?.on_break) {
          setScreen("break");
        }
        return data as AttemptSubmitResult;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to submit";
        if (msg.includes("break")) {
          // Server rejected the attempt because a break started; the attempt
          // was NOT recorded. Refresh break state and show the break screen.
          try {
            const fresh = await apiGet(`/api/runs/${run.run_id}`);
            setRun({
              ...run,
              run_id: fresh.run_id,
              status: fresh.status,
              current_index: fresh.current_index,
              prompt_count: fresh.prompt_count ?? run.prompt_count,
              current_prompt: run.current_prompt,
              metrics: fresh.metrics,
              break_state: fresh.break_state,
              phase: fresh.phase ?? run.phase,
              policies: fresh.policies ?? run.policies,
            });
          } catch {
            // Recovery fetch failed — still show the break screen with the
            // state we have rather than stranding the submit button.
          }
          setScreen("break");
          return null;
        }
        setError(msg);
        // Rethrow so callers never advance to the review phase for an
        // attempt that was not recorded.
        throw e;
      }
    },
    [run]
  );

  const handleBreakEnd = useCallback(async () => {
    if (!run) return;
    setError(null);
    try {
      const data = await apiPost(`/api/runs/${run.run_id}/end-break`);
      setRun({ ...run, break_state: data.break_state });
      setScreen("runner");
    } catch (e: unknown) {
      setScreen("runner");
    }
  }, [run]);

  const handleCompleteRun = useCallback(async () => {
    if (!run) return;
    setError(null);
    try {
      const data = await apiPost(`/api/runs/${run.run_id}/complete`);
      let attempts = run.attempts;
      try {
        const full = await apiGet(`/api/runs/${run.run_id}`);
        attempts = full.attempts;
      } catch { /* non-fatal — end screen works without attempt details */ }
      setRun({ ...run, status: "COMPLETED", metrics: data.metrics, attempts });
      setScreen("end");
    } catch (e: unknown) {
      // The run is still ACTIVE server-side — showing the end screen would
      // fake completion (no mastery update, no follow-ups). Stay and retry.
      setError(e instanceof Error ? e.message : "Failed to complete session — please try again.");
    }
  }, [run]);

  const handleNewRun = useCallback(() => {
    setRun(null);
    setScreen("preflight");
  }, []);

  return (
    <main
      style={{
        maxWidth: 700,
        margin: "0 auto",
        padding: "1.5rem 1rem",
        fontFamily: "var(--font-body)",
        color: "var(--color-text)",
        backgroundColor: "var(--color-bg)",
        minHeight: "100vh",
      }}
    >
      {error && (
        <div
          style={{
            background: "var(--color-error)",
            color: "var(--color-bg-darkest)",
            padding: "0.5rem 1rem",
            borderRadius: 4,
            marginBottom: "1rem",
            fontSize: "0.85rem",
          }}
        >
          {error}
        </div>
      )}

      {screen === "preflight" && (
        <PreflightScreen
          session={session}
          onStart={startRun}
          loading={loading}
          hasActiveRun={session.has_active_run}
        />
      )}

      {screen === "runner" && run && (
        <RunnerScreen
          run={run}
          session={session}
          onSubmit={handleAttemptSubmit}
          onComplete={handleCompleteRun}
        />
      )}

      {screen === "break" && run && (
        <BreakScreen
          breakState={run.break_state}
          onBreakEnd={handleBreakEnd}
        />
      )}

      {screen === "end" && (
        <EndScreen
          run={run}
          session={session}
          onNewRun={handleNewRun}
        />
      )}
    </main>
  );
}
