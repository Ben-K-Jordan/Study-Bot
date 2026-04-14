"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { getOrCreateUserId } from "@/lib/client-utils";

interface GameState {
  xpToday: number;
  xpTotal: number;
  dailyXpGoal: number;
  streak: number;
  streakFreezes: number;
  achievements: { badgeType: string; earnedAt: string }[];
  newAchievements: string[];
}

// All badge definitions with categories
const ALL_BADGES: {
  key: string;
  label: string;
  icon: string;
  description: string;
  category: "streak" | "review" | "xp";
  threshold: number;
  unit: string;
}[] = [
  // Streak badges
  { key: "STREAK_3",   label: "Getting Started",  icon: "\u{1F525}", description: "Achieve a 3-day study streak",    category: "streak", threshold: 3,   unit: "days" },
  { key: "STREAK_7",   label: "Week Warrior",      icon: "\u26A1",    description: "Achieve a 7-day study streak",    category: "streak", threshold: 7,   unit: "days" },
  { key: "STREAK_14",  label: "Two-Week Titan",    icon: "\u{1F4AA}", description: "Achieve a 14-day study streak",   category: "streak", threshold: 14,  unit: "days" },
  { key: "STREAK_30",  label: "Monthly Master",    icon: "\u{1F3C6}", description: "Achieve a 30-day study streak",   category: "streak", threshold: 30,  unit: "days" },
  { key: "STREAK_60",  label: "Dedicated Scholar", icon: "\u{1F393}", description: "Achieve a 60-day study streak",   category: "streak", threshold: 60,  unit: "days" },
  { key: "STREAK_100", label: "Century Club",      icon: "\u{1F48E}", description: "Achieve a 100-day study streak",  category: "streak", threshold: 100, unit: "days" },
  // Review badges
  { key: "FIRST_REVIEW",  label: "First Steps",       icon: "\u{1F4D6}", description: "Review your first flashcard",      category: "review", threshold: 1,   unit: "reviews" },
  { key: "REVIEWS_100",   label: "Card Shark",         icon: "\u{1F0CF}", description: "Review 100 flashcards",            category: "review", threshold: 100, unit: "reviews" },
  { key: "REVIEWS_500",   label: "Flashcard Fiend",    icon: "\u{1F9E0}", description: "Review 500 flashcards",            category: "review", threshold: 500, unit: "reviews" },
  { key: "FIRST_PERFECT", label: "Perfect Score",      icon: "\u2B50",    description: "Complete a deck with all correct", category: "review", threshold: 1,   unit: "perfect decks" },
  // XP badges
  { key: "XP_100",  label: "XP Centurion", icon: "\u{1F4AF}", description: "Earn 100 total XP",   category: "xp", threshold: 100,  unit: "XP" },
  { key: "XP_1000", label: "XP Master",    icon: "\u{1F31F}", description: "Earn 1,000 total XP", category: "xp", threshold: 1000, unit: "XP" },
];

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  streak: { label: "Streak Milestones", color: "#e8a040" },
  review: { label: "Flashcard Mastery", color: "#7ec8e3" },
  xp:     { label: "XP Milestones",     color: "#c4a0ff" },
};

