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

export interface RunData {
  run_id: string;
  status: string;
  current_index: number;
  prompts: Prompt[];
  metrics: RunMetrics;
  break_state: BreakState;
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
      setRun(data);
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
  }, [session.session_id]);

  const handleAttemptSubmit = useCallback(
    async (attempt: {
      prompt_index: number;
      user_answer: string;
      self_score: string;
      time_to_answer_seconds?: number;
      error_log?: {
        error_type: string;
        correction_rule: string;
        variant_question?: string;
      };
    }) => {
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
        };
        setRun(updatedRun);

        if (data.status === "COMPLETED") {
          setScreen("end");
        } else if (data.break_state?.on_break) {
          setScreen("break");
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to submit";
        if (msg.includes("break")) {
          // Refresh run state
          const fresh = await apiGet(`/api/runs/${run.run_id}`);
          setRun({
            run_id: fresh.run_id,
            status: fresh.status,
            current_index: fresh.current_index,
            prompts: fresh.prompts,
            metrics: fresh.metrics,
            break_state: fresh.break_state,
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
      // Break may have already ended naturally
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
