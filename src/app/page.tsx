"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MODE_LABELS } from "@/lib/client-utils";
import { BADGE_MAP, TOTAL_BADGES } from "@/lib/badge-data";
import { ErrorBoundary } from "@/ui/components/ErrorBoundary";

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


// ---- Helpers ----

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Session cards show a single quiet scope line. topic_scope is often a
 * comma-joined objective list (sometimes with a "(+N more)" suffix); when it
 * names more than 2 objectives, collapse to "N objectives" — the full scope
 * lives on the session preflight screen.
 */
function formatScope(scope: string): string {
  const moreMatch = scope.match(/\(\+(\d+) more\)\s*$/);
  const base = moreMatch ? scope.slice(0, moreMatch.index).trim() : scope;
  const parts = base.split(",").map((s) => s.trim()).filter(Boolean);
  const total = parts.length + (moreMatch ? parseInt(moreMatch[1], 10) : 0);
  return total > 2 ? `${total} objectives` : scope;
}

const MODE_COLORS: Record<string, string> = {
  RETRIEVAL: "var(--color-info)",
  INTERLEAVED_PRACTICE: "var(--color-review)",
  ERROR_REPAIR: "var(--color-error)",
  EXAM_SIM: "var(--color-primary)",
  WORKED_EXAMPLES: "var(--color-success)",
};

// ---- Component ----

