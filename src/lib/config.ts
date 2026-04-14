/** Shared configuration helpers — single source of truth for env-derived values. */

export function getBaseUrl(): string {
  return process.env.BASE_URL || "http://localhost:3000";
}

/**
 * Sample `maxCount` items from an array using evenly-spaced indices.
 * Returns the original array if it's already small enough.
 */
export function sampleEvenly<T>(items: T[], maxCount: number): T[] {
  if (items.length <= maxCount) return items;
  const step = (items.length - 1) / (maxCount - 1);
  return Array.from({ length: maxCount }, (_, i) => items[Math.round(i * step)]);
}