export default function AchievementsPage() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewCount, setReviewCount] = useState(0);

  useEffect(() => {
    const userId = getOrCreateUserId();
    Promise.all([
      fetch("/api/stats/game", { headers: { "X-User-Id": userId } }).then((r) => r.json()),
      fetch("/api/flashcards", { headers: { "X-User-Id": userId } }).then((r) => r.json()).catch(() => ({ decks: [] })),
    ])
      .then(([state]) => {
        setGameState(state);
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    // Estimate review count from XP (2 XP per review)
    // This is approximate — real count would need a dedicated endpoint
  }, []);

  if (loading) {
    return (
      <main style={mainStyle}>
        <style>{`@keyframes dash-spin { to { transform: rotate(360deg); } }`}</style>
        <h1 style={headingStyle}>Achievements</h1>
        <div style={{ textAlign: "center", padding: "4rem 0", color: "#a89a82" }}>
          <div style={spinnerStyle} />
          <p style={{ marginTop: "1rem" }}>Loading achievements...</p>
        </div>
      </main>
    );
  }

  const earnedSet = new Set(gameState?.achievements.map((a) => a.badgeType) || []);
  const earnedMap = new Map(gameState?.achievements.map((a) => [a.badgeType, a.earnedAt]) || []);
  const totalEarned = earnedSet.size;
  const totalBadges = ALL_BADGES.length;
  const completionPct = Math.round((totalEarned / totalBadges) * 100);

  // Compute progress values for each badge
  function getProgress(badge: typeof ALL_BADGES[0]): number {
    if (earnedSet.has(badge.key)) return badge.threshold;
    if (badge.category === "streak") return gameState?.streak || 0;
    if (badge.category === "xp") return gameState?.xpTotal || 0;
    if (badge.key === "FIRST_REVIEW" || badge.key === "REVIEWS_100" || badge.key === "REVIEWS_500") {
      return reviewCount;
    }
    return 0;
  }

  const categories = ["streak", "review", "xp"] as const;

  return (
    <main style={mainStyle}>
      <h1 style={headingStyle}>Achievements</h1>

      {/* Overall progress */}
      <section style={overviewCardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div style={progressRingContainerStyle}>
            <svg width={64} height={64} viewBox="0 0 64 64">
              <circle cx={32} cy={32} r={26} fill="none" stroke="#1f2e1f" strokeWidth={5} />
              <circle
                cx={32} cy={32} r={26}
                fill="none"
                stroke="#f0dc4e"
                strokeWidth={5}
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 26}
                strokeDashoffset={2 * Math.PI * 26 * (1 - completionPct / 100)}
                transform="rotate(-90 32 32)"
                style={{ transition: "stroke-dashoffset 0.5s" }}
              />
              <text x={32} y={35} textAnchor="middle" fill="#f0dc4e" fontSize="14" fontWeight="bold" fontFamily="inherit">
                {completionPct}%
              </text>
            </svg>
          </div>
          <div>
            <div style={{ fontSize: "1.3rem", fontWeight: 700, color: "#f0dc4e", fontFamily: "var(--font-display), 'Caveat', cursive" }}>
              {totalEarned} / {totalBadges} Badges
            </div>
            <div style={{ fontSize: "0.8rem", color: "#7a7060", marginTop: "0.2rem" }}>
              {totalEarned === totalBadges
                ? "All achievements unlocked!"
                : `${totalBadges - totalEarned} more to collect`}
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
              <span style={{ fontSize: "0.75rem", color: "#7a7060" }}>{earned}/{badges.length}</span>
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
                      background: isEarned ? "#2d4a2d" : "#334d33",
                      border: `1px solid ${isEarned ? "#5a8a5a" : "#4a6a4a"}`,
                      borderRadius: 8,
                      opacity: isEarned ? 1 : 0.75,
                    }}
                  >
                    {/* Icon */}
                    <div style={{
                      fontSize: "1.6rem",
                      width: 40,
                      height: 40,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: "50%",
                      background: isEarned ? "#334d33" : "#2a3d2a",
                      filter: isEarned ? "none" : "grayscale(100%)",
                      flexShrink: 0,
                    }}>
                      {badge.icon}
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{
                          fontSize: "0.95rem",
                          fontWeight: 600,
                          color: isEarned ? "#e8dcc8" : "#a89a82",
                        }}>
                          {badge.label}
                        </span>
                        {isEarned && earnedDate && (
                          <span style={{ fontSize: "0.65rem", color: "#5a8a5a" }}>
                            {new Date(earnedDate).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "#7a7060", marginTop: "0.15rem" }}>
                        {badge.description}
                      </div>
                      {/* Progress bar */}
                      {!isEarned && (
                        <div style={{ marginTop: "0.4rem" }}>
                          <div style={{ height: 4, background: "#1f2e1f", borderRadius: 2, overflow: "hidden" }}>
                            <div style={{
                              height: "100%",
                              width: `${pct}%`,
                              background: catInfo.color,
                              borderRadius: 2,
                              transition: "width 0.5s",
                              opacity: 0.7,
                            }} />
                          </div>
                          <div style={{ fontSize: "0.6rem", color: "#7a7060", marginTop: "0.15rem", textAlign: "right" }}>
                            {current} / {badge.threshold} {badge.unit}
                          </div>
                        </div>
                      )}
                      {isEarned && (
                        <div style={{ fontSize: "0.7rem", color: "#88cc88", marginTop: "0.2rem", fontWeight: 600 }}>
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
        <Link href="/" style={backLinkStyle}>Back to Dashboard</Link>
      </div>
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
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const overviewCardStyle: React.CSSProperties = {
  background: "#334d33",
  border: "1px solid #4a6a4a",
  borderRadius: 8,
  padding: "1.25rem",
  marginBottom: "2rem",
};

const progressRingContainerStyle: React.CSSProperties = {
  flexShrink: 0,
};

const backLinkStyle: React.CSSProperties = {
  color: "#7a7060",
  fontSize: "0.85rem",
  textDecoration: "none",
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