export default function DashboardPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activityData, setActivityData] = useState<ActivityData | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [celebrationBadge, setCelebrationBadge] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState<{ show: boolean; step: number }>({ show: false, step: 0 });

  useEffect(() => {
    async function fetchPlans() {
      try {
        const res = await fetch("/api/plans");
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
        const res = await fetch("/api/stats/activity");
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
        const res = await fetch("/api/stats/game");
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
    async function checkOnboarding() {
      try {
        const res = await fetch("/api/onboarding");
        if (res.ok) {
          const data = await res.json();
          if (!data.complete) {
            setOnboarding({ show: true, step: 0 });
          }
        }
      } catch {
        // Non-critical
      }
    }
    fetchPlans();
    fetchActivity();
    fetchGameState();
    checkOnboarding();
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
        <div style={{ textAlign: "center", padding: "4rem 0", color: "var(--color-text-muted)" }}>
          <div style={spinnerStyle} />
          <p style={{ marginTop: "1rem" }}>Loading...</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main style={mainStyle}>
        <div style={{ textAlign: "center", padding: "4rem 0", color: "var(--color-error)" }}>
          <p style={{ fontSize: "1.3rem" }}>Failed to load dashboard</p>
          <p style={{ color: "var(--color-text-muted)", marginTop: "0.5rem" }}>{error}</p>
          <button onClick={() => window.location.reload()} style={actionBtnStyle}>
            Retry
          </button>
        </div>
      </main>
    );
  }

  const streak = gameState?.streak ?? activityData?.streak ?? 0;
  const totalXp = gameState?.xpTotal ?? activityData?.total_xp ?? 0;
  const earnedBadges = gameState?.achievements.length ?? 0;
  // First run: nothing to show but zeros — render only the welcoming Today card.
  const firstRun = plans.length === 0 && streak === 0 && totalXp === 0 && earnedBadges === 0;

  return (
    <main style={mainStyle}>
      <style>{`
        @keyframes dash-spin { to { transform: rotate(360deg); } }
        @keyframes confetti-fall { 0% { transform: translateY(-100%) rotate(0deg); opacity: 1; } 100% { transform: translateY(100vh) rotate(720deg); opacity: 0; } }
        @keyframes celebrate-pop { 0% { transform: scale(0); opacity: 0; } 50% { transform: scale(1.2); } 100% { transform: scale(1); opacity: 1; } }
      `}</style>

      {/* Confetti overlay */}
      <ErrorBoundary fallback={null}>
        {showConfetti && <ConfettiOverlay badge={celebrationBadge} />}
      </ErrorBoundary>

      {/* Onboarding overlay */}
      {onboarding.show && (
        <OnboardingFlow
          step={onboarding.step}
          onNext={() => setOnboarding((prev) => ({ ...prev, step: prev.step + 1 }))}
          onComplete={async () => {
            setOnboarding({ show: false, step: 0 });
            await fetch("/api/onboarding", { method: "POST" }).catch(() => {});
            router.push("/plan");
          }}
          onSkip={async () => {
            setOnboarding({ show: false, step: 0 });
            await fetch("/api/onboarding", { method: "POST" }).catch(() => {});
          }}
        />
      )}

      <h1 style={headingStyle}>Dashboard</h1>

      {/* Today's Sessions — the primary section, first on the page */}
      <section style={{ marginBottom: "2rem" }}>
        <h2 style={sectionHeadingStyle}>Today</h2>
        {todaySessions.length === 0 ? (
          <div style={plans.length === 0 ? { ...emptyCardStyle, padding: "3.5rem 2rem" } : emptyCardStyle}>
            <p style={{ fontSize: plans.length === 0 ? "1.25rem" : "1.1rem", marginBottom: "0.5rem" }}>
              {plans.length === 0 ? "Welcome to Study Bot" : "No sessions today"}
            </p>
            <p style={{ color: "var(--color-text-dim)", fontSize: "0.9rem", margin: 0 }}>
              {plans.length === 0
                ? "Create a study plan and your daily sessions will show up here."
                : "Rest is part of effective learning."}
            </p>
            {plans.length === 0 && (
              <Link href="/plan" style={{ ...primaryBtnStyle, marginTop: "1rem" }}>
                Create your plan
              </Link>
            )}
          </div>
        ) : (
          <div
            style={
              todaySessions.length === 1
                ? { display: "flex", flexDirection: "column", gap: 16 }
                : { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }
            }
          >
            {todaySessions.map((item) => {
              const single = todaySessions.length === 1;
              const mc = MODE_COLORS[item.mode] || "var(--color-info)";
              const actionable = item.status === "SCHEDULED" || item.status === "IN_PROGRESS";
              const actionLabel = item.status === "IN_PROGRESS" ? "Continue" : "Start";
              const cardContent = single ? (
                  // Single session: one wide row so the lone card feels substantial.
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                    <span style={{ color: "var(--color-text-dim)", fontSize: "0.9rem", minWidth: "6rem" }}>
                      {formatTime(item.start_time)} - {formatTime(item.end_time)}
                    </span>
                    <span style={{ fontWeight: 600, color: "var(--color-text)", fontSize: "1.15rem" }}>
                      {MODE_LABELS[item.mode] || item.mode}
                    </span>
                    <span style={{ color: "var(--color-text-muted)", flex: 1, minWidth: 0, fontSize: "0.95rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {formatScope(item.topic_scope)}
                    </span>
                    {actionable && <span style={primaryBtnStyle}>{actionLabel}</span>}
                    {item.status === "DONE" && (
                      <span style={{ color: "var(--color-success)", fontSize: "0.85rem" }}>Done</span>
                    )}
                  </div>
              ) : (
                  // Grid cards: stacked layout that reads cleanly at ~320px wide.
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.75rem" }}>
                      <span style={{ color: "var(--color-text-dim)", fontSize: "0.9rem" }}>
                        {formatTime(item.start_time)} - {formatTime(item.end_time)}
                      </span>
                      {item.status === "DONE" && (
                        <span style={{ color: "var(--color-success)", fontSize: "0.85rem" }}>Done</span>
                      )}
                    </div>
                    <span style={{ fontWeight: 600, color: "var(--color-text)" }}>
                      {MODE_LABELS[item.mode] || item.mode}
                    </span>
                    <span style={{ color: "var(--color-text-muted)", fontSize: "0.95rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {formatScope(item.topic_scope)}
                    </span>
                    {actionable && (
                      <span style={{ ...primaryBtnStyle, alignSelf: "flex-start", marginTop: "auto" }}>{actionLabel}</span>
                    )}
                  </div>
              );
              const cardStyle = {
                ...sessionCardStyle,
                padding: single ? "1.75rem 2rem" : "1.25rem 1.5rem",
                ...(single ? {} : { display: "flex" as const, flexDirection: "column" as const }),
                textDecoration: "none" as const,
                cursor: actionable ? "pointer" as const : "default" as const,
                borderLeft: `3px solid ${mc}`,
              };
              return actionable ? (
                <Link key={item.id} href={`/s/${item.session_id}`} style={cardStyle}>
                  {cardContent}
                </Link>
              ) : (
                <div key={item.id} style={cardStyle}>
                  {cardContent}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Everything below is suppressed on first run — no data, only zeros */}
      {!firstRun && (
        <>
          {/* Stats — one quiet line, no cards */}
          <section style={{ marginBottom: "2rem" }}>
            <p style={statStripStyle}>
              <Link href="/settings" style={{ color: "inherit", textDecoration: "none" }} title="Tap to adjust daily goal">
                {gameState?.xpToday ?? 0} / {gameState?.dailyXpGoal ?? 50} XP today
              </Link>
              <span style={statStripDotStyle}>·</span>
              <span>
                {streak} day streak
                {gameState && gameState.streakFreezes > 0 && ` (${gameState.streakFreezes} freeze${gameState.streakFreezes !== 1 ? "s" : ""})`}
              </span>
              <span style={statStripDotStyle}>·</span>
              <span>{stats.completed} session{stats.completed !== 1 ? "s" : ""}</span>
              <span style={statStripDotStyle}>·</span>
              <span>{stats.avgAccuracy !== null ? `${stats.avgAccuracy}%` : "--"} accuracy</span>
              <span style={statStripDotStyle}>·</span>
              <span>{stats.totalHours}h studied</span>
              <span style={statStripDotStyle}>·</span>
              <span>{totalXp} XP total</span>
            </p>
          </section>

          {/* Create plan shortcut if plans exist */}
          {plans.length > 0 && (
            <Link href="/plan" style={{ ...actionBtnStyle, display: "inline-block", marginBottom: "2rem" }}>
              + New Plan
            </Link>
          )}

          {/* Achievements */}
          <section style={{ marginBottom: "2rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
              <h2 style={{ ...sectionHeadingStyle, margin: 0 }}>Achievements</h2>
              <Link href="/achievements" style={{ fontSize: "0.75rem", color: "var(--color-text-faint)", textDecoration: "none" }}>
                View All ({earnedBadges}/{TOTAL_BADGES})
              </Link>
            </div>
            {gameState && gameState.achievements.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: "0.6rem" }}>
                {gameState.achievements.map((a) => {
                  const info = BADGE_MAP[a.badgeType];
                  if (!info) return null;
                  return (
                    <Link key={a.badgeType} href="/achievements" style={{ ...badgeStyle, textDecoration: "none" }} title={`${info.label}: ${info.description}`}>
                      <span style={{ fontSize: "1.3rem" }}>{info.icon}</span>
                      <span style={{ fontSize: "0.6rem", color: "var(--color-text-muted)", marginTop: "0.15rem" }}>{info.label}</span>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <Link href="/achievements" style={{ ...emptyCardStyle, display: "block", textDecoration: "none", padding: "1rem" }}>
                <p style={{ fontSize: "0.9rem", margin: 0, color: "var(--color-text-muted)" }}>
                  No badges earned yet. Start studying to unlock achievements!
                </p>
              </Link>
            )}
          </section>

          {/* Activity Heatmap — intentionally last */}
          {activityData && (
            <section style={{ marginBottom: "2rem" }}>
              <h2 style={sectionHeadingStyle}>Activity</h2>
              <ActivityHeatmap activity={activityData.activity} />
            </section>
          )}
        </>
      )}

    </main>
  );
}

// ---- Onboarding Flow ----

function OnboardingFlow({
  step,
  onNext,
  onComplete,
  onSkip,
}: {
  step: number;
  onNext: () => void;
  onComplete: () => void;
  onSkip: () => void;
}) {
  // Focus the dialog once on mount.
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const steps = [
    {
      title: "Welcome to Study Bot!",
      content: (
        <div>
          <p style={{ fontSize: "1rem", color: "var(--color-text)", lineHeight: 1.6, marginBottom: "1rem" }}>
            Your AI-powered study companion. Upload your course materials and let Study Bot help you learn more effectively.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", textAlign: "left" }}>
            {[
              { icon: "\u{1F0CF}", text: "Generate flashcards with spaced repetition" },
              { icon: "\u{1F4D6}", text: "Create study guides and cheat sheets" },
              { icon: "\u{1F4AC}", text: "Chat with your course materials" },
              { icon: "\u{1F4C5}", text: "Plan study sessions and track progress" },
              { icon: "\u{1F3C6}", text: "Earn XP and unlock achievements" },
            ].map((item) => (
              <div key={item.text} style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontSize: "0.9rem", color: "var(--color-text-secondary)" }}>
                <span style={{ fontSize: "1.1rem" }}>{item.icon}</span>
                <span>{item.text}</span>
              </div>
            ))}
          </div>
        </div>
      ),
    },
    {
      title: "Your learning journey",
      content: (
        <div>
          <p style={{ fontSize: "0.9rem", color: "var(--color-text-muted)", marginBottom: "1rem" }}>
            Here&apos;s how to get the most out of Study Bot:
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {[
              { step: "1", title: "Create a plan", desc: "On the Plan page: course name, exam date, and upload your notes" },
              { step: "2", title: "Study your sessions", desc: "Each plan day links to a session with questions from your materials" },
              { step: "3", title: "Review regularly", desc: "Use spaced repetition to build lasting knowledge" },
              { step: "4", title: "Track progress", desc: "Watch your XP grow and unlock achievements" },
            ].map((item) => (
              <div key={item.step} style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start" }}>
                <div style={{
                  width: 24, height: 24, borderRadius: "50%",
                  background: "var(--color-primary)", color: "var(--color-bg-darkest)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "0.75rem", fontWeight: 700, flexShrink: 0,
                }}>
                  {item.step}
                </div>
                <div>
                  <div style={{ fontSize: "0.9rem", color: "var(--color-text)", fontWeight: 600 }}>{item.title}</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--color-text-dim)" }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ),
    },
  ];

  const currentStep = steps[step] || steps[steps.length - 1];
  const isLast = step >= steps.length - 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome onboarding"
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(11, 14, 20, 0.8)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "1rem",
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        style={{
          background: "var(--color-bg)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-card)",
          padding: "2.5rem",
          maxWidth: 560,
          width: "100%",
          textAlign: "center",
          fontFamily: "var(--font-body)",
          outline: "none",
        }}
      >
        {/* Step indicator */}
        <div style={{ display: "flex", justifyContent: "center", gap: "0.4rem", marginBottom: "1.5rem" }}>
          {steps.map((_, i) => (
            <div
              key={i}
              style={{
                width: 8, height: 8, borderRadius: "50%",
                background: i <= step ? "var(--color-primary)" : "var(--color-border)",
                transition: "background 0.3s",
              }}
            />
          ))}
        </div>

        <h2 style={{
          fontSize: "1.5rem", color: "var(--color-primary)", fontWeight: 700, margin: "0 0 1rem",
          fontFamily: "var(--font-display)",
        }}>
          {currentStep.title}
        </h2>

        {currentStep.content}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1.5rem" }}>
          <button onClick={onSkip} style={{
            background: "none", border: "none", color: "var(--color-text-dim)", fontSize: "0.8rem",
            fontFamily: "inherit", cursor: "pointer", padding: "0.3rem",
          }}>
            Skip
          </button>
          <button
            onClick={isLast ? onComplete : onNext}
            style={{
              background: "var(--color-primary)", color: "var(--color-bg-darkest)", border: "none",
              padding: "0.55rem 1.5rem", fontSize: "0.95rem", fontWeight: 600,
              fontFamily: "inherit", borderRadius: "var(--radius-sm)", cursor: "pointer",
            }}
          >
            {isLast ? "Get Started" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Confetti Overlay ----

function ConfettiOverlay({ badge }: { badge: string | null }) {
  const info = badge ? BADGE_MAP[badge] : null;
  const particles = useMemo(() => {
    const colors = [
      "var(--color-primary)",
      "var(--color-warning)",
      "var(--color-success)",
      "var(--color-info)",
      "var(--color-review)",
      "var(--color-error)",
    ];
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
          <div style={{ fontSize: "1.3rem", color: "var(--color-primary)", fontWeight: 700, fontFamily: "var(--font-display)" }}>
            {info.label}!
          </div>
          <div style={{ fontSize: "0.85rem", color: "var(--color-text)", marginTop: "0.25rem" }}>
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
    if (count === 0) return "var(--color-bg-darkest)";
    if (count === 1) return "rgba(88, 201, 139, 0.3)"; // --color-success @ 30%
    if (count === 2) return "rgba(88, 201, 139, 0.5)";
    if (count <= 4) return "rgba(88, 201, 139, 0.72)";
    return "var(--color-success)";
  }, []);

  const cellSize = 11;
  const cellGap = 2;
  const step = cellSize + cellGap;

  // Natural drawing size; the SVGs scale up to fill the container on wide
  // viewports (via viewBox + width 100%) and scroll horizontally on narrow ones.
  const naturalWidth = weeks.length * step;

  return (
    <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
      <div style={{ minWidth: naturalWidth }}>
        <svg
          viewBox={`0 0 ${naturalWidth} 14`}
          width="100%"
          style={{ display: "block", marginBottom: "0.2rem" }}
        >
          {monthLabels.map((m, i) => (
            <text
              key={`${m.label}-${i}`}
              x={m.weekIndex * step}
              y={11}
              fill="var(--color-text-faint)"
              fontSize="9"
              fontFamily="inherit"
            >
              {m.label}
            </text>
          ))}
        </svg>
        <svg
          viewBox={`0 0 ${naturalWidth} ${7 * step}`}
          width="100%"
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
                stroke="var(--color-bg)"
                strokeWidth={0.5}
              >
                <title>{day.date}: {day.count} session{day.count !== 1 ? "s" : ""}</title>
              </rect>
            ))
          )}
        </svg>
        <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", marginTop: "0.4rem", justifyContent: "flex-end" }}>
          <span style={{ fontSize: "0.55rem", color: "var(--color-text-dim)" }}>Less</span>
          {[0, 1, 2, 3, 5].map((n) => (
            <svg key={n} width={cellSize} height={cellSize}>
              <rect width={cellSize} height={cellSize} rx={2} fill={getColor(n)} />
            </svg>
          ))}
          <span style={{ fontSize: "0.55rem", color: "var(--color-text-dim)" }}>More</span>
        </div>
      </div>
    </div>
  );
}

// ---- Styles ----

const mainStyle: React.CSSProperties = {
  maxWidth: 1100,
  margin: "0 auto",
  padding: "1.5rem 1.75rem",
  fontFamily: "var(--font-body)",
  color: "var(--color-text)",
  backgroundColor: "var(--color-bg)",
  minHeight: "100vh",
};

const headingStyle: React.CSSProperties = {
  fontSize: "1.6rem",
  margin: "0 0 1.5rem",
  color: "var(--color-text)",
  fontWeight: 700,
  fontFamily: "var(--font-display)",
};

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: "0.8rem",
  color: "var(--color-text-muted)",
  marginBottom: "0.75rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const statStripStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "baseline",
  columnGap: "0.5rem",
  rowGap: "0.2rem",
  margin: 0,
  fontSize: "0.8rem",
  color: "var(--color-text-muted)",
};

const statStripDotStyle: React.CSSProperties = {
  color: "var(--color-text-faint)",
};

const badgeStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  padding: "0.5rem 0.6rem",
  background: "var(--color-bg-card)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius)",
  minWidth: 60,
};

const sessionCardStyle: React.CSSProperties = {
  padding: "0.75rem 1rem",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius)",
  backgroundColor: "var(--color-bg-card)",
  boxShadow: "var(--shadow-card)",
};

const emptyCardStyle: React.CSSProperties = {
  padding: "2rem",
  border: "1px dashed var(--color-border-done)",
  borderRadius: "var(--radius-lg)",
  textAlign: "center",
  color: "var(--color-text-secondary)",
};

// Filled primary — the single visual primary action on the page.
const primaryBtnStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "0.45rem 1.1rem",
  fontSize: "0.9rem",
  fontWeight: 600,
  color: "var(--color-bg-darkest)",
  backgroundColor: "var(--color-primary)",
  border: "none",
  borderRadius: "var(--radius-sm)",
  textDecoration: "none",
  cursor: "pointer",
  fontFamily: "inherit",
};

const actionBtnStyle: React.CSSProperties = {
  padding: "0.5rem 1rem",
  fontSize: "0.9rem",
  fontWeight: 600,
  color: "var(--color-primary)",
  border: "1px solid var(--color-primary)",
  borderRadius: "var(--radius-sm)",
  backgroundColor: "var(--color-bg-selected)",
  textDecoration: "none",
  cursor: "pointer",
  fontFamily: "inherit",
};

const spinnerStyle: React.CSSProperties = {
  width: "32px",
  height: "32px",
  border: "3px solid var(--color-border)",
  borderTop: "3px solid var(--color-primary)",
  borderRadius: "50%",
  margin: "0 auto",
  animation: "dash-spin 0.8s linear infinite",
};
