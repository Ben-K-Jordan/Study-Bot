/**
 * Event titles and descriptions for a study session in a calendar: the .ics
 * export, "Add to Google Calendar" links and published Google events all use
 * these, so a session reads the same everywhere.
 *
 * Descriptions are plain text. Apple Calendar and Outlook show Markdown
 * (`**`, `- [ ]`) literally, so there is none here.
 */
import { getBreakConfig } from "./breaks";
import { formatDuration, formatList, formatPercent, plural } from "./format";
import { MODE_LABELS } from "./modes";
import { SessionMode } from "./validation";

export { MODE_LABELS };

/** Topics named in a description before the rest are counted ("and 3 more"). */
const MAX_TOPICS = 6;

/**
 * A session's topic titles: its objectives ({ title } objects or strings),
 * else its comma-separated topic scope.
 */
export function sessionTopics(objectives: unknown, topicScope = ""): string[] {
  if (Array.isArray(objectives)) {
    const titles = objectives
      .map((o) =>
        typeof o === "string"
          ? o
          : o && typeof o === "object" && "title" in o
            ? String((o as { title: unknown }).title ?? "")
            : "",
      )
      .map((t) => t.trim())
      .filter(Boolean);
    if (titles.length > 0) return titles;
  }
  return topicScope
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** "Recursion, Stacks, and Big-O", or the first few and "and 3 more". */
function topicText(topics: readonly string[]): string {
  if (topics.length <= MAX_TOPICS) return formatList(topics);
  const rest = topics.length - MAX_TOPICS;
  return formatList([...topics.slice(0, MAX_TOPICS), plural(rest, { one: "# more", other: "# more" })]);
}

function modeName(mode: string | undefined): string | null {
  return mode ? (MODE_LABELS[mode] ?? null) : null;
}

/** "Retrieval: Recursion and Stacks · CS 2110 Prelim 1" */
export function buildCalendarTitle(params: {
  courseName: string;
  examName: string;
  mode: SessionMode | string;
  topicScope: string;
}): string {
  const mode = modeName(params.mode) ?? "Study session";
  const topics = sessionTopics(null, params.topicScope);
  const what = topics.length > 0 ? `${mode}: ${formatList(topics)}` : mode;
  const where = [params.courseName, params.examName].map((s) => s.trim()).filter(Boolean).join(" ");
  return where ? `${what} · ${where}` : what;
}

export interface CalendarDescriptionParams {
  courseName?: string;
  examName?: string;
  mode?: string;
  /** Topic titles, or a session's objectives as stored ({ title } objects). */
  topics?: unknown;
  /** Used for the topics when `topics` is empty. */
  topicScope?: string;
  outcome?: {
    type?: string;
    prompt_count?: number;
    target_accuracy?: number;
    closed_book_required?: boolean;
    deliverables?: string[];
  } | null;
  planSteps?: string[];
  rules?: string[];
  breaks?: { type?: string; cycles?: number } | null;
  sessionUrl: string;
  resources?: { type: string; ref: string; range?: string }[] | null;
}

/** "error_log_entries>=5" as "Error log entries: at least 5". */
function deliverableText(raw: string): string {
  const match = /^(.*?)\s*>=\s*(\d+)\s*$/.exec(raw);
  const name = (match ? match[1] : raw).replace(/_/g, " ").trim();
  const label = name.charAt(0).toUpperCase() + name.slice(1);
  return match ? `${label}: at least ${match[2]}.` : `${label}.`;
}

/** "2 blocks of 25 min, with a 5 min break in between." Null for a single block (no break). */
export function breaksText(breaks: { type?: string; cycles?: number } | null | undefined): string | null {
  const cycles = breaks?.cycles ?? 1;
  if (!breaks || cycles <= 1) return null;
  const { workMinutes, breakMinutes } = getBreakConfig(breaks.type ?? "");
  const work = formatDuration(workMinutes);
  const pause = formatDuration(breakMinutes);
  return cycles === 2
    ? `2 blocks of ${work}, with a ${pause} break in between.`
    : `${plural(cycles, { one: "# block", other: "# blocks" })} of ${work}, with a ${pause} break between blocks.`;
}

/**
 * The event description, for example:
 *
 *   Retrieval session for CS 2110 Prelim 1
 *   Topics: Recursion and Stacks
 *   8 questions. Target accuracy: 80%. Answer from memory before you open your notes.
 *
 *   Open the session: https://…/s/abc
 *
 *   Added by Study Bot
 */
export function buildCalendarDescription(params: CalendarDescriptionParams): string {
  const sections: string[] = [];

  const summary: string[] = [];
  const mode = modeName(params.mode);
  const where = [params.courseName, params.examName]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(" ");
  if (mode) summary.push(where ? `${mode} session for ${where}` : `${mode} session`);

  const topics = sessionTopics(params.topics, params.topicScope);
  if (topics.length > 0) summary.push(`Topics: ${topicText(topics)}`);

  const o = params.outcome;
  if (o) {
    const parts: string[] = [];
    if (o.prompt_count) parts.push(plural(o.prompt_count, { one: "# question.", other: "# questions." }));
    if (o.target_accuracy != null) parts.push(`Target accuracy: ${formatPercent(o.target_accuracy)}.`);
    if (o.closed_book_required) parts.push("Answer from memory before you open your notes.");
    for (const d of o.deliverables ?? []) parts.push(deliverableText(d));
    if (parts.length > 0) summary.push(parts.join(" "));
  }

  const breaks = breaksText(params.breaks);
  if (breaks) summary.push(breaks);
  if (summary.length > 0) sections.push(summary.join("\n"));

  if (params.planSteps && params.planSteps.length > 0) {
    sections.push(["Steps", ...params.planSteps.map((s) => `- ${s}`)].join("\n"));
  }
  if (params.rules && params.rules.length > 0) {
    sections.push(["Rules", ...params.rules.map((r) => `- ${r}`)].join("\n"));
  }
  if (params.resources && params.resources.length > 0) {
    sections.push(
      [
        "Materials",
        ...params.resources.map((r) => `- ${r.type}: ${r.ref}${r.range ? ` (${r.range})` : ""}`),
      ].join("\n"),
    );
  }

  sections.push(`Open the session: ${params.sessionUrl}`);
  sections.push("Added by Study Bot");

  return sections.join("\n\n");
}
