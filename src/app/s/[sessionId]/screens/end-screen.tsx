"use client";

import type { RunData, RunMetrics, SessionData } from "../session-runner";

interface Props {
  run: RunData | null;
  session: SessionData;
  onNewRun: () => void;
}

interface CalibrationPoint {
  prompt_index: number;
  confidence: number;
  score: number; // 1 = correct, 0.5 = partial, 0 = incorrect
  label: string;
}

function buildCalibrationData(attempts?: RunData["attempts"]): CalibrationPoint[] {
  if (!attempts) return [];
  return attempts
    .filter((a) => a.confidence_rating != null && a.self_score != null)
    .map((a) => ({
      prompt_index: a.prompt_index,
      confidence: a.confidence_rating!,
      score: a.self_score === "CORRECT" ? 1 : a.self_score === "PARTIAL" ? 0.5 : 0,
      label: `Q${a.prompt_index + 1}`,
    }));
}

function computeCalibrationGap(points: CalibrationPoint[]): { gap: number; overconfidentCount: number; underconfidentCount: number } {
  if (points.length === 0) return { gap: 0, overconfidentCount: 0, underconfidentCount: 0 };
  let overconfidentCount = 0;
  let underconfidentCount = 0;
  let totalGap = 0;

  for (const p of points) {
    const normalizedConfidence = (p.confidence - 1) / 4; // 1-5 → 0-1
    const diff = normalizedConfidence - p.score;
    totalGap += Math.abs(diff);
    if (diff > 0.25) overconfidentCount++;
    if (diff < -0.25) underconfidentCount++;
  }

  return { gap: totalGap / points.length, overconfidentCount, underconfidentCount };
}

