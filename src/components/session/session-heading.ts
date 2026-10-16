import { formatTopicList } from "@/lib/format";

/** Topics a session heading names before it counts the rest ("and 2 more"). */
export const HEADING_TOPICS = 3;

/**
 * Follow-up sessions used to store "Follow-up: " in front of their topic
 * scope. The marker now lives in the session's resources, so older rows read
 * like new ones: only the topics.
 */
const LEGACY_FOLLOWUP_PREFIX = /^(?:follow-up:\s*)+/i;

/** "Recursion, Stacks, and Big-O", capped like every topic list (formatTopicList). */
export function topicListText(topics: readonly string[], max: number = HEADING_TOPICS): string {
  return formatTopicList(topics, max);
}

export interface SessionHeading {
  /** "Retrieval: CSS specificity and The box model", one string for one element. */
  text: string;
  /** The heading names every topic, so a list of topics under it would repeat it. */
  namesAllTopics: boolean;
}

/**
 * The heading of a session's intro and results: "{mode}: {topics}". Plans
 * store the topic scope as the topic titles joined with ", ", so that form is
 * rebuilt as an Intl list from the same titles the Topics row and Home use.
 * Any other scope ("Unresolved errors", "Recursion and stacks", a list the
 * server already wrote) is the student's or the server's wording and stays as
 * stored.
 */
export function sessionHeading(modeLabel: string, topicScope: string, topics: readonly string[]): SessionHeading {
  const scope = topicScope.trim().replace(LEGACY_FOLLOWUP_PREFIX, "");
  const titles = topics.map((topic) => topic.trim()).filter(Boolean);
  if (titles.length > 0 && scope === titles.join(", ")) {
    return {
      text: `${modeLabel}: ${topicListText(titles)}`,
      namesAllTopics: titles.length <= HEADING_TOPICS + 1,
    };
  }
  return { text: scope ? `${modeLabel}: ${scope}` : modeLabel, namesAllTopics: false };
}

/** A session's topic titles from its stored objectives. */
export function objectiveTitles(objectives: readonly { title?: string | null }[] | null | undefined): string[] {
  return (objectives ?? []).map((o) => (typeof o?.title === "string" ? o.title.trim() : "")).filter(Boolean);
}
