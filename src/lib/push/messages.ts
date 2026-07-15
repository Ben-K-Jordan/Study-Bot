// ── Funny push-notification copy ────────────────────────────────
// Each category is an array of strings.
// For templates with dynamic values, use {placeholder} syntax — the
// caller is responsible for interpolation via `formatMessage()`.

export const STUDY_REMINDERS: string[] = [
  "Your brain cells are filing a missing persons report. Come study.",
  "That textbook isn't going to read itself. We checked.",
  "Netflix will still be there later. Your GPA won't.",
  "Your flashcards miss you. They told us. It was weird.",
  "Remember when you said 'I'll study later'? It's later.",
  "Your neurons are getting cobwebs. Quick study session?",
  "Fun fact: procrastination was invented in 1847. Don't be traditional.",
  "Your future self just called. They're begging you to study.",
  "Plot twist: studying now means less panic later. Revolutionary concept.",
  "Your brain has entered power-saving mode. Only studying can wake it up.",
  "Roses are red, violets are blue, your exam is coming, and it won't study for you.",
  "The WiFi is strong but your study habits are weak. Let's fix that.",
  "Your flashcards are gathering dust. Digital dust. That's somehow worse.",
  "Somewhere, a textbook just whispered your name. Don't leave it on read.",
  "You've scrolled 3 miles on your phone today. Walk 3 feet to your desk instead.",
  "Breaking: local student discovers studying works. More at 11.",
  "Your brain called — it wants to feel useful again.",
];

export const STREAK_WARNINGS: string[] = [
  "Your streak is hanging by a thread. One quick review?",
  "Your {streak}-day streak is screaming internally right now.",
  "Do you hear that? That's the sound of your streak crying.",
  "BREAKING NEWS: Local student's streak in critical condition.",
  "Your {streak}-day streak just asked if you still care.",
  "One quick review stands between you and streak devastation.",
  "Your streak is pacing back and forth. It's worried.",
  "Don't let your {streak}-day streak become a 0-day streak. That's just sad.",
  "Your streak is writing its will. You have minutes to intervene.",
  "Emergency broadcast: your study streak is on life support.",
  "Your {streak}-day streak is refreshing the app, hoping you'll show up.",
];

export const ACHIEVEMENT_UNLOCKED: string[] = [
  "Achievement unlocked! Your brain just leveled up.",
  "New badge! Frame it, put it on the fridge, whatever you do.",
  "You just earned a new achievement. Your neurons are literally applauding.",
  "Ding! New badge unlocked. You're basically a study RPG character now.",
  "Achievement get! Tell your mom — she'll finally be proud. (Kidding, she already is.)",
];

export const WEEKLY_NUDGE: string[] = [
  "New week, new you, same flashcards. Let's go.",
  "Monday called. It said you should study. We agree with Monday for once.",
  "Fresh week energy: convert it to study XP before it expires.",
  "A new week of knowledge awaits. Your brain cleared some cache — time to refill it.",
  "Weekly reminder that your goals won't achieve themselves. We checked the code.",
];

/**
 * Replace `{key}` placeholders in a message with values from `data`.
 *
 * Example:
 *   formatMessage("Your {streak}-day streak is crying.", { streak: "14" })
 *   // => "Your 14-day streak is crying."
 */
export function formatMessage(
  template: string,
  data?: Record<string, string>,
): string {
  if (!data) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => data[key] ?? match);
}

/**
 * Pick a random element from an array.
 */
export function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
