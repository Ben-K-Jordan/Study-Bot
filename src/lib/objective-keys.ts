/**
 * Topic keys. The code calls a topic an objective: the plan generator
 * derives each one's key from its title, and mastery rows, feedback anchors
 * and recommendations are stored under that key. Screens turn a key back
 * into a readable title only when no real title is known.
 *
 * Pure and dependency-free, so client components, server services and the
 * plan generator can all share one copy of each rule.
 */

/**
 * Derive a stable key from a topic title. The same title always yields the
 * same key, so a topic keeps one identity across every session it appears in:
 * "Photosynthesis: Light Reactions!" becomes "photosynthesis_light_reactions".
 */
export function slugifyObjectiveTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60)
    .replace(/_+$/g, "");
  return slug || "objective";
}

/**
 * A readable title for a stored key when no real title is known, in sentence
 * case: "photosynthesis_light_reactions" becomes "Photosynthesis light
 * reactions" and "bigO-notation" becomes "Big O notation". Words written in
 * capitals keep them ("CSS_specificity" becomes "CSS specificity"); a key
 * with no words at all reads "Untitled topic".
 */
export function humanizeObjectiveKey(key: string): string {
  const words = key
    // camelCase and acronym boundaries: "bigONotation" -> "big O Notation"
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => (/^[A-Z][A-Z0-9]*$/.test(word) ? word : word.toLowerCase()));
  if (words.length === 0) return "Untitled topic";
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
