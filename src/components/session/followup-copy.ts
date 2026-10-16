import { formatDateWeekday, formatList, plural } from "@/lib/format";
import type { FollowupPreview } from "./types";

/**
 * Fills {name} placeholders in one pass, after plural() has picked the
 * message. Names are filled last because plural() turns every "#" into the
 * count, and an exam can be called "Prelim #2".
 */
export function fillMessage(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

/**
 * Why some follow-up days aren't offered: they fall after the exam. One
 * whole message per plural form (VOICE.md section 4).
 */
export function skippedText(
  preview: Pick<FollowupPreview, "exam_name" | "items" | "skipped">,
  timeZone: string | undefined,
): string {
  const values = {
    exam: preview.exam_name ?? "your exam",
    dates: formatList(preview.skipped.map((item) => formatDateWeekday(item.at, { timeZone }))),
  };
  const count = preview.skipped.length;
  const message =
    preview.items.length === 0
      ? plural(count, {
          one: "The follow-up date falls after {exam}, so there's nothing to add.",
          other: "The follow-up dates fall after {exam}, so there's nothing to add.",
        })
      : plural(count, {
          one: "{dates} falls after {exam}, so it isn't added.",
          other: "{dates} fall after {exam}, so they aren't added.",
        });
  return fillMessage(message, values);
}
