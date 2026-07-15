"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { getOrCreateUserId } from "@/lib/client-utils";
import { ALL_BADGES, TOTAL_BADGES, CATEGORY_LABELS } from "@/lib/badge-data";

interface GameState {
  xpToday: number;
  xpTotal: number;
  dailyXpGoal: number;
  streak: number;
  streakFreezes: number;
  reviewCount: number;
  achievements: { badgeType: string; earnedAt: string }[];
  newAchievements: string[];
}

export default function AchievementsPage() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const userId = getOrCreateUserId();
    fetch("/api/stats/game", { headers: { "X-User-Id": userId } })
      .then((r) => r.json())
      .then((state) => setGameState(state))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <main style={mainStyle}>
        <style>{`@keyframes dash-spin { to { transform: rotate(360deg); } }`}</style>
        <h1 style={headingStyle}>Achievements</h1>
        <div style={{ textAlign: "center", padding: "4rem 0", color: "var(--color-text-muted)" }}>
          <div style={spinnerStyle} />
          <p style={{ marginTop: "1rem" }}>Loading achievements...</p>
        </div>
      </main>
    );
  }

  const earnedSet = new Set(gameState?.achievements.map((a) => a.badgeType) || []);
  const earnedMap = new Map(gameState?.achievements.map((a) => [a.badgeType, a.earnedAt]) || []);
  const totalEarned = earnedSet.size;
  const completionPct = Math.round((totalEarned / TOTAL_BADGES) * 100);

  function getProgress(badge: typeof ALL_BADGES[0]): number {
    if (earnedSet.has(badge.key)) return badge.threshold;
    if (badge.category === "streak") return gameState?.streak || 0;
    if (badge.category === "xp") return gameState?.xpTotal || 0;
    if (badge.category === "review") return gameState?.reviewCount || 0;
    return 0;
  }

  const categories = ["streak", "review", "xp"] as const;

  return (
    <main style={mainStyle}>
      <h1 style={headingStyle}>Achievements</h1>

      {/* Overall progress */}
      <section style={overviewCardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <svg width={64} height={64} viewBox="0 0 64 64" style={{ flexShrink: 0 }}>
            <circle cx={32} cy={32} r={26} fill="none" strokeWidth={5} style={{ stroke: "var(--color-bg-darkest)" }} />
            <circle
              cx={32} cy={32} r={26}
              fill="none"
              strokeWidth={5}
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 26}
              strokeDashoffset={2 * Math.PI * 26 * (1 - completionPct / 100)}
              transform="rotate(-90 32 32)"
              style={{ transition: "stroke-dashoffset 0.5s", stroke: "var(--color-primary)" }}
            />
            <text x={32} y={35} textAnchor="middle" fontSize="14" fontWeight="bold" fontFamily="inherit" style={{ fill: "var(--color-primary)" }}>
              {completionPct}%
            </text>
          </svg>
          <div>
            <div style={{ fontSize: "1.3rem", fontWeight: 700, color: "var(--color-primary)", fontFamily: "var(--font-display)" }}>
              {totalEarned} / {TOTAL_BADGES} Badges
            </div>
            <div style={{ fontSize: "0.8rem", color: "var(--color-text-dim)", marginTop: "0.2rem" }}>
              {totalEarned === TOTAL_BADGES
                ? "All achievements unlocked!"
                : `${TOTAL_BADGES - totalEarned} more to collect`}
            </div>
          </div>
        </div>
      </section>

      {/* Badge categories */}
      {categories.map((cat) => {
        const badges = ALL_BADGES.filter((b) => b.category === cat);
        const catInfo = CATEGORY_LABELS[cat];
        const earned = badges.filter((b) => earnedSet.has(b.key)).length;

        return (
          <section key={cat} style={{ marginBottom: "2rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
              <h2 style={{ ...sectionHeadingStyle, color: catInfo.color, margin: 0 }}>{catInfo.label}</h2>
              <span style={{ fontSize: "0.75rem", color: "var(--color-text-dim)" }}>{earned}/{badges.length}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {badges.map((badge) => {
                const isEarned = earnedSet.has(badge.key);
                const earnedDate = earnedMap.get(badge.key);
                const current = getProgress(badge);
                const pct = isEarned ? 100 : Math.min(Math.round((current / badge.threshold) * 100), 99);

                return (
                  <div
                    key={badge.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.75rem",
                      padding: "0.75rem 1rem",
                      background: isEarned ? "var(--color-bg-done)" : "var(--color-bg-card)",
                      border: `1px solid ${isEarned ? "var(--color-border-done)" : "var(--color-border)"}`,
                      borderRadius: "var(--radius)",
                      opacity: isEarned ? 1 : 0.75,
                    }}
                  >
                    <div style={{
                      fontSize: "1.6rem",
                      width: 40,
                      height: 40,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: "50%",
                      background: isEarned ? "var(--color-bg-card)" : "var(--color-bg)",
                      filter: isEarned ? "none" : "grayscale(100%)",
                      flexShrink: 0,
                    }}>
                      {badge.icon}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{
                          fontSize: "0.95rem",
                          fontWeight: 600,
                          color: isEarned ? "var(--color-text)" : "var(--color-text-muted)",
                        }}>
                          {badge.label}
                        </span>
                        {isEarned && earnedDate && (
                          <span style={{ fontSize: "0.65rem", color: "var(--color-border-done)" }}>
                            {new Date(earnedDate).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--color-text-dim)", marginTop: "0.15rem" }}>
                        {badge.description}
                      </div>
                      {!isEarned && (
                        <div style={{ marginTop: "0.4rem" }}>
                          <div style={{ height: 4, background: "var(--color-bg-darkest)", borderRadius: 2, overflow: "hidden" }}>
                            <div style={{
                              height: "100%",
                              width: `${pct}%`,
                              background: catInfo.color,
                              borderRadius: 2,
                              transition: "width 0.5s",
                              opacity: 0.7,
                            }} />
                          </div>
                          <div style={{ fontSize: "0.6rem", color: "var(--color-text-dim)", marginTop: "0.15rem", textAlign: "right" }}>
                            {current} / {badge.threshold} {badge.unit}
                          </div>
                        </div>
                      )}
                      {isEarned && (
                        <div style={{ fontSize: "0.7rem", color: "var(--color-success)", marginTop: "0.2rem", fontWeight: 600 }}>
                          Unlocked
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      <div style={{ textAlign: "center", marginTop: "1rem" }}>
        <Link href="/" style={{ color: "var(--color-text-dim)", fontSize: "0.85rem", textDecoration: "none" }}>Back to Dashboard</Link>
      </div>
    </main>
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
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const overviewCardStyle: React.CSSProperties = {
  background: "var(--color-bg-card)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius)",
  boxShadow: "var(--shadow-card)",
  padding: "1.25rem",
  marginBottom: "2rem",
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
