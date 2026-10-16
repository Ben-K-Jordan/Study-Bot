import { formatDateWeekday, formatList, plural } from "@/lib/format";
import type { FollowupPreview } from "@/lib/session-types";

/**
 * Fills {name} placeholders in one pass, after plural() has picked the
 * message. Names are filled last because plural() turns every "#" into the
 * count, and an exam can be called "Prelim #2".
 */
export function fillMessage(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

/**
 * Why some follow-up days aren't offered: they fall after the exam, or the
 * day has already passed (the results were opened late). One whole message
 * per plural form (VOICE.md section 4), one sentence per reason.
 */
export function skippedText(
  preview: Pick<FollowupPreview, "exam_name" | "items" | "skipped">,
  timeZone: string | undefined,
): string {
  const passed = preview.skipped.filter((item) => item.reason === "past");
  const afterExam = preview.skipped.filter((item) => item.reason !== "past");
  // "Nothing to add" only when one reason covers every recommended day.
  const nothingLeft = (others: number) => preview.items.length === 0 && others === 0;
  const dates = (items: FollowupPreview["skipped"]) =>
    formatList(items.map((item) => formatDateWeekday(item.at, { timeZone })));
  const sentences: string[] = [];

  if (afterExam.length > 0) {
    const message = nothingLeft(passed.length)
      ? plural(afterExam.length, {
          one: "The follow-up date falls after {exam}, so there's nothing to add.",
          other: "The follow-up dates fall after {exam}, so there's nothing to add.",
        })
      : plural(afterExam.length, {
          one: "{dates} falls after {exam}, so it isn't added.",
          other: "{dates} fall after {exam}, so they aren't added.",
        });
    sentences.push(fillMessage(message, { exam: preview.exam_name ?? "your exam", dates: dates(afterExam) }));
  }

  if (passed.length > 0) {
    const message = nothingLeft(afterExam.length)
      ? plural(passed.length, {
          one: "The follow-up date has passed, so there's nothing to add.",
          other: "The follow-up dates have passed, so there's nothing to add.",
        })
      : plural(passed.length, {
          one: "{dates} has passed, so it isn't added.",
          other: "{dates} have passed, so they aren't added.",
        });
    sentences.push(fillMessage(message, { dates: dates(passed) }));
  }

  return sentences.join(" ");
}
