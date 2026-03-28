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
    <div style={{ textAlign: "center", padding: "3rem 0" }}>
      <div
        style={{
          fontSize: "0.75rem",
          letterSpacing: "0.1em",
          color: "#f39c12",
          marginBottom: "1rem",
        }}
      >
        BREAK TIME
      </div>

      <div
        style={{
          fontSize: "3.5rem",
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          marginBottom: "1.5rem",
          color: "#f39c12",
        }}
      >
        {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
      </div>

      <div
        style={{
          background: "#16213e",
          border: "1px solid #333",
          borderRadius: 6,
          padding: "1.25rem",
          marginBottom: "2rem",
          textAlign: "left",
        }}
      >
        <p
          style={{
            margin: "0 0 0.75rem",
            fontSize: "0.8rem",
            fontWeight: 600,
            color: "#4cc9f0",
          }}
        >
          DO THIS NOW:
        </p>
        <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.85rem", lineHeight: 1.8 }}>
          <li>Stand up and stretch</li>
          <li>Get water</li>
          <li>Look at something far away (20-20-20 rule)</li>
          <li>Do NOT check your phone</li>
        </ul>
      </div>

      <p style={{ fontSize: "0.75rem", color: "#666", marginBottom: "1rem" }}>
        Cycle {breakState.current_cycle + 1} of {breakState.total_cycles}
      </p>

      <button
        onClick={onBreakEnd}
        style={{
          padding: "0.5rem 1.5rem",
          fontSize: "0.8rem",
          fontFamily: "inherit",
          background: "transparent",
          color: "#666",
          border: "1px solid #444",
          borderRadius: 6,
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
