/**
 * Achievement definitions, shared by the server (awarding) and the Progress
 * screen (display). The keys are stored in the database as `badgeType`, so
 * they never change; labels and descriptions are safe to edit.
 *
 * Icons are not data: the Progress screen maps each key to a lucide icon.
 */

/** What an achievement measures. */
export type BadgeMetric = "streak" | "reviews" | "perfectDecks" | "xp";

export type BadgeCategory = "streak" | "review" | "xp";

export interface BadgeDefinition {
  key: string;
  /** Sentence case, plain: "7-day streak". */
  label: string;
  /** One sentence with a period: "Study 7 days in a row." */
  description: string;
  category: BadgeCategory;
  metric: BadgeMetric;
  threshold: number;
  /**
   * The unit of the threshold as whole plural messages, "#" being the count:
   * { one: "# day", other: "# days" }.
   */
  unit: { one: string; other: string };
}

const DAYS = { one: "# day", other: "# days" };
const REVIEWS = { one: "# card review", other: "# card reviews" };
const XP = { one: "# XP", other: "# XP" };

export const ALL_BADGES: BadgeDefinition[] = [
  // Streaks
  { key: "STREAK_3", label: "3-day streak", description: "Study 3 days in a row.", category: "streak", metric: "streak", threshold: 3, unit: DAYS },
  { key: "STREAK_7", label: "7-day streak", description: "Study 7 days in a row.", category: "streak", metric: "streak", threshold: 7, unit: DAYS },
  { key: "STREAK_14", label: "14-day streak", description: "Study 14 days in a row.", category: "streak", metric: "streak", threshold: 14, unit: DAYS },
  { key: "STREAK_30", label: "30-day streak", description: "Study 30 days in a row.", category: "streak", metric: "streak", threshold: 30, unit: DAYS },
  { key: "STREAK_60", label: "60-day streak", description: "Study 60 days in a row.", category: "streak", metric: "streak", threshold: 60, unit: DAYS },
  { key: "STREAK_100", label: "100-day streak", description: "Study 100 days in a row.", category: "streak", metric: "streak", threshold: 100, unit: DAYS },
  // Flashcards
  { key: "FIRST_REVIEW", label: "First card review", description: "Review your first flashcard.", category: "review", metric: "reviews", threshold: 1, unit: REVIEWS },
  { key: "REVIEWS_100", label: "100 card reviews", description: "Review 100 flashcards.", category: "review", metric: "reviews", threshold: 100, unit: REVIEWS },
  { key: "REVIEWS_500", label: "500 card reviews", description: "Review 500 flashcards.", category: "review", metric: "reviews", threshold: 500, unit: REVIEWS },
  {
    key: "FIRST_PERFECT",
    label: "Perfect deck",
    description: "Review every card in a deck on one day without rating any card Again.",
    category: "review",
    metric: "perfectDecks",
    threshold: 1,
    unit: { one: "# perfect deck", other: "# perfect decks" },
  },
  // XP
  { key: "XP_100", label: "100 XP", description: "Earn 100 XP.", category: "xp", metric: "xp", threshold: 100, unit: XP },
  { key: "XP_1000", label: "1,000 XP", description: "Earn 1,000 XP.", category: "xp", metric: "xp", threshold: 1000, unit: XP },
];

/** Map from badge key to definition for O(1) lookup */
export const BADGE_MAP: Record<string, BadgeDefinition> = Object.fromEntries(
  ALL_BADGES.map((b) => [b.key, b]),
);

export const TOTAL_BADGES = ALL_BADGES.length;

/** Category order and headings on the Progress screen. */
export const BADGE_CATEGORIES: readonly { key: BadgeCategory; label: string }[] = [
  { key: "streak", label: "Streaks" },
  { key: "review", label: "Flashcards" },
  { key: "xp", label: "XP" },
];

/** @deprecated Use BADGE_CATEGORIES. Kept for older imports. */
export const CATEGORY_LABELS: Record<string, { label: string }> = Object.fromEntries(
  BADGE_CATEGORIES.map((c) => [c.key, { label: c.label }]),
);

/** The values each metric is measured against. */
export type BadgeProgressValues = Record<BadgeMetric, number>;

/** How far along a badge is, from the student's current values. */
export function badgeProgress(badge: BadgeDefinition, values: BadgeProgressValues): number {
  return values[badge.metric] ?? 0;
}

/** Badges whose threshold the values reach, skipping the ones already earned. */
export function badgesReached(
  values: BadgeProgressValues,
  earned: ReadonlySet<string>,
): string[] {
  return ALL_BADGES.filter(
    (badge) => !earned.has(badge.key) && badgeProgress(badge, values) >= badge.threshold,
  ).map((badge) => badge.key);
}
