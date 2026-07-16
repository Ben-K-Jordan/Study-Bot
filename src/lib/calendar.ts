import { SessionMode } from "./validation";

export const MODE_LABELS: Record<string, string> = {
  RETRIEVAL: "Retrieval",
  INTERLEAVED_PRACTICE: "Interleaved Practice",
  ERROR_REPAIR: "Error Repair",
  EXAM_SIM: "Exam Sim",
  WORKED_EXAMPLES: "Worked Examples",
};

export function buildCalendarTitle(params: {
  courseName: string;
  examName: string;
  mode: SessionMode;
  topicScope: string;
}): string {
  const modeLabel = MODE_LABELS[params.mode];
  return `${params.courseName} | ${params.examName} | ${modeLabel}: ${params.topicScope}`;
}

interface DescriptionParams {
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

export function buildCalendarDescription(params: DescriptionParams): string {
  const sections: string[] = [];

  // Outcome
  if (params.outcome) {
    const o = params.outcome;
    const items: string[] = [];
    if (o.target_accuracy != null && o.prompt_count != null) {
      items.push(
        `Score >= ${(o.target_accuracy * 100).toFixed(0)}% on ${o.prompt_count} prompts`
      );
    }
    if (o.closed_book_required) {
      items.push("Complete closed-book first pass");
    }
    if (o.deliverables) {
      for (const d of o.deliverables) {
        items.push(d.replace(">=", " >= ").replace("_", " "));
      }
    }
    if (items.length > 0) {
      sections.push(
        "**Outcome (by end):**\n" + items.map((i) => `- [ ] ${i}`).join("\n")
      );
    }
  }

  // Plan
  if (params.planSteps && params.planSteps.length > 0) {
    sections.push(
      "**Plan (how):**\n" + params.planSteps.map((s) => `- ${s}`).join("\n")
    );
  }

  // Rules
  if (params.rules && params.rules.length > 0) {
    sections.push(
      "**Rules:**\n" + params.rules.map((r) => `- ${r}`).join("\n")
    );
  }

  // Breaks
  if (params.breaks) {
    const b = params.breaks;
    const label = b.type === "50_10" ? "50 min work / 10 min break" : b.type;
    sections.push(
      `**Breaks:**\n- ${label}${b.cycles ? `, ${b.cycles} cycle(s)` : ""}`
    );
  }

  // Terminal session link
  sections.push(`**Terminal session:**\n${params.sessionUrl}`);

  // Resources
  if (params.resources && params.resources.length > 0) {
    sections.push(
      "**Resources:**\n" +
        params.resources
          .map(
            (r) =>
              `- ${r.type}: ${r.ref}${r.range ? ` (${r.range})` : ""}`
          )
          .join("\n")
    );
  }

  return sections.join("\n\n");
}
