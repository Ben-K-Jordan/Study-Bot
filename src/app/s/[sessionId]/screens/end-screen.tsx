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
        <h1 style={{ fontSize: "1.6rem", fontFamily: "var(--font-display), 'Caveat', cursive" }}>No completed run yet</h1>
        <p style={{ color: "#a89a82", marginBottom: "1.5rem" }}>
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
            fontSize: "0.85rem",
            letterSpacing: "0.1em",
            color: "#7ec8e3",
            marginBottom: "0.5rem",
            fontFamily: "var(--font-display), 'Caveat', cursive",
          }}
        >
          SESSION COMPLETE
        </div>
        <h1 style={{ fontSize: "1.6rem", margin: "0 0 0.25rem", fontFamily: "var(--font-display), 'Caveat', cursive", color: "#f0dc4e" }}>
          {session.course_name} | {session.exam_name}
        </h1>
        <p style={{ color: "#a89a82", margin: 0 }}>
          {session.mode_label}: {session.topic_scope}
        </p>
      </div>

      {/* EXAM_SIM two-phase indicator */}
      {session.mode === "EXAM_SIM" && run && (
        <div
          style={{
            background: "#3d3050",
            border: "1px solid #9a70d0",
            borderRadius: 6,
            padding: "0.75rem 1rem",
            marginBottom: "1rem",
            fontSize: "0.9rem",
            color: "#c4a0ff",
            display: "flex",
            justifyContent: "space-around",
          }}
        >
          <span>Answered: {run.answered_count ?? "\u2014"}</span>
          <span>Scored: {run.scored_count ?? "\u2014"}</span>
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
        <StatCard label="Time" value={`${timeMin} min`} color="#7ec8e3" />
        <StatCard label="Correct" value={String(metrics.correct_count)} color="#88cc88" />
        <StatCard
          label="Partial / Incorrect"
          value={`${metrics.partial_count} / ${metrics.incorrect_count}`}
          color="#e88888"
        />
      </div>

      {/* Attempts breakdown */}
      <div
        style={{
          background: "#334d33",
          border: "1px solid #4a6a4a",
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
                background: "#88cc88",
              }}
            />
          )}
          {metrics.partial_count > 0 && (
            <div
              style={{
                flex: metrics.partial_count,
                background: "#e8a040",
              }}
            />
          )}
          {metrics.incorrect_count > 0 && (
            <div
              style={{
                flex: metrics.incorrect_count,
                background: "#e88888",
              }}
            />
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "#a89a82" }}>
          <span style={{ color: "#88cc88" }}>✓ {metrics.correct_count}</span>
          <span style={{ color: "#e8a040" }}>~ {metrics.partial_count}</span>
          <span style={{ color: "#e88888" }}>✗ {metrics.incorrect_count}</span>
        </div>
      </div>

      {/* Calibration Dashboard */}
      <CalibrationDashboard attempts={run?.attempts} />

      {/* Recommendations */}
      {metrics.recommended_followups && metrics.recommended_followups.length > 0 && (
        <div
          style={{
            background: "#334d33",
            border: "1px solid #4a6a4a",
            borderRadius: 6,
            padding: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          <h2 style={sectionTitle}>RECOMMENDED FOLLOW-UPS</h2>
          <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.95rem", lineHeight: 1.8 }}>
            {metrics.recommended_followups.map((f, i) => (
              <li key={i}>
                {f.label} — <span style={{ color: "#7ec8e3" }}>{f.date}</span>
              </li>
            ))}
          </ul>
          <p style={{ margin: "0.75rem 0 0", fontSize: "0.8rem", color: "#7a7060" }}>
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
  const color = gap < 0.15 ? "#88cc88" : gap < 0.3 ? "#e8a040" : "#e88888";

  return (
    <div style={{ background: "#334d33", border: "1px solid #4a6a4a", borderRadius: 6, padding: "1rem", marginBottom: "1.5rem" }}>
      <h2 style={sectionTitle}>CONFIDENCE CALIBRATION</h2>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: overconfidentCount > 0 || underconfidentCount > 0 ? "0.5rem" : 0 }}>
        <span style={{ fontSize: "1.05rem", color, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: "0.85rem", color: "#7a7060" }}>({(gap * 100).toFixed(0)}% gap)</span>
      </div>
      {overconfidentCount > 0 && (
        <p style={{ margin: "0 0 0.25rem", fontSize: "0.9rem", color: "#e88888" }}>
          Overconfident on {overconfidentCount} question{overconfidentCount > 1 ? "s" : ""} — blind spots to review.
        </p>
      )}
      {underconfidentCount > 0 && (
        <p style={{ margin: 0, fontSize: "0.9rem", color: "#88cc88" }}>
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
        background: "#334d33",
        border: "1px solid #4a6a4a",
        borderRadius: 6,
        padding: "0.85rem",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "1.5rem", fontWeight: 700, color, fontFamily: "var(--font-display), 'Caveat', cursive" }}>{value}</div>
      <div style={{ fontSize: "0.8rem", color: "#a89a82", marginTop: "0.25rem" }}>{label}</div>
    </div>
  );
}

function accuracyColor(accuracy: number): string {
  if (accuracy >= 0.85) return "#88cc88";
  if (accuracy >= 0.7) return "#e8a040";
  return "#e88888";
}

const sectionTitle: React.CSSProperties = {
  fontSize: "0.8rem",
  letterSpacing: "0.08em",
  color: "#7ec8e3",
  margin: "0 0 0.5rem",
  fontFamily: "var(--font-display), 'Caveat', cursive",
};

const primaryBtn: React.CSSProperties = {
  width: "100%",
  padding: "0.85rem",
  fontSize: "1.05rem",
  fontFamily: "var(--font-body), 'Patrick Hand', cursive",
  fontWeight: 600,
  background: "#f0dc4e",
  color: "#1f2e1f",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
};
