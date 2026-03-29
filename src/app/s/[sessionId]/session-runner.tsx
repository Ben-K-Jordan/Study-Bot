"use client";

import { useState, useCallback } from "react";
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
  meta?: {
    source_error_log_id?: string;
    original_prompt_text?: string;
    expected_correction_rule?: string;
    variant_question?: string;
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

export interface RunData {
  run_id: string;
  status: string;
  mode: string;
  phase: string;
  current_index: number;
  answered_count?: number | null;
  scored_count?: number | null;
  prompts: Prompt[];
  policies: RunPolicies;
  metrics: RunMetrics;
  break_state: BreakState;
  // Attempts are available on resumed runs (from GET /api/runs/:runId)
  attempts?: { prompt_index: number; user_answer: string; self_score: string | null }[];
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
      "X-User-Id": getUserIdFromStorage(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function apiGet(url: string) {
  const res = await fetch(url, {
    headers: { "X-User-Id": getUserIdFromStorage() },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function getUserIdFromStorage(): string {
  if (typeof window === "undefined") return "anonymous";
  let uid = localStorage.getItem("study_bot_user_id");
  if (!uid) {
    uid = "user_" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("study_bot_user_id", uid);
  }
  return uid;
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
      // For EXAM_SIM REVIEW phase, fetch attempts so we can show saved answers
      let attempts: RunData["attempts"] = undefined;
      if (data.phase === "REVIEW" && data.resumed) {
        const full = await apiGet(`/api/runs/${data.run_id}`);
        attempts = full.attempts;
      }
      const runData: RunData = {
        ...data,
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
    async (attempt: Record<string, unknown>) => {
      if (!run) return;
      setError(null);
      try {
        const data = await apiPost(
          `/api/runs/${run.run_id}/attempt`,
          attempt
        );
        const updatedRun: RunData = {
          ...run,
          current_index: data.current_index,
          metrics: data.metrics,
          break_state: data.break_state,
          status: data.status,
          phase: data.phase ?? run.phase,
          answered_count: data.answered_count ?? run.answered_count,
          scored_count: data.scored_count ?? run.scored_count,
        };

        // When transitioning to REVIEW, fetch attempts for display
        if (data.phase === "REVIEW" && run.phase === "EXAM") {
          const full = await apiGet(`/api/runs/${run.run_id}`);
          updatedRun.attempts = full.attempts;
        }

        setRun(updatedRun);

        if (data.status === "COMPLETED") {
          setScreen("end");
        } else if (data.break_state?.on_break) {
          setScreen("break");
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to submit";
        if (msg.includes("break")) {
          const fresh = await apiGet(`/api/runs/${run.run_id}`);
          setRun({
            ...run,
            run_id: fresh.run_id,
            status: fresh.status,
            current_index: fresh.current_index,
            prompts: fresh.prompts,
            metrics: fresh.metrics,
            break_state: fresh.break_state,
            phase: fresh.phase ?? run.phase,
            policies: fresh.policies ?? run.policies,
          });
          setScreen("break");
        } else {
          setError(msg);
        }
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
      setRun({ ...run, status: "COMPLETED", metrics: data.metrics });
      setScreen("end");
    } catch {
      setScreen("end");
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
        fontFamily:
          "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
        color: "#e0e0e0",
        backgroundColor: "#1a1a2e",
        minHeight: "100vh",
      }}
    >
      {error && (
        <div
          style={{
            background: "#ff4444",
            color: "#fff",
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
