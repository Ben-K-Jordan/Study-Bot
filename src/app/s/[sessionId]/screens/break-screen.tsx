"use client";

import { useState, useEffect } from "react";
import type { BreakState } from "../session-runner";

interface Props {
  breakState: BreakState;
  onBreakEnd: () => void;
}

export function BreakScreen({ breakState, onBreakEnd }: Props) {
  const [remaining, setRemaining] = useState(() => computeRemaining(breakState));

  useEffect(() => {
    const interval = setInterval(() => {
      const r = computeRemaining(breakState);
      setRemaining(r);
      if (r <= 0) {
        clearInterval(interval);
        onBreakEnd();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [breakState, onBreakEnd]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  return (
    <div style={{ textAlign: "center", padding: "4rem 0" }}>
      <div
        style={{
          fontSize: "1rem",
          letterSpacing: "0.12em",
          color: "var(--color-warning)",
          marginBottom: "1.25rem",
          fontFamily: "var(--font-display)",
        }}
      >
        BREAK TIME
      </div>

      <div
        style={{
          fontSize: "5rem",
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          marginBottom: "2rem",
          color: "var(--color-warning)",
          fontFamily: "var(--font-display)",
          lineHeight: 1,
        }}
      >
        {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
      </div>

      {/* Checklist stays a comfortable reading column, centered on the
          wider stage rather than stretched across it. */}
      <div
        style={{
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius)",
          padding: "1.5rem 1.75rem",
          margin: "0 auto 2rem",
          maxWidth: 560,
          textAlign: "left",
        }}
      >
        <p
          style={{
            margin: "0 0 0.75rem",
            fontSize: "0.95rem",
            fontWeight: 600,
            color: "var(--color-info)",
          }}
        >
          DO THIS NOW:
        </p>
        <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "1.05rem", lineHeight: 1.9 }}>
          <li>Stand up and stretch</li>
          <li>Get water</li>
          <li>Look at something far away (20-20-20 rule)</li>
          <li>Do NOT check your phone</li>
        </ul>
      </div>

      <p style={{ fontSize: "0.95rem", color: "var(--color-text-dim)", marginBottom: "1.25rem" }}>
        Cycle {breakState.current_cycle + 1} of {breakState.total_cycles}
      </p>

      <button
        onClick={onBreakEnd}
        style={{
          padding: "0.6rem 1.75rem",
          fontSize: "0.95rem",
          fontFamily: "var(--font-body)",
          background: "transparent",
          color: "var(--color-text-dim)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius)",
          cursor: "pointer",
        }}
      >
        End break early
      </button>
    </div>
  );
}

function computeRemaining(state: BreakState): number {
  if (!state.on_break || !state.break_started_at) return 0;
  const breakStart = new Date(state.break_started_at).getTime();
  const elapsed = (Date.now() - breakStart) / 1000;
  const duration = state.break_duration_seconds ?? 600;
  return Math.max(0, Math.ceil(duration - elapsed));
}
