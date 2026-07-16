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
      <h1 style={{ fontSize: "1.8rem", margin: "0 0 0.25rem", fontFamily: "var(--font-display)", color: "var(--color-primary)" }}>
        {session.course_name} | {session.exam_name}
      </h1>
      <p style={{ color: "var(--color-text-muted)", margin: "0 0 1.5rem", fontSize: "1rem" }}>
        {session.mode_label}: {session.topic_scope}
      </p>

      <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginBottom: "1.5rem", fontSize: "0.95rem" }}>
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

      {/* Deck composition contract: the student sees exactly what the deck
          holds before starting — no surprise session growth. */}
      {session.deck_preview && (
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "1.5rem", alignItems: "center" }}>
          <span style={{ ...metaLabel, marginBottom: 0 }}>Deck</span>
          {session.deck_preview.new_count > 0 && (
            <span style={deckChip("var(--color-info)")}>
              {session.deck_preview.new_count} new
            </span>
          )}
          {session.deck_preview.review_count > 0 && (
            <span style={deckChip("var(--color-success)")}>
              {session.deck_preview.review_count} review
            </span>
          )}
          {session.deck_preview.diagnostic_count > 0 && (
            <span style={deckChip("var(--color-warning)")}>
              {session.deck_preview.diagnostic_count} diagnostic
            </span>
          )}
          {session.deck_preview.repair_count > 0 && (
            <span style={deckChip("var(--color-error)")}>
              {session.deck_preview.repair_count} repair
            </span>
          )}
        </div>
      )}

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
  color: "var(--color-text-dim)",
  fontSize: "0.8rem",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  display: "block",
  marginBottom: "0.15rem",
};

const deckChip = (color: string): React.CSSProperties => ({
  padding: "0.15rem 0.55rem",
  fontSize: "0.78rem",
  color,
  border: `1px solid ${color}`,
  borderRadius: "999px",
  background: "transparent",
});

const examBanner: React.CSSProperties = {
  background: "var(--color-bg-review-tint)",
  border: "1px solid var(--color-review)",
  borderRadius: "var(--radius)",
  padding: "0.75rem 1rem",
  marginBottom: "1.5rem",
  fontSize: "0.95rem",
  color: "var(--color-review)",
};

const buttonStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.75rem 1.5rem",
  fontSize: "1.05rem",
  fontFamily: "var(--font-body)",
  fontWeight: 600,
  background: "var(--color-primary)",
  color: "var(--color-bg-darkest)",
  border: "none",
  borderRadius: "var(--radius)",
  cursor: "pointer",
};
