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
  day_index: number;
  start_time: string;
  end_time: string;
  status: string;
  completed_at: string | null;
  missed_at: string | null;
  session_id: string;
  mode: string;
  topic_scope: string;
  planned_minutes: number;
  course_name: string;
  exam_name: string;
  runs: RunInfo[];
}

interface Plan {
  plan_id: string;
  course_name: string;
  exam_name: string;
  exam_date: string;
  start_date: string;
  end_date: string;
  timezone: string;
  created_at: string;
  items: PlanItem[];
}

// ---- Helpers ----

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function getWeekDays(): Date[] {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

const STATUS_COLORS: Record<string, string> = {
  SCHEDULED: "#4cc9f0",
  DONE: "#00ff88",
  MISSED: "#ff4444",
  IN_PROGRESS: "#ffcc00",
  SKIPPED: "#888",
  RESCHEDULED: "#a855f7",
};

const MODE_COLORS: Record<string, string> = {
  RETRIEVAL: "#4cc9f0",
  INTERLEAVED_PRACTICE: "#a855f7",
  ERROR_REPAIR: "#ff4444",
  EXAM_SIM: "#ffcc00",
  WORKED_EXAMPLES: "#00ff88",
  OFFICE_HOURS_PREP: "#ff8844",
};

function statusColor(status: string): string {
  return STATUS_COLORS[status] || "#888";
}

function modeColor(mode: string): string {
  return MODE_COLORS[mode] || "#4cc9f0";
}

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
      .sort(
        (a, b) =>
          new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
      );
  }, [allItems, today]);

  // Weekly overview
  const weekDays = useMemo(() => getWeekDays(), []);
  const weekData = useMemo(() => {
    return weekDays.map((day) => {
      const sessions = allItems.filter((item) =>
        isSameDay(new Date(item.start_time), day),
      );
      return { day, sessions };
    });
  }, [weekDays, allItems]);

  // Stats
  const stats = useMemo(() => {
    const completed = allItems.filter((i) => i.status === "DONE");
    const totalCompleted = completed.length;

    // Total study time (from planned_minutes of completed sessions)
    const totalMinutes = completed.reduce(
      (sum, i) => sum + i.planned_minutes,
      0,
    );
    const totalHours = Math.round(totalMinutes / 60 * 10) / 10;

    // Average accuracy from runs with metrics
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
    const avgAccuracy =
      accuracyCount > 0 ? Math.round((totalAccuracy / accuracyCount) * 100) : null;

    // Study streak: consecutive days with completed sessions, counting back from today
    let streak = 0;
    const checkDate = new Date(today);
    while (true) {
      const hasCompleted = completed.some((i) =>
        isSameDay(new Date(i.completed_at || i.end_time), checkDate),
      );
      if (hasCompleted) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        // If today has no completed sessions yet, check if there are scheduled ones
        if (streak === 0) {
          checkDate.setDate(checkDate.getDate() - 1);
          const yesterdayCompleted = completed.some((i) =>
            isSameDay(new Date(i.completed_at || i.end_time), checkDate),
          );
          if (yesterdayCompleted) {
            streak++;
            checkDate.setDate(checkDate.getDate() - 1);
            continue;
          }
        }
        break;
      }
    }

    return { totalCompleted, totalHours, avgAccuracy, streak };
  }, [allItems, today]);

  // Unique courses
  const courses = useMemo(() => {
    const courseMap = new Map<
      string,
      {
        courseName: string;
        examName: string;
        examDate: string;
        total: number;
        completed: number;
        totalMinutes: number;
      }
    >();
    for (const plan of plans) {
      const key = `${plan.course_name}::${plan.exam_name}`;
      const existing = courseMap.get(key);
      const completed = plan.items.filter((i) => i.status === "DONE").length;
      if (existing) {
        existing.total += plan.items.length;
        existing.completed += completed;
        existing.totalMinutes += plan.items.reduce(
          (s, i) => s + i.planned_minutes,
          0,
        );
        // Use the latest exam date
        if (plan.exam_date > existing.examDate) {
          existing.examDate = plan.exam_date;
        }
      } else {
        courseMap.set(key, {
          courseName: plan.course_name,
          examName: plan.exam_name,
          examDate: plan.exam_date,
          total: plan.items.length,
          completed,
          totalMinutes: plan.items.reduce(
            (s, i) => s + i.planned_minutes,
            0,
          ),
        });
      }
    }
    return Array.from(courseMap.values());
  }, [plans]);

  // ---- Render ----

  if (loading) {
    return (
      <main style={mainStyle}>
        <style>{`@keyframes dash-spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ textAlign: "center", padding: "4rem 0", color: "#888" }}>
          <div style={spinnerStyle} />
          <p style={{ marginTop: "1rem" }}>Loading dashboard...</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main style={mainStyle}>
        <div
          style={{
            textAlign: "center",
            padding: "4rem 0",
            color: "#ff4444",
          }}
        >
          <p style={{ fontSize: "1.2rem" }}>Failed to load dashboard</p>
          <p style={{ color: "#888", marginTop: "0.5rem" }}>{error}</p>
          <button
            onClick={() => window.location.reload()}
            style={{ ...actionBtnStyle, marginTop: "1rem" }}
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  return (
    <main style={mainStyle}>
      <h1 style={headingStyle}>Dashboard</h1>

      {/* Quick Actions */}
      <section style={{ marginBottom: "2rem" }}>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <a href="/plan" style={actionBtnStyle}>
            + Create New Plan
          </a>
          <a href="/library" style={actionBtnStyle}>
            Upload Content
          </a>
          <a href="/settings/calendar" style={actionBtnStyle}>
            Calendar Settings
          </a>
        </div>
      </section>

      {/* Progress Stats */}
      <section style={{ marginBottom: "2rem" }}>
        <h2 style={sectionHeadingStyle}>Progress</h2>
        <div style={statsGridStyle}>
          <div style={statCardStyle}>
            <span style={statNumberStyle}>{stats.totalCompleted}</span>
            <span style={statLabelStyle}>Sessions Completed</span>
          </div>
          <div style={statCardStyle}>
            <span style={statNumberStyle}>
              {stats.avgAccuracy !== null ? `${stats.avgAccuracy}%` : "--"}
            </span>
            <span style={statLabelStyle}>Avg Accuracy</span>
          </div>
          <div style={statCardStyle}>
            <span style={{ ...statNumberStyle, color: "#ffcc00" }}>
              {stats.streak}
            </span>
            <span style={statLabelStyle}>Day Streak</span>
          </div>
          <div style={statCardStyle}>
            <span style={statNumberStyle}>{stats.totalHours}h</span>
            <span style={statLabelStyle}>Study Time</span>
          </div>
        </div>
      </section>

      {/* Today's Sessions */}
      <section style={{ marginBottom: "2rem" }}>
        <h2 style={sectionHeadingStyle}>Today&apos;s Sessions</h2>
        {todaySessions.length === 0 ? (
          <div style={emptyCardStyle}>
            <p style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>
              No sessions scheduled for today
            </p>
            <p style={{ color: "#888", fontSize: "0.85rem" }}>
              {plans.length === 0
                ? "Create your first study plan to get started!"
                : "Enjoy your free day -- rest is part of effective learning."}
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {todaySessions.map((item) => (
              <div key={item.id} style={sessionCardStyle}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ color: "#888", fontSize: "0.85rem", minWidth: "6.5rem" }}>
                    {formatTime(item.start_time)} - {formatTime(item.end_time)}
                  </span>
                  <span
                    style={{
                      ...badgeStyle,
                      backgroundColor: modeColor(item.mode) + "22",
                      color: modeColor(item.mode),
                      borderColor: modeColor(item.mode) + "44",
                    }}
                  >
                    {MODE_LABELS[item.mode] || item.mode}
                  </span>
                  <span style={{ color: "#e0e0e0", flex: 1 }}>
                    {item.topic_scope}
                  </span>
                  <span style={{ color: "#888", fontSize: "0.8rem" }}>
                    {item.planned_minutes}min
                  </span>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      color: statusColor(item.status),
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    {item.status.replace("_", " ")}
                  </span>
                </div>
                {(item.status === "SCHEDULED" || item.status === "IN_PROGRESS") && (
                  <a
                    href={`/s/${item.session_id}`}
                    style={{
                      ...actionBtnSmallStyle,
                      marginTop: "0.5rem",
                      display: "inline-block",
                    }}
                  >
                    {item.status === "IN_PROGRESS"
                      ? "Continue Session"
                      : "Start Session"}
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Weekly Overview */}
      <section style={{ marginBottom: "2rem" }}>
        <h2 style={sectionHeadingStyle}>This Week</h2>
        <div style={weekGridStyle}>
          {weekData.map(({ day, sessions }, idx) => {
            const isToday = isSameDay(day, today);
            const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
            return (
              <div
                key={idx}
                style={{
                  ...weekDayStyle,
                  borderColor: isToday ? "#4cc9f0" : "#333",
                  backgroundColor: isToday ? "#4cc9f011" : "transparent",
                }}
              >
                <span
                  style={{
                    fontSize: "0.75rem",
                    color: isToday ? "#4cc9f0" : "#888",
                    fontWeight: isToday ? 700 : 400,
                    marginBottom: "0.25rem",
                  }}
                >
                  {dayNames[idx]}
                </span>
                <span
                  style={{
                    fontSize: "0.7rem",
                    color: "#666",
                    marginBottom: "0.5rem",
                  }}
                >
                  {day.getDate()}
                </span>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "3px",
                    alignItems: "center",
                    flex: 1,
                    justifyContent: "flex-end",
                  }}
                >
                  {sessions.length === 0 && (
                    <span style={{ fontSize: "0.65rem", color: "#444" }}>--</span>
                  )}
                  {sessions.map((s) => (
                    <div
                      key={s.id}
                      title={`${MODE_LABELS[s.mode] || s.mode}: ${s.topic_scope} (${s.status})`}
                      style={{
                        width: "100%",
                        height: "6px",
                        borderRadius: "3px",
                        backgroundColor:
                          s.status === "DONE"
                            ? "#00ff88"
                            : s.status === "MISSED"
                              ? "#ff4444"
                              : modeColor(s.mode),
                        opacity: s.status === "DONE" ? 1 : 0.6,
                      }}
                    />
                  ))}
                </div>
                {sessions.length > 0 && (
                  <span
                    style={{
                      fontSize: "0.7rem",
                      color: "#888",
                      marginTop: "0.35rem",
                    }}
                  >
                    {sessions.length}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Course Cards */}
      {courses.length > 0 && (
        <section style={{ marginBottom: "2rem" }}>
          <h2 style={sectionHeadingStyle}>Courses</h2>
          <div style={courseGridStyle}>
            {courses.map((c, idx) => {
              const pct =
                c.total > 0 ? Math.round((c.completed / c.total) * 100) : 0;
              return (
                <a
                  key={idx}
                  href="/plan"
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <div style={courseCardStyle}>
                    <div
                      style={{
                        fontSize: "1rem",
                        fontWeight: 600,
                        color: "#e0e0e0",
                        marginBottom: "0.25rem",
                      }}
                    >
                      {c.courseName}
                    </div>
                    <div
                      style={{
                        fontSize: "0.8rem",
                        color: "#888",
                        marginBottom: "0.75rem",
                      }}
                    >
                      {c.examName}
                      {c.examDate && (
                        <span style={{ marginLeft: "0.5rem", color: "#666" }}>
                          Exam: {c.examDate}
                        </span>
                      )}
                    </div>

                    {/* Progress bar */}
                    <div style={progressBarBgStyle}>
                      <div
                        style={{
                          ...progressBarFillStyle,
                          width: `${pct}%`,
                        }}
                      />
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginTop: "0.35rem",
                        fontSize: "0.75rem",
                        color: "#888",
                      }}
                    >
                      <span>
                        {c.completed} / {c.total} sessions
                      </span>
                      <span style={{ color: "#00ff88" }}>{pct}%</span>
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}

// ---- Styles ----

const mainStyle: React.CSSProperties = {
  maxWidth: 960,
  margin: "0 auto",
  padding: "1.5rem 1rem",
  fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
  color: "#e0e0e0",
  backgroundColor: "#0a0a0a",
  minHeight: "100vh",
};

const headingStyle: React.CSSProperties = {
  fontSize: "1.4rem",
  margin: "0 0 1.5rem",
  color: "#00ff88",
  fontWeight: 700,
};

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: "0.95rem",
  color: "#4cc9f0",
  marginBottom: "0.75rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const statsGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: "0.75rem",
};

const statCardStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  padding: "1.25rem 1rem",
  border: "1px solid #333",
  borderRadius: "8px",
  backgroundColor: "#16213e",
};

const statNumberStyle: React.CSSProperties = {
  fontSize: "2rem",
  fontWeight: 700,
  color: "#00ff88",
  lineHeight: 1,
};

const statLabelStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "#888",
  marginTop: "0.5rem",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

const sessionCardStyle: React.CSSProperties = {
  padding: "0.75rem 1rem",
  border: "1px solid #333",
  borderRadius: "8px",
  backgroundColor: "#1a1a2e",
  transition: "border-color 0.15s",
};

const badgeStyle: React.CSSProperties = {
  fontSize: "0.7rem",
  padding: "0.15rem 0.5rem",
  borderRadius: "4px",
  border: "1px solid",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const emptyCardStyle: React.CSSProperties = {
  padding: "2rem",
  border: "1px dashed #333",
  borderRadius: "8px",
  textAlign: "center",
  color: "#ccc",
};

const weekGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(7, 1fr)",
  gap: "0.5rem",
};

const weekDayStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  padding: "0.5rem 0.25rem",
  border: "1px solid #333",
  borderRadius: "6px",
  minHeight: "80px",
};

const courseGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: "0.75rem",
};

const courseCardStyle: React.CSSProperties = {
  padding: "1rem",
  border: "1px solid #333",
  borderRadius: "8px",
  backgroundColor: "#1a1a2e",
  cursor: "pointer",
  transition: "border-color 0.15s, transform 0.15s",
};

const progressBarBgStyle: React.CSSProperties = {
  width: "100%",
  height: "6px",
  backgroundColor: "#333",
  borderRadius: "3px",
  overflow: "hidden",
};

const progressBarFillStyle: React.CSSProperties = {
  height: "100%",
  backgroundColor: "#00ff88",
  borderRadius: "3px",
  transition: "width 0.3s ease",
};

const actionBtnStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "0.5rem 1rem",
  fontSize: "0.8rem",
  color: "#00ff88",
  border: "1px solid #00ff8844",
  borderRadius: "6px",
  backgroundColor: "#00ff8811",
  textDecoration: "none",
  cursor: "pointer",
  transition: "background-color 0.15s, border-color 0.15s",
  fontFamily: "inherit",
};

const actionBtnSmallStyle: React.CSSProperties = {
  padding: "0.3rem 0.75rem",
  fontSize: "0.75rem",
  color: "#4cc9f0",
  border: "1px solid #4cc9f044",
  borderRadius: "4px",
  backgroundColor: "#4cc9f011",
  textDecoration: "none",
  cursor: "pointer",
  fontFamily: "inherit",
};

const spinnerStyle: React.CSSProperties = {
  width: "32px",
  height: "32px",
  border: "3px solid #333",
  borderTop: "3px solid #00ff88",
  borderRadius: "50%",
  margin: "0 auto",
  animation: "dash-spin 0.8s linear infinite",
};
