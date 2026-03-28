/**
 * MVP prompt generation for RETRIEVAL mode.
 * Generates prompts from session objectives until target count is reached.
 */

export interface Prompt {
  id: string;
  objective_id?: string;
  text: string;
  difficulty: number;
}

interface Objective {
  id: string;
  title: string;
}

const VARIANTS = [
  (title: string) => `From memory: explain ${title} in 3–5 bullets.`,
  (title: string) => `Define ${title} and give one concrete example.`,
  (title: string) => `List the key steps involved in ${title}.`,
  (title: string) => `What are the most common pitfalls when applying ${title}?`,
  (title: string) => `Outline how you would explain ${title} to a classmate.`,
  (title: string) => `Compare and contrast two aspects of ${title}.`,
] as const;

export function generateRetrievalPrompts(session: {
  objectives?: Objective[] | null;
  target_outcome?: { prompt_count?: number } | null;
  topic_scope: string;
}): Prompt[] {
  const count = session.target_outcome?.prompt_count ?? 10;
  const objectives = session.objectives?.length
    ? session.objectives
    : [{ id: "topic_0", title: session.topic_scope }];

  const prompts: Prompt[] = [];

  for (let i = 0; i < count; i++) {
    const obj = objectives[i % objectives.length];
    const variantFn = VARIANTS[i % VARIANTS.length];
    prompts.push({
      id: `p_${i}`,
      objective_id: obj.id,
      text: variantFn(obj.title),
      difficulty: 1,
    });
  }

  return prompts;
}
