"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getOrCreateUserId, MODE_LABELS } from "@/lib/client-utils";
import { BADGE_MAP, TOTAL_BADGES } from "@/lib/badge-data";

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


interface LeaderboardEntry {
  rank: number;
  displayName: string;
  xp: number;
  isCurrentUser: boolean;
}

interface LeaderboardData {
  leaderboard: LeaderboardEntry[];
  period: string;
  userRank: number | null;
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
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activityData, setActivityData] = useState<ActivityData | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [celebrationBadge, setCelebrationBadge] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardData | null>(null);
  const [lbPeriod, setLbPeriod] = useState<"week" | "month" | "all">("week");
  const [onboarding, setOnboarding] = useState<{ show: boolean; step: number }>({ show: false, step: 0 });
  const [displayName, setDisplayName] = useState("");

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
    async function checkOnboarding() {
      try {
        const res = await fetch("/api/onboarding", {
          headers: { "X-User-Id": userId },
        });
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
    // Leaderboard is fetched by the lbPeriod effect
  }, []);

  // Reload leaderboard when period changes
  useEffect(() => {
    const userId = getOrCreateUserId();
    fetch(`/api/leaderboard?period=${lbPeriod}`, {
      headers: { "X-User-Id": userId },
    })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setLeaderboard(data); })
      .catch(() => {});
  }, [lbPeriod]);

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

  return (
    <main style={mainStyle}>
      <style>{`
        @keyframes dash-spin { to { transform: rotate(360deg); } }
        @keyframes confetti-fall { 0% { transform: translateY(-100%) rotate(0deg); opacity: 1; } 100% { transform: translateY(100vh) rotate(720deg); opacity: 0; } }
        @keyframes celebrate-pop { 0% { transform: scale(0); opacity: 0; } 50% { transform: scale(1.2); } 100% { transform: scale(1); opacity: 1; } }
      `}</style>

      {/* Confetti overlay */}
      {showConfetti && <ConfettiOverlay badge={celebrationBadge} />}

      {/* Onboarding overlay */}
      {onboarding.show && (
        <OnboardingFlow
          step={onboarding.step}
          displayName={displayName}
          onDisplayNameChange={setDisplayName}
          onNext={() => setOnboarding((prev) => ({ ...prev, step: prev.step + 1 }))}
          onComplete={async () => {
            setOnboarding({ show: false, step: 0 });
            const userId = getOrCreateUserId();
            if (displayName.trim()) {
              await fetch("/api/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json", "X-User-Id": userId },
                body: JSON.stringify({ displayName: displayName.trim() }),
              }).catch(() => {});
            }
            await fetch("/api/onboarding", {
              method: "POST",
              headers: { "X-User-Id": userId },
            }).catch(() => {});
            router.push("/learn");
          }}
          onSkip={async () => {
            setOnboarding({ show: false, step: 0 });
            const userId = getOrCreateUserId();
            await fetch("/api/onboarding", {
              method: "POST",
              headers: { "X-User-Id": userId },
            }).catch(() => {});
          }}
        />
      )}

      <h1 style={headingStyle}>Dashboard</h1>

      {/* XP Progress Ring + Stats Row */}
      <section style={{ marginBottom: "2rem" }}>
        <div style={statsGridStyle}>
          {/* XP Progress Ring — tap to adjust goal */}
          <Link href="/settings" style={{ ...statCardStyle, gridColumn: "span 2", display: "flex", flexDirection: "row", gap: "1rem", alignItems: "center", padding: "1rem", textDecoration: "none", cursor: "pointer" }}>
            <XpProgressRing
              current={gameState?.xpToday ?? 0}
              goal={gameState?.dailyXpGoal ?? 50}
            />
            <div>
              <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--color-primary)", fontFamily: "var(--font-display)" }}>
                {gameState?.xpToday ?? 0} / {gameState?.dailyXpGoal ?? 50} XP
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--color-text-faint)", marginTop: "0.2rem" }}>Daily Goal</div>
              <div style={{ fontSize: "0.7rem", color: "#b0a090", marginTop: "0.1rem" }}>
                {totalXp} total XP · Tap to adjust
              </div>
            </div>
          </Link>
          {/* Streak */}
          <div style={statCardStyle}>
            <span style={{ ...statNumberStyle, color: "var(--color-warning)" }}>{streak}</span>
            <span style={statLabelStyle}>Streak</span>
            {gameState && gameState.streakFreezes > 0 && (
              <span style={{ fontSize: "0.6rem", color: "var(--color-info)", marginTop: "0.2rem" }}>
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

      {/* Today's Sessions — primary actionable section */}
      <section style={{ marginBottom: "2rem" }}>
        <h2 style={sectionHeadingStyle}>Today</h2>
        {todaySessions.length === 0 ? (
          <div style={emptyCardStyle}>
            <p style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>
              {plans.length === 0 ? "No study plans yet" : "No sessions today"}
            </p>
            <p style={{ color: "var(--color-text-dim)", fontSize: "0.9rem", margin: 0 }}>
              {plans.length === 0
                ? "Create a plan to get started."
                : "Rest is part of effective learning."}
            </p>
            {plans.length === 0 && (
              <Link href="/plan" style={{ ...actionBtnStyle, marginTop: "1rem", display: "inline-block" }}>
                Create Plan
              </Link>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {todaySessions.map((item) => {
              const mc = MODE_COLORS[item.mode] || "#7ec8e3";
              const actionable = item.status === "SCHEDULED" || item.status === "IN_PROGRESS";
              const cardContent = (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                    <span style={{ color: "var(--color-text-dim)", fontSize: "0.9rem", minWidth: "6rem" }}>
                      {formatTime(item.start_time)} - {formatTime(item.end_time)}
                    </span>
                    <span style={{ fontWeight: 600, color: "var(--color-text)" }}>
                      {MODE_LABELS[item.mode] || item.mode}
                    </span>
                    <span style={{ color: "var(--color-text-muted)", flex: 1, fontSize: "0.95rem" }}>
                      {item.topic_scope}
                    </span>
                    {actionable && (
                      <span style={{ color: "var(--color-primary)", fontSize: "0.9rem", fontWeight: 600 }}>
                        {item.status === "IN_PROGRESS" ? "Continue" : "Start"}
                      </span>
                    )}
                    {item.status === "DONE" && (
                      <span style={{ color: "var(--color-success)", fontSize: "0.85rem" }}>Done</span>
                    )}
                  </div>
              );
              const cardStyle = {
                ...sessionCardStyle,
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
            View All ({gameState?.achievements.length || 0}/{TOTAL_BADGES})
          </Link>
        </div>
        {gameState && gameState.achievements.length > 0 ? (
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {gameState.achievements.map((a) => {
              const info = BADGE_MAP[a.badgeType];
              if (!info) return null;
              return (
                <Link key={a.badgeType} href="/achievements" style={{ ...badgeStyle, textDecoration: "none" }} title={`${info.label}: ${info.description}`}>
                  <span style={{ fontSize: "1.3rem" }}>{info.icon}</span>
                  <span style={{ fontSize: "0.6rem", color: "#b0a090", marginTop: "0.15rem" }}>{info.label}</span>
                </Link>
              );
            })}
          </div>
        ) : (
          <Link href="/achievements" style={{ ...emptyCardStyle, display: "block", textDecoration: "none", padding: "1rem" }}>
            <p style={{ fontSize: "0.9rem", margin: 0, color: "#b0a090" }}>
              No badges earned yet. Start studying to unlock achievements!
            </p>
          </Link>
        )}
      </section>

      {/* Activity Heatmap */}
      {activityData && (
        <section style={{ marginBottom: "2rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
            <h2 style={{ ...sectionHeadingStyle, margin: 0 }}>Activity</h2>
            <div style={{ display: "flex", gap: "1rem", fontSize: "0.8rem" }}>
              <span style={{ color: "var(--color-primary)" }}>
                {totalXp} XP
              </span>
              <span style={{ color: "var(--color-warning)" }}>
                {streak} day streak
              </span>
            </div>
          </div>
          <ActivityHeatmap activity={activityData.activity} />
        </section>
      )}

      {/* Streak milestones preview */}
      {streak > 0 && (
        <section style={{ marginBottom: "2rem" }}>
          <StreakMilestones streak={streak} earned={gameState?.achievements.map((a) => a.badgeType) ?? []} />
        </section>
      )}

      {/* Leaderboard */}
      {leaderboard && leaderboard.leaderboard.length > 0 && (
        <section style={{ marginBottom: "2rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
            <h2 style={{ ...sectionHeadingStyle, margin: 0 }}>Leaderboard</h2>
            <div style={{ display: "flex", gap: "0.25rem" }}>
              {(["week", "month", "all"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setLbPeriod(p)}
                  style={{
                    padding: "0.2rem 0.5rem",
                    fontSize: "0.7rem",
                    fontFamily: "inherit",
                    background: lbPeriod === p ? "#f0dc4e22" : "transparent",
                    color: lbPeriod === p ? "var(--color-primary)" : "var(--color-text-faint)",
                    border: `1px solid ${lbPeriod === p ? "#f0dc4e44" : "var(--color-border-subtle)"}`,
                    borderRadius: 4,
                    cursor: "pointer",
                    textTransform: "capitalize",
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: 6, overflow: "hidden" }}>
            {leaderboard.leaderboard.slice(0, 10).map((entry) => (
              <div
                key={entry.rank}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "0.5rem 0.75rem",
                  borderBottom: "1px solid var(--color-border-subtle)",
                  background: entry.isCurrentUser ? "#f0dc4e0d" : "transparent",
                }}
              >
                <span style={{
                  width: 24, textAlign: "center", fontWeight: 700, fontSize: "0.85rem",
                  color: entry.rank === 1 ? "var(--color-primary)" : entry.rank === 2 ? "#c4c4c4" : entry.rank === 3 ? "#cd7f32" : "var(--color-text-faint)",
                }}>
                  {entry.rank}
                </span>
                <span style={{ flex: 1, marginLeft: "0.5rem", fontSize: "0.85rem", color: entry.isCurrentUser ? "var(--color-primary)" : "var(--color-text)", fontWeight: entry.isCurrentUser ? 600 : 400 }}>
                  {entry.displayName}
                  {entry.isCurrentUser && <span style={{ fontSize: "0.7rem", color: "var(--color-text-faint)", marginLeft: "0.35rem" }}>(you)</span>}
                </span>
                <span style={{ fontSize: "0.8rem", color: "var(--color-primary)", fontWeight: 600 }}>
                  {entry.xp} XP
                </span>
              </div>
            ))}
          </div>
          {leaderboard.userRank && leaderboard.userRank > 10 && (
            <p style={{ fontSize: "0.75rem", color: "var(--color-text-faint)", marginTop: "0.4rem", textAlign: "center" }}>
              Your rank: #{leaderboard.userRank}
            </p>
          )}
        </section>
      )}
    </main>
  );
}

// ---- Onboarding Flow ----

function OnboardingFlow({
  step,
  displayName,
  onDisplayNameChange,
  onNext,
  onComplete,
  onSkip,
}: {
  step: number;
  displayName: string;
  onDisplayNameChange: (v: string) => void;
  onNext: () => void;
  onComplete: () => void;
  onSkip: () => void;
}) {
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
      title: "Set your display name",
      content: (
        <div>
          <p style={{ fontSize: "0.9rem", color: "var(--color-text-muted)", marginBottom: "1rem" }}>
            Choose a name for the leaderboard. You can always change this later in Settings.
          </p>
          <input
            type="text"
            value={displayName}
            onChange={(e) => onDisplayNameChange(e.target.value)}
            placeholder="Your display name"
            maxLength={50}
            style={{
              width: "100%",
              background: "var(--color-bg-input)",
              color: "var(--color-text)",
              border: "1px solid var(--color-border)",
              padding: "0.6rem 0.75rem",
              fontFamily: "inherit",
              fontSize: "1rem",
              borderRadius: 4,
              boxSizing: "border-box",
            }}
          />
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
              { step: "1", title: "Upload documents", desc: "Add your lecture notes, textbooks, or slides via the Flashcards page" },
              { step: "2", title: "Generate study materials", desc: "Create flashcard decks and study guides from your content" },
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
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(20, 30, 20, 0.85)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "1rem",
    }}>
      <div style={{
        background: "var(--color-bg)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        padding: "2rem",
        maxWidth: 480,
        width: "100%",
        textAlign: "center",
        fontFamily: "var(--font-body)",
      }}>
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
              padding: "0.55rem 1.5rem", fontSize: "0.95rem", fontWeight: 700,
              fontFamily: "inherit", borderRadius: 6, cursor: "pointer",
            }}
          >
            {isLast ? "Get Started" : "Next"}
          </button>
        </div>
      </div>
    </div>
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
  const info = BADGE_MAP[next.badge];

  return (
    <div style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "0.75rem 1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
        <span style={{ fontSize: "0.75rem", color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Next Milestone
        </span>
        <span style={{ fontSize: "0.8rem", color: "var(--color-warning)" }}>
          {info?.icon} {info?.label}
        </span>
      </div>
      <div style={{ height: 6, background: "var(--color-bg-darkest)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${progress * 100}%`, background: "var(--color-warning)", borderRadius: 3, transition: "width 0.5s" }} />
      </div>
      <div style={{ fontSize: "0.7rem", color: "var(--color-text-dim)", marginTop: "0.3rem", textAlign: "right" }}>
        {streak} / {next.days} days
      </div>
    </div>
  );
}

// ---- Confetti Overlay ----

function ConfettiOverlay({ badge }: { badge: string | null }) {
  const info = badge ? BADGE_MAP[badge] : null;
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
    <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
      <div style={{ display: "flex", marginBottom: "0.2rem", marginLeft: 0, height: 14, minWidth: weeks.length * step }}>
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
        <span style={{ fontSize: "0.55rem", color: "var(--color-text-dim)" }}>Less</span>
        {[0, 1, 2, 3, 5].map((n) => (
          <svg key={n} width={cellSize} height={cellSize}>
            <rect width={cellSize} height={cellSize} rx={2} fill={getColor(n)} />
          </svg>
        ))}
        <span style={{ fontSize: "0.55rem", color: "var(--color-text-dim)" }}>More</span>
      </div>
    </div>
  );
}

// ---- Styles ----

const mainStyle: React.CSSProperties = {
  maxWidth: 700,
  margin: "0 auto",
  padding: "1.5rem 1rem",
  fontFamily: "var(--font-body)",
  color: "var(--color-text)",
  backgroundColor: "var(--color-bg)",
  minHeight: "100vh",
};

const headingStyle: React.CSSProperties = {
  fontSize: "2rem",
  margin: "0 0 1.5rem",
  color: "var(--color-primary)",
  fontWeight: 700,
  fontFamily: "var(--font-display)",
};

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: "1rem",
  color: "#b0a090",
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
  border: "1px solid var(--color-border)",
  borderRadius: "6px",
  backgroundColor: "var(--color-bg-card)",
};

const statNumberStyle: React.CSSProperties = {
  fontSize: "1.5rem",
  fontWeight: 700,
  color: "var(--color-primary)",
  lineHeight: 1,
  fontFamily: "var(--font-display)",
};

const statLabelStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-faint)",
  marginTop: "0.4rem",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const badgeStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  padding: "0.5rem 0.6rem",
  background: "var(--color-bg-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  minWidth: 60,
};

const sessionCardStyle: React.CSSProperties = {
  padding: "0.75rem 1rem",
  border: "1px solid var(--color-border)",
  borderRadius: "6px",
  backgroundColor: "var(--color-bg-card)",
};

const emptyCardStyle: React.CSSProperties = {
  padding: "2rem",
  border: "1px dashed var(--color-border-done)",
  borderRadius: "8px",
  textAlign: "center",
  color: "var(--color-text-secondary)",
};

const actionBtnStyle: React.CSSProperties = {
  padding: "0.5rem 1rem",
  fontSize: "0.9rem",
  color: "var(--color-primary)",
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
  border: "3px solid var(--color-border)",
  borderTop: "3px solid var(--color-primary)",
  borderRadius: "50%",
  margin: "0 auto",
  animation: "dash-spin 0.8s linear infinite",
};