export function EndScreen({ run, session, onNewRun }: Props) {
  // Use run metrics or fall back to last completed run from server
  const metrics: RunMetrics | null =
    (run?.metrics as RunMetrics) ??
    (session.last_completed_run?.metrics as RunMetrics | undefined) ??
    null;

  if (!metrics || metrics.attempts_count === 0) {
    return (
      <div style={{ textAlign: "center", padding: "2rem 0" }}>
        <h1 style={{ fontSize: "1.3rem" }}>No completed run yet</h1>
        <p style={{ color: "#888", marginBottom: "1.5rem" }}>
          Start a session to see your results here.
        </p>
        <button onClick={onNewRun} style={primaryBtn}>
          Start New Run
        </button>
      </div>
    );
  }

  const accuracyPct = (metrics.accuracy * 100).toFixed(1);
  const timeMin = Math.round(metrics.time_spent_seconds / 60);

  return (
    <div>
      <div
        style={{
          textAlign: "center",
          padding: "1.5rem 0",
          marginBottom: "1.5rem",
        }}
      >
        <div
          style={{
            fontSize: "0.75rem",
            letterSpacing: "0.1em",
            color: "#4cc9f0",
            marginBottom: "0.5rem",
          }}
        >
          SESSION COMPLETE
        </div>
        <h1 style={{ fontSize: "1.3rem", margin: "0 0 0.25rem" }}>
          {session.course_name} | {session.exam_name}
        </h1>
        <p style={{ color: "#888", margin: 0 }}>
          {session.mode_label}: {session.topic_scope}
        </p>
      </div>

      {/* EXAM_SIM two-phase indicator */}
      {session.mode === "EXAM_SIM" && run && (
        <div
          style={{
            background: "#2d1b4e",
            border: "1px solid #6c3fc0",
            borderRadius: 6,
            padding: "0.75rem 1rem",
            marginBottom: "1rem",
            fontSize: "0.8rem",
            color: "#c9a0ff",
            display: "flex",
            justifyContent: "space-around",
          }}
        >
          <span>Answered: {run.answered_count ?? "—"}</span>
          <span>Scored: {run.scored_count ?? "—"}</span>
        </div>
      )}

      {/* Stats grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "0.75rem",
          marginBottom: "1.5rem",
        }}
      >
        <StatCard label="Accuracy" value={`${accuracyPct}%`} color={accuracyColor(metrics.accuracy)} />
        <StatCard label="Time" value={`${timeMin} min`} color="#4cc9f0" />
        <StatCard label="Correct" value={String(metrics.correct_count)} color="#2ecc71" />
        <StatCard
          label="Partial / Incorrect"
          value={`${metrics.partial_count} / ${metrics.incorrect_count}`}
          color="#e74c3c"
        />
      </div>

      {/* Attempts breakdown */}
      <div
        style={{
          background: "#16213e",
          border: "1px solid #333",
          borderRadius: 6,
          padding: "1rem",
          marginBottom: "1.5rem",
        }}
      >
        <h2 style={sectionTitle}>SCORE BREAKDOWN</h2>
        <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", marginBottom: "0.5rem" }}>
          {metrics.correct_count > 0 && (
            <div
              style={{
                flex: metrics.correct_count,
                background: "#2ecc71",
              }}
            />
          )}
          {metrics.partial_count > 0 && (
            <div
              style={{
                flex: metrics.partial_count,
                background: "#f39c12",
              }}
            />
          )}
          {metrics.incorrect_count > 0 && (
            <div
              style={{
                flex: metrics.incorrect_count,
                background: "#e74c3c",
              }}
            />
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", color: "#888" }}>
          <span style={{ color: "#2ecc71" }}>✓ {metrics.correct_count}</span>
          <span style={{ color: "#f39c12" }}>~ {metrics.partial_count}</span>
          <span style={{ color: "#e74c3c" }}>✗ {metrics.incorrect_count}</span>
        </div>
      </div>

      {/* Calibration Dashboard */}
      <CalibrationDashboard attempts={run?.attempts} />

      {/* Recommendations */}
      {metrics.recommended_followups && metrics.recommended_followups.length > 0 && (
        <div
          style={{
            background: "#16213e",
            border: "1px solid #333",
            borderRadius: 6,
            padding: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          <h2 style={sectionTitle}>RECOMMENDED FOLLOW-UPS</h2>
          <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.85rem", lineHeight: 1.8 }}>
            {metrics.recommended_followups.map((f, i) => (
              <li key={i}>
                {f.label} — <span style={{ color: "#4cc9f0" }}>{f.date}</span>
              </li>
            ))}
          </ul>
          <p style={{ margin: "0.75rem 0 0", fontSize: "0.7rem", color: "#666" }}>
            Based on spaced repetition research: lower accuracy → shorter intervals.
          </p>
        </div>
      )}

      <button onClick={onNewRun} style={primaryBtn}>
        Start New Run
      </button>
    </div>
  );
}

function CalibrationDashboard({ attempts }: { attempts?: RunData["attempts"] }) {
  const calibrationData = buildCalibrationData(attempts);
  if (calibrationData.length === 0) return null;
  const { gap, overconfidentCount, underconfidentCount } = computeCalibrationGap(calibrationData);
  const label = gap < 0.15 ? "Well Calibrated" : gap < 0.3 ? "Slightly Miscalibrated" : "Needs Work";
  const color = gap < 0.15 ? "#2ecc71" : gap < 0.3 ? "#f39c12" : "#e74c3c";

  return (
    <div style={{ background: "#16213e", border: "1px solid #333", borderRadius: 6, padding: "1rem", marginBottom: "1.5rem" }}>
      <h2 style={sectionTitle}>CONFIDENCE CALIBRATION</h2>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: overconfidentCount > 0 || underconfidentCount > 0 ? "0.5rem" : 0 }}>
        <span style={{ fontSize: "0.95rem", color, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: "0.75rem", color: "#666" }}>({(gap * 100).toFixed(0)}% gap)</span>
      </div>
      {overconfidentCount > 0 && (
        <p style={{ margin: "0 0 0.25rem", fontSize: "0.8rem", color: "#e74c3c" }}>
          Overconfident on {overconfidentCount} question{overconfidentCount > 1 ? "s" : ""} — blind spots to review.
        </p>
      )}
      {underconfidentCount > 0 && (
        <p style={{ margin: 0, fontSize: "0.8rem", color: "#2ecc71" }}>
          Underconfident on {underconfidentCount} question{underconfidentCount > 1 ? "s" : ""} — you know more than you think.
        </p>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        background: "#16213e",
        border: "1px solid #333",
        borderRadius: 6,
        padding: "0.85rem",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "1.5rem", fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: "0.7rem", color: "#888", marginTop: "0.25rem" }}>{label}</div>
    </div>
  );
}

function accuracyColor(accuracy: number): string {
  if (accuracy >= 0.85) return "#2ecc71";
  if (accuracy >= 0.7) return "#f39c12";
  return "#e74c3c";
}

const sectionTitle: React.CSSProperties = {
  fontSize: "0.7rem",
  letterSpacing: "0.08em",
  color: "#4cc9f0",
  margin: "0 0 0.5rem",
};

const primaryBtn: React.CSSProperties = {
  width: "100%",
  padding: "0.85rem",
  fontSize: "0.95rem",
  fontFamily: "inherit",
  fontWeight: 600,
  background: "#4cc9f0",
  color: "#1a1a2e",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
};
