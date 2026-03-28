"use client";

import { useState } from "react";
import type { SessionData } from "../session-runner";

interface Props {
  session: SessionData;
  onStart: () => void;
  loading: boolean;
  hasActiveRun: boolean;
}

export function PreflightScreen({ session, onStart, loading, hasActiveRun }: Props) {
  const [checks, setChecks] = useState({
    closedBook: false,
    phoneAway: false,
    honestGrade: false,
  });

  const allChecked = checks.closedBook && checks.phoneAway && checks.honestGrade;
  const outcome = session.target_outcome;
  const breaks = session.break_protocol;

  return (
    <div>
      <div style={{ opacity: 0.5, fontSize: "0.75rem", marginBottom: "0.5rem" }}>
        TERMINAL SESSION // {session.mode}
      </div>

      <h1 style={{ fontSize: "1.4rem", margin: "0 0 0.25rem" }}>
        {session.course_name} | {session.exam_name}
      </h1>
      <p style={{ color: "#888", margin: "0 0 1.5rem" }}>
        {session.mode_label}: {session.topic_scope}
      </p>

      <Section title="TARGET OUTCOME">
        {outcome ? (
          <ul style={{ paddingLeft: "1.25rem", margin: 0 }}>
            {outcome.target_accuracy != null && outcome.prompt_count != null && (
              <li>
                Score &ge; {((outcome.target_accuracy as number) * 100).toFixed(0)}% on{" "}
                {outcome.prompt_count as number} prompts
              </li>
            )}
            {Boolean(outcome.closed_book_required) && <li>Closed-book first pass</li>}
            {Array.isArray(outcome.deliverables) &&
              (outcome.deliverables as string[]).map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        ) : (
          <p style={{ color: "#666" }}>No target set</p>
        )}
      </Section>

      <Section title="BREAK PROTOCOL">
        {breaks ? (
          <p>
            {breaks.type === "50_10"
              ? "50 min work / 10 min break"
              : breaks.type === "25_5"
                ? "25 min work / 5 min break"
                : breaks.type === "90_15"
                  ? "90 min work / 15 min break"
                  : breaks.type === "12_3"
                    ? "12 min work / 3 min break"
                    : String(breaks.type)}
            {breaks.cycles ? ` × ${breaks.cycles} cycle(s)` : ""}
          </p>
        ) : (
          <p style={{ color: "#666" }}>No breaks configured</p>
        )}
      </Section>

      <Section title="ESTIMATED DURATION">
        <p>{session.planned_minutes} minutes</p>
      </Section>

      <div
        style={{
          background: "#16213e",
          border: "1px solid #333",
          borderRadius: 6,
          padding: "1rem",
          margin: "1.5rem 0",
        }}
      >
        <p style={{ margin: "0 0 0.75rem", fontWeight: 600, fontSize: "0.85rem" }}>
          PRE-SESSION COMMITMENTS
        </p>
        <label style={checkboxStyle}>
          <input
            type="checkbox"
            checked={checks.closedBook}
            onChange={(e) => setChecks({ ...checks, closedBook: e.target.checked })}
          />
          I will attempt closed-book first
        </label>
        <label style={checkboxStyle}>
          <input
            type="checkbox"
            checked={checks.phoneAway}
            onChange={(e) => setChecks({ ...checks, phoneAway: e.target.checked })}
          />
          My phone is out of reach
        </label>
        <label style={checkboxStyle}>
          <input
            type="checkbox"
            checked={checks.honestGrade}
            onChange={(e) => setChecks({ ...checks, honestGrade: e.target.checked })}
          />
          I will self-grade honestly
        </label>
      </div>

      <button
        onClick={onStart}
        disabled={!allChecked || loading}
        style={{
          ...buttonStyle,
          opacity: allChecked && !loading ? 1 : 0.4,
          cursor: allChecked && !loading ? "pointer" : "not-allowed",
        }}
      >
        {loading
          ? "Starting..."
          : hasActiveRun
            ? "▶ Resume Session"
            : "▶ Start Session"}
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "1.25rem" }}>
      <h2
        style={{
          fontSize: "0.75rem",
          letterSpacing: "0.08em",
          color: "#4cc9f0",
          margin: "0 0 0.4rem",
        }}
      >
        {title}
      </h2>
      <div style={{ fontSize: "0.9rem" }}>{children}</div>
    </div>
  );
}

const checkboxStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  marginBottom: "0.5rem",
  fontSize: "0.85rem",
  cursor: "pointer",
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
