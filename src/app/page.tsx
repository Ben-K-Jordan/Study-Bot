"use client";

import { useState, useEffect, useMemo } from "react";
import { getOrCreateUserId, MODE_LABELS } from "@/lib/client-utils";

// ---- Types ----

interface RunInfo {
  runId: string;
  status: string;
  metrics: unknown;
  endedAt: string | null;
  startedAt: string | null;
}

interface PlanItem {
  id: string;
  start_time: string;
  end_time: string;
  status: string;
  completed_at: string | null;
  session_id: string;
  mode: string;
  topic_scope: string;
  planned_minutes: number;
  runs: RunInfo[];
}

interface Plan {
  plan_id: string;
  course_name: string;
  exam_name: string;
  items: PlanItem[];
}

// ---- Helpers ----

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const MODE_COLORS: Record<string, string> = {
  RETRIEVAL: "#7ec8e3",
  INTERLEAVED_PRACTICE: "#c4a0ff",
  ERROR_REPAIR: "#e88888",
  EXAM_SIM: "#f0dc4e",
  WORKED_EXAMPLES: "#88cc88",
  OFFICE_HOURS_PREP: "#e8a040",
};

// ---- Component ----

export default function DashboardPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchPlans() {
      try {
        const res = await fetch("/api/plans", {
          headers: { "X-User-Id": getOrCreateUserId() },
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        setPlans(data.plans || []);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load plans");
      } finally {
        setLoading(false);
      }
    }
    fetchPlans();
  }, []);

  const allItems = useMemo(() => plans.flatMap((p) => p.items), [plans]);
  const today = useMemo(() => new Date(), []);

  const todaySessions = useMemo(() => {
    return allItems
      .filter((item) => isSameDay(new Date(item.start_time), today))
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  }, [allItems, today]);

  // Stats
  const stats = useMemo(() => {
    const completed = allItems.filter((i) => i.status === "DONE");
    const totalMinutes = completed.reduce((sum, i) => sum + i.planned_minutes, 0);
    const totalHours = Math.round((totalMinutes / 60) * 10) / 10;

    let totalAccuracy = 0;
    let accuracyCount = 0;
    for (const item of allItems) {
      for (const run of item.runs) {
        const m = run.metrics as Record<string, unknown> | null;
        if (m && typeof m === "object" && typeof m.accuracy === "number") {
          totalAccuracy += m.accuracy as number;
          accuracyCount++;
        }
      }
    }
    const avgAccuracy = accuracyCount > 0 ? Math.round((totalAccuracy / accuracyCount) * 100) : null;

    // Streak
    const completedDates = new Set(
      completed.map((i) => {
        const d = new Date(i.completed_at || i.start_time);
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      }),
    );
    const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    let streak = 0;
    const check = new Date(today);
    if (!completedDates.has(key(check))) check.setDate(check.getDate() - 1);
    while (completedDates.has(key(check))) {
      streak++;
      check.setDate(check.getDate() - 1);
    }

    return { completed: completed.length, totalHours, avgAccuracy, streak };
  }, [allItems, today]);

  // ---- Render ----

  if (loading) {
    return (
      <main style={mainStyle}>
        <style>{`@keyframes dash-spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ textAlign: "center", padding: "4rem 0", color: "#a89a82" }}>
          <div style={spinnerStyle} />
          <p style={{ marginTop: "1rem" }}>Loading...</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main style={mainStyle}>
        <div style={{ textAlign: "center", padding: "4rem 0", color: "#e88888" }}>
          <p style={{ fontSize: "1.3rem" }}>Failed to load dashboard</p>
          <p style={{ color: "#a89a82", marginTop: "0.5rem" }}>{error}</p>
          <button onClick={() => window.location.reload()} style={actionBtnStyle}>
            Retry
          </button>
        </div>
      </main>
    );
  }

  return (
    <main style={mainStyle}>
      <h1 style={headingStyle}>Dashboard</h1>

      {/* Progress Stats */}
      <section style={{ marginBottom: "2rem" }}>
        <div style={statsGridStyle}>
          <div style={statCardStyle}>
            <span style={statNumberStyle}>{stats.completed}</span>
            <span style={statLabelStyle}>Sessions</span>
          </div>
          <div style={statCardStyle}>
            <span style={statNumberStyle}>
              {stats.avgAccuracy !== null ? `${stats.avgAccuracy}%` : "--"}
            </span>
            <span style={statLabelStyle}>Accuracy</span>
          </div>
          <div style={statCardStyle}>
            <span style={{ ...statNumberStyle, color: "#e8a040" }}>{stats.streak}</span>
            <span style={statLabelStyle}>Streak</span>
          </div>
          <div style={statCardStyle}>
            <span style={statNumberStyle}>{stats.totalHours}h</span>
            <span style={statLabelStyle}>Total</span>
          </div>
        </div>
      </section>

      {/* Today's Sessions */}
      <section style={{ marginBottom: "2rem" }}>
        <h2 style={sectionHeadingStyle}>Today</h2>
        {todaySessions.length === 0 ? (
          <div style={emptyCardStyle}>
            <p style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>
              {plans.length === 0 ? "No study plans yet" : "No sessions today"}
            </p>
            <p style={{ color: "#7a7060", fontSize: "0.9rem", margin: 0 }}>
              {plans.length === 0
                ? "Create a plan to get started."
                : "Rest is part of effective learning."}
            </p>
            {plans.length === 0 && (
              <a href="/plan" style={{ ...actionBtnStyle, marginTop: "1rem", display: "inline-block" }}>
                Create Plan
              </a>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {todaySessions.map((item) => {
              const mc = MODE_COLORS[item.mode] || "#7ec8e3";
              const actionable = item.status === "SCHEDULED" || item.status === "IN_PROGRESS";
              return (
                <a
                  key={item.id}
                  href={actionable ? `/s/${item.session_id}` : undefined}
                  style={{
                    ...sessionCardStyle,
                    textDecoration: "none",
                    cursor: actionable ? "pointer" : "default",
                    borderLeft: `3px solid ${mc}`,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                    <span style={{ color: "#7a7060", fontSize: "0.9rem", minWidth: "6rem" }}>
                      {formatTime(item.start_time)} - {formatTime(item.end_time)}
                    </span>
                    <span style={{ fontWeight: 600, color: "#e8dcc8" }}>
                      {MODE_LABELS[item.mode] || item.mode}
                    </span>
                    <span style={{ color: "#a89a82", flex: 1, fontSize: "0.95rem" }}>
                      {item.topic_scope}
                    </span>
                    {actionable && (
                      <span style={{ color: "#f0dc4e", fontSize: "0.9rem", fontWeight: 600 }}>
                        {item.status === "IN_PROGRESS" ? "Continue" : "Start"}
                      </span>
                    )}
                    {item.status === "DONE" && (
                      <span style={{ color: "#88cc88", fontSize: "0.85rem" }}>Done</span>
                    )}
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </section>

      {/* Create plan shortcut if plans exist */}
      {plans.length > 0 && (
        <a href="/plan" style={{ ...actionBtnStyle, display: "inline-block" }}>
          + New Plan
        </a>
      )}
    </main>
  );
}

// ---- Styles ----

const mainStyle: React.CSSProperties = {
  maxWidth: 700,
  margin: "0 auto",
  padding: "1.5rem 1rem",
  fontFamily: "var(--font-body), 'Patrick Hand', cursive",
  color: "#e8dcc8",
  backgroundColor: "#2a3d2a",
  minHeight: "100vh",
};

const headingStyle: React.CSSProperties = {
  fontSize: "2rem",
  margin: "0 0 1.5rem",
  color: "#f0dc4e",
  fontWeight: 700,
  fontFamily: "var(--font-display), 'Caveat', cursive",
};

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: "1rem",
  color: "#a89a82",
  marginBottom: "0.75rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const statsGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  gap: "0.5rem",
};

const statCardStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  padding: "1rem 0.5rem",
  border: "1px solid #4a6a4a",
  borderRadius: "6px",
  backgroundColor: "#334d33",
};

const statNumberStyle: React.CSSProperties = {
  fontSize: "1.5rem",
  fontWeight: 700,
  color: "#f0dc4e",
  lineHeight: 1,
  fontFamily: "var(--font-display), 'Caveat', cursive",
};

const statLabelStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "#7a7060",
  marginTop: "0.4rem",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const sessionCardStyle: React.CSSProperties = {
  padding: "0.75rem 1rem",
  border: "1px solid #4a6a4a",
  borderRadius: "6px",
  backgroundColor: "#334d33",
};

const emptyCardStyle: React.CSSProperties = {
  padding: "2rem",
  border: "1px dashed #5a7a5a",
  borderRadius: "8px",
  textAlign: "center",
  color: "#c8bca8",
};

const actionBtnStyle: React.CSSProperties = {
  padding: "0.5rem 1rem",
  fontSize: "0.9rem",
  color: "#f0dc4e",
  border: "1px solid #f0dc4e44",
  borderRadius: "6px",
  backgroundColor: "#f0dc4e11",
  textDecoration: "none",
  cursor: "pointer",
  fontFamily: "inherit",
};

const spinnerStyle: React.CSSProperties = {
  width: "32px",
  height: "32px",
  border: "3px solid #4a6a4a",
  borderTop: "3px solid #f0dc4e",
  borderRadius: "50%",
  margin: "0 auto",
  animation: "dash-spin 0.8s linear infinite",
};
