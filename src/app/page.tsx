"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
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

interface ActivityDay {
  date: string;
  count: number;
}

interface ActivityData {
  activity: ActivityDay[];
  streak: number;
  total_xp: number;
  today_count: number;
}

interface GameState {
  xpToday: number;
  xpTotal: number;
  dailyXpGoal: number;
  streak: number;
  streakFreezes: number;
  achievements: { badgeType: string; earnedAt: string }[];
  newAchievements: string[];
}

// Achievement display data
const BADGE_INFO: Record<string, { label: string; icon: string; description: string }> = {
  STREAK_3:      { label: "Getting Started",   icon: "\u{1F525}", description: "3-day streak" },
  STREAK_7:      { label: "Week Warrior",       icon: "\u26A1",    description: "7-day streak" },
  STREAK_14:     { label: "Two-Week Titan",     icon: "\u{1F4AA}", description: "14-day streak" },
  STREAK_30:     { label: "Monthly Master",     icon: "\u{1F3C6}", description: "30-day streak" },
  STREAK_60:     { label: "Dedicated Scholar",  icon: "\u{1F393}", description: "60-day streak" },
  STREAK_100:    { label: "Century Club",       icon: "\u{1F48E}", description: "100-day streak" },
  FIRST_REVIEW:  { label: "First Steps",       icon: "\u{1F4D6}", description: "First flashcard review" },
  REVIEWS_100:   { label: "Card Shark",         icon: "\u{1F0CF}", description: "100 cards reviewed" },
  REVIEWS_500:   { label: "Flashcard Fiend",    icon: "\u{1F9E0}", description: "500 cards reviewed" },
  FIRST_PERFECT: { label: "Perfect Score",      icon: "\u2B50",    description: "Perfect deck run" },
  XP_100:        { label: "XP Centurion",       icon: "\u{1F4AF}", description: "100 total XP" },
  XP_1000:       { label: "XP Master",          icon: "\u{1F31F}", description: "1,000 total XP" },
};

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
  const [activityData, setActivityData] = useState<ActivityData | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [celebrationBadge, setCelebrationBadge] = useState<string | null>(null);

  useEffect(() => {
    const userId = getOrCreateUserId();
    async function fetchPlans() {
      try {
        const res = await fetch("/api/plans", {
          headers: { "X-User-Id": userId },
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
    async function fetchActivity() {
      try {
        const res = await fetch("/api/stats/activity", {
          headers: { "X-User-Id": userId },
        });
        if (res.ok) {
          const data = await res.json();
          setActivityData(data);
        }
      } catch {
        // Activity is non-critical
      }
    }
    async function fetchGameState() {
      try {
        const res = await fetch("/api/stats/game", {
          headers: { "X-User-Id": userId },
        });
        if (res.ok) {
          const data: GameState = await res.json();
          setGameState(data);
          // Show confetti for new achievements
          if (data.newAchievements && data.newAchievements.length > 0) {
            setCelebrationBadge(data.newAchievements[0]);
            setShowConfetti(true);
            setTimeout(() => { setShowConfetti(false); setCelebrationBadge(null); }, 4000);
          }
        }
      } catch {
        // Non-critical
      }
    }
    fetchPlans();
    fetchActivity();
    fetchGameState();
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

    return { completed: completed.length, totalHours, avgAccuracy };
  }, [allItems]);

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

  const streak = gameState?.streak ?? activityData?.streak ?? 0;
  const totalXp = gameState?.xpTotal ?? activityData?.total_xp ?? 0;

  return (
    <main style={mainStyle}>
      <style>{`
        @keyframes dash-spin { to { transform: rotate(360deg); } }
        @keyframes confetti-fall { 0% { transform: translateY(-100%) rotate(0deg); opacity: 1; } 100% { transform: translateY(100vh) rotate(720deg); opacity: 0; } }
        @keyframes celebrate-pop { 0% { transform: scale(0); opacity: 0; } 50% { transform: scale(1.2); } 100% { transform: scale(1); opacity: 1; } }
      `}</style>

      {/* Confetti overlay */}
      {showConfetti && <ConfettiOverlay badge={celebrationBadge} />}

      <h1 style={headingStyle}>Dashboard</h1>

      {/* XP Progress Ring + Stats Row */}
      <section style={{ marginBottom: "2rem" }}>
        <div style={statsGridStyle}>
          {/* XP Progress Ring */}
          <div style={{ ...statCardStyle, gridColumn: "span 2", display: "flex", flexDirection: "row", gap: "1rem", alignItems: "center", padding: "1rem" }}>
            <XpProgressRing
              current={gameState?.xpToday ?? 0}
              goal={gameState?.dailyXpGoal ?? 50}
            />
            <div>
              <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "#f0dc4e", fontFamily: "var(--font-display), 'Caveat', cursive" }}>
                {gameState?.xpToday ?? 0} / {gameState?.dailyXpGoal ?? 50} XP
              </div>
              <div style={{ fontSize: "0.75rem", color: "#7a7060", marginTop: "0.2rem" }}>Daily Goal</div>
              <div style={{ fontSize: "0.7rem", color: "#a89a82", marginTop: "0.1rem" }}>
                {totalXp} total XP
              </div>
            </div>
          </div>
          {/* Streak */}
          <div style={statCardStyle}>
            <span style={{ ...statNumberStyle, color: "#e8a040" }}>{streak}</span>
            <span style={statLabelStyle}>Streak</span>
            {gameState && gameState.streakFreezes > 0 && (
              <span style={{ fontSize: "0.6rem", color: "#7ec8e3", marginTop: "0.2rem" }}>
                {gameState.streakFreezes} freeze{gameState.streakFreezes !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          {/* Sessions */}
          <div style={statCardStyle}>
            <span style={statNumberStyle}>{stats.completed}</span>
            <span style={statLabelStyle}>Sessions</span>
          </div>
          {/* Accuracy */}
          <div style={statCardStyle}>
            <span style={statNumberStyle}>
              {stats.avgAccuracy !== null ? `${stats.avgAccuracy}%` : "--"}
            </span>
            <span style={statLabelStyle}>Accuracy</span>
          </div>
          {/* Hours */}
          <div style={statCardStyle}>
            <span style={statNumberStyle}>{stats.totalHours}h</span>
            <span style={statLabelStyle}>Total</span>
          </div>
        </div>
      </section>

      {/* Achievements */}
      {gameState && gameState.achievements.length > 0 && (
        <section style={{ marginBottom: "2rem" }}>
          <h2 style={sectionHeadingStyle}>Achievements</h2>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {gameState.achievements.map((a) => {
              const info = BADGE_INFO[a.badgeType];
              if (!info) return null;
              return (
                <div key={a.badgeType} style={badgeStyle} title={`${info.label}: ${info.description}`}>
                  <span style={{ fontSize: "1.3rem" }}>{info.icon}</span>
                  <span style={{ fontSize: "0.6rem", color: "#a89a82", marginTop: "0.15rem" }}>{info.label}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Activity Heatmap */}
      {activityData && (
        <section style={{ marginBottom: "2rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
            <h2 style={{ ...sectionHeadingStyle, margin: 0 }}>Activity</h2>
            <div style={{ display: "flex", gap: "1rem", fontSize: "0.8rem" }}>
              <span style={{ color: "#f0dc4e" }}>
                {totalXp} XP
              </span>
              <span style={{ color: "#e8a040" }}>
                {streak} day streak
              </span>
            </div>
          </div>
          <ActivityHeatmap activity={activityData.activity} />
        </section>
      )}

      {/* Streak milestones preview - show upcoming */}
      {streak > 0 && (
        <section style={{ marginBottom: "2rem" }}>
          <StreakMilestones streak={streak} earned={gameState?.achievements.map((a) => a.badgeType) ?? []} />
        </section>
      )}

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

// ---- XP Progress Ring ----

function XpProgressRing({ current, goal }: { current: number; goal: number }) {
  const pct = Math.min(current / goal, 1);
  const r = 28;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - pct);
  const complete = pct >= 1;

  return (
    <svg width={68} height={68} viewBox="0 0 68 68" style={{ flexShrink: 0 }}>
      {/* Background circle */}
      <circle cx={34} cy={34} r={r} fill="none" stroke="#334d33" strokeWidth={5} />
      {/* Progress arc */}
      <circle
        cx={34} cy={34} r={r}
        fill="none"
        stroke={complete ? "#88cc88" : "#f0dc4e"}
        strokeWidth={5}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 34 34)"
        style={{ transition: "stroke-dashoffset 0.5s" }}
      />
      {/* Center text */}
      <text x={34} y={36} textAnchor="middle" fill={complete ? "#88cc88" : "#f0dc4e"} fontSize="13" fontWeight="bold" fontFamily="inherit">
        {complete ? "\u2713" : `${Math.round(pct * 100)}%`}
      </text>
    </svg>
  );
}

// ---- Streak Milestones ----

function StreakMilestones({ streak, earned }: { streak: number; earned: string[] }) {
  const milestones = [
    { badge: "STREAK_3", days: 3 },
    { badge: "STREAK_7", days: 7 },
    { badge: "STREAK_14", days: 14 },
    { badge: "STREAK_30", days: 30 },
    { badge: "STREAK_60", days: 60 },
    { badge: "STREAK_100", days: 100 },
  ];

  // Find next unearned milestone
  const nextIdx = milestones.findIndex((m) => !earned.includes(m.badge));
  if (nextIdx === -1) return null; // All earned

  const next = milestones[nextIdx];
  const progress = Math.min(streak / next.days, 1);
  const info = BADGE_INFO[next.badge];

  return (
    <div style={{ background: "#334d33", border: "1px solid #4a6a4a", borderRadius: 6, padding: "0.75rem 1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
        <span style={{ fontSize: "0.75rem", color: "#7a7060", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Next Milestone
        </span>
        <span style={{ fontSize: "0.8rem", color: "#e8a040" }}>
          {info?.icon} {info?.label}
        </span>
      </div>
      <div style={{ height: 6, background: "#1f2e1f", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${progress * 100}%`, background: "#e8a040", borderRadius: 3, transition: "width 0.5s" }} />
      </div>
      <div style={{ fontSize: "0.7rem", color: "#7a7060", marginTop: "0.3rem", textAlign: "right" }}>
        {streak} / {next.days} days
      </div>
    </div>
  );
}

// ---- Confetti Overlay ----

function ConfettiOverlay({ badge }: { badge: string | null }) {
  const info = badge ? BADGE_INFO[badge] : null;
  const particles = useMemo(() => {
    const colors = ["#f0dc4e", "#e8a040", "#88cc88", "#7ec8e3", "#c4a0ff", "#e88888"];
    return Array.from({ length: 40 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 2,
      duration: 2 + Math.random() * 2,
      color: colors[i % colors.length],
      size: 4 + Math.random() * 6,
    }));
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10000, pointerEvents: "none", overflow: "hidden" }}>
      {particles.map((p) => (
        <div
          key={p.id}
          style={{
            position: "absolute",
            left: `${p.left}%`,
            top: -20,
            width: p.size,
            height: p.size,
            background: p.color,
            borderRadius: p.id % 3 === 0 ? "50%" : "1px",
            animation: `confetti-fall ${p.duration}s ease-in ${p.delay}s forwards`,
          }}
        />
      ))}
      {info && (
        <div style={{
          position: "absolute",
          top: "30%",
          left: "50%",
          transform: "translateX(-50%)",
          textAlign: "center",
          animation: "celebrate-pop 0.5s ease-out forwards",
        }}>
          <div style={{ fontSize: "3rem", marginBottom: "0.5rem" }}>{info.icon}</div>
          <div style={{ fontSize: "1.3rem", color: "#f0dc4e", fontWeight: 700, fontFamily: "var(--font-display), 'Caveat', cursive" }}>
            {info.label}!
          </div>
          <div style={{ fontSize: "0.85rem", color: "#e8dcc8", marginTop: "0.25rem" }}>
            {info.description}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Activity Heatmap ----

function ActivityHeatmap({ activity }: { activity: ActivityDay[] }) {
  const { weeks, monthLabels } = useMemo(() => {
    const countMap = new Map<string, number>();
    for (const a of activity) countMap.set(a.date, a.count);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayOfWeek = today.getDay();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - (52 * 7 + dayOfWeek));

    const wks: { date: string; count: number; dayOfWeek: number }[][] = [];
    const mLabels: { label: string; weekIndex: number }[] = [];
    let lastMonth = -1;

    const cursor = new Date(startDate);
    let weekIdx = 0;
    let currentWeek: { date: string; count: number; dayOfWeek: number }[] = [];

    while (cursor <= today) {
      const key = cursor.toISOString().slice(0, 10);
      const dow = cursor.getDay();

      if (dow === 0 && currentWeek.length > 0) {
        wks.push(currentWeek);
        weekIdx++;
        currentWeek = [];
      }

      const month = cursor.getMonth();
      if (month !== lastMonth) {
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        mLabels.push({ label: monthNames[month], weekIndex: weekIdx });
        lastMonth = month;
      }

      currentWeek.push({
        date: key,
        count: countMap.get(key) || 0,
        dayOfWeek: dow,
      });

      cursor.setDate(cursor.getDate() + 1);
    }
    if (currentWeek.length > 0) wks.push(currentWeek);

    return { weeks: wks, monthLabels: mLabels };
  }, [activity]);

  const getColor = useCallback((count: number) => {
    if (count === 0) return "#1f2e1f";
    if (count === 1) return "#2d5a2d";
    if (count === 2) return "#3d7a3d";
    if (count <= 4) return "#5aa05a";
    return "#88cc88";
  }, []);

  const cellSize = 11;
  const cellGap = 2;
  const step = cellSize + cellGap;

  return (
    <div style={{ overflow: "hidden" }}>
      <div style={{ display: "flex", marginBottom: "0.2rem", marginLeft: 0, height: 14 }}>
        <svg width={weeks.length * step} height={14} style={{ display: "block" }}>
          {monthLabels.map((m, i) => (
            <text
              key={`${m.label}-${i}`}
              x={m.weekIndex * step}
              y={11}
              fill="#7a7060"
              fontSize="9"
              fontFamily="inherit"
            >
              {m.label}
            </text>
          ))}
        </svg>
      </div>
      <svg
        width={weeks.length * step}
        height={7 * step}
        style={{ display: "block" }}
      >
        {weeks.map((week, wi) =>
          week.map((day) => (
            <rect
              key={day.date}
              x={wi * step}
              y={day.dayOfWeek * step}
              width={cellSize}
              height={cellSize}
              rx={2}
              fill={getColor(day.count)}
              stroke="#2a3d2a"
              strokeWidth={0.5}
            >
              <title>{day.date}: {day.count} session{day.count !== 1 ? "s" : ""}</title>
            </rect>
          ))
        )}
      </svg>
      <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", marginTop: "0.4rem", justifyContent: "flex-end" }}>
        <span style={{ fontSize: "0.55rem", color: "#7a7060" }}>Less</span>
        {[0, 1, 2, 3, 5].map((n) => (
          <svg key={n} width={cellSize} height={cellSize}>
            <rect width={cellSize} height={cellSize} rx={2} fill={getColor(n)} />
          </svg>
        ))}
        <span style={{ fontSize: "0.55rem", color: "#7a7060" }}>More</span>
      </div>
    </div>
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

const badgeStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  padding: "0.5rem 0.6rem",
  background: "#334d33",
  border: "1px solid #4a6a4a",
  borderRadius: 6,
  minWidth: 60,
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
