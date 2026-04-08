"use client";

import type { SessionData } from "../session-runner";

interface Props {
  session: SessionData;
  onStart: () => void;
  loading: boolean;
  hasActiveRun: boolean;
}

export function PreflightScreen({ session, onStart, loading, hasActiveRun }: Props) {
  const outcome = session.target_outcome;
  const breaks = session.break_protocol;

  return (
    <div>
      <h1 style={{ fontSize: "1.4rem", margin: "0 0 0.25rem" }}>
        {session.course_name} | {session.exam_name}
      </h1>
      <p style={{ color: "#888", margin: "0 0 1.5rem" }}>
        {session.mode_label}: {session.topic_scope}
      </p>

      <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginBottom: "1.5rem", fontSize: "0.85rem" }}>
        {outcome?.prompt_count != null && (
          <div>
            <span style={metaLabel}>Prompts</span>
            <span>{outcome.prompt_count as number}</span>
          </div>
        )}
        {outcome?.target_accuracy != null && (
          <div>
            <span style={metaLabel}>Target</span>
            <span>{((outcome.target_accuracy as number) * 100).toFixed(0)}%</span>
          </div>
        )}
        <div>
          <span style={metaLabel}>Duration</span>
          <span>{session.planned_minutes} min</span>
        </div>
        {breaks && (
          <div>
            <span style={metaLabel}>Breaks</span>
            <span>
              {breaks.type === "25_5" ? "25/5" : breaks.type === "50_10" ? "50/10" : breaks.type === "90_15" ? "90/15" : breaks.type === "12_3" ? "12/3" : String(breaks.type)}
              {breaks.cycles ? ` x${breaks.cycles}` : ""}
            </span>
          </div>
        )}
      </div>

      {session.mode === "EXAM_SIM" && (
        <div style={examBanner}>
          Exam Simulation: answer all prompts first, then self-score. No feedback until review.
        </div>
      )}

      <button onClick={onStart} disabled={loading} style={{ ...buttonStyle, opacity: loading ? 0.5 : 1, cursor: loading ? "wait" : "pointer" }}>
        {loading ? "Starting..." : hasActiveRun ? "Resume Session" : "Start Session"}
      </button>
    </div>
  );
}

const metaLabel: React.CSSProperties = {
  color: "#666",
  fontSize: "0.7rem",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  display: "block",
  marginBottom: "0.15rem",
};

const examBanner: React.CSSProperties = {
  background: "#2d1b4e",
  border: "1px solid #6c3fc0",
  borderRadius: 6,
  padding: "0.75rem 1rem",
  marginBottom: "1.5rem",
  fontSize: "0.85rem",
  color: "#c9a0ff",
};

const buttonStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.85rem",
  fontSize: "1rem",
  fontFamily: "inherit",
  fontWeight: 600,
  background: "#4cc9f0",
  color: "#1a1a2e",
  border: "none",
  borderRadius: 6,
};
