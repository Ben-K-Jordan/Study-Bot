/**
 * Shared badge definitions for achievements.
 * Single source of truth — imported by both server and client code.
 */

export interface BadgeDefinition {
  key: string;
  label: string;
  icon: string;
  description: string;
  category: "streak" | "review" | "xp";
  threshold: number;
  unit: string;
}

export const ALL_BADGES: BadgeDefinition[] = [
  // Streak badges
  { key: "STREAK_3",   label: "Getting Started",  icon: "\u{1F525}", description: "3-day study streak",              category: "streak", threshold: 3,   unit: "days" },
  { key: "STREAK_7",   label: "Week Warrior",      icon: "\u26A1",    description: "7-day study streak",              category: "streak", threshold: 7,   unit: "days" },
  { key: "STREAK_14",  label: "Two-Week Titan",    icon: "\u{1F4AA}", description: "14-day study streak",             category: "streak", threshold: 14,  unit: "days" },
  { key: "STREAK_30",  label: "Monthly Master",    icon: "\u{1F3C6}", description: "30-day study streak",             category: "streak", threshold: 30,  unit: "days" },
  { key: "STREAK_60",  label: "Dedicated Scholar", icon: "\u{1F393}", description: "60-day study streak",             category: "streak", threshold: 60,  unit: "days" },
  { key: "STREAK_100", label: "Century Club",      icon: "\u{1F48E}", description: "100-day study streak",            category: "streak", threshold: 100, unit: "days" },
  // Review badges
  { key: "FIRST_REVIEW",  label: "First Steps",       icon: "\u{1F4D6}", description: "Review your first flashcard",      category: "review", threshold: 1,   unit: "reviews" },
  { key: "REVIEWS_100",   label: "Card Shark",         icon: "\u{1F0CF}", description: "Review 100 flashcards",            category: "review", threshold: 100, unit: "reviews" },
  { key: "REVIEWS_500",   label: "Flashcard Fiend",    icon: "\u{1F9E0}", description: "Review 500 flashcards",            category: "review", threshold: 500, unit: "reviews" },
  { key: "FIRST_PERFECT", label: "Perfect Score",      icon: "\u2B50",    description: "Complete a deck with all correct", category: "review", threshold: 1,   unit: "perfect decks" },
  // XP badges
  { key: "XP_100",  label: "XP Centurion", icon: "\u{1F4AF}", description: "Earn 100 total XP",   category: "xp", threshold: 100,  unit: "XP" },
  { key: "XP_1000", label: "XP Master",    icon: "\u{1F31F}", description: "Earn 1,000 total XP", category: "xp", threshold: 1000, unit: "XP" },
];

/** Map from badge key to definition for O(1) lookup */
export const BADGE_MAP: Record<string, BadgeDefinition> = Object.fromEntries(
  ALL_BADGES.map((b) => [b.key, b]),
);

export const BADGE_KEYS = ALL_BADGES.map((b) => b.key);
export const TOTAL_BADGES = ALL_BADGES.length;

export const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  streak: { label: "Streak Milestones", color: "#e8a040" },
  review: { label: "Flashcard Mastery", color: "#7ec8e3" },
  xp:     { label: "XP Milestones",     color: "#c4a0ff" },
};
