/**
 * Versioned prompt templates for AI tasks.
 *
 * Each task has a system prompt, user prompt builder, and version string.
 * Bump version when changing prompts to invalidate cache entries.
 */
import { AiTask } from "./types";

export interface PromptTemplate {
  task: AiTask;
  version: string;
  systemPrompt: string;
  buildUserPrompt: (input: unknown) => string;
}

interface AnswerInput {
  question: string;
  chunks: { chunk_id: string; title: string; page?: number; text: string }[];
  verbosity: "SHORT" | "MEDIUM" | "LONG";
}

interface VariantInput {
  originalQuestion: string;
  errorType: string;
  correctionRule: string;
}

interface ErrorTypeInput {
  question: string;
  userAnswer: string;
  correctConcept: string;
}

interface GeneratePromptsInput {
  mode: string;
  objectives: { id: string; title: string }[];
  topicScope: string;
  promptCount: number;
  contentChunks: { doc_title: string; page_number: number | null; text: string }[];
  courseName: string;
  examName?: string;
}

interface ExtractObjectivesInput {
  chunkTexts: string[];
  courseName: string;
  examName?: string;
}

interface PlanGeneratorInput {
  objectives: string[];
  numDays: number;
  dailyCapMinutes: number;
  availabilityByDay: { dayIndex: number; windowMinutes: number }[];
  researchContext: string;
  examDate: string;
  preferences?: {
    chronotype: "morning" | "evening" | "flexible";
    preferredSessionMinutes: number;
    studyStyle: "intensive" | "balanced" | "relaxed";
  };
  contentContext?: string;
}

const maxWordsByVerbosity = { SHORT: 80, MEDIUM: 200, LONG: 500 };

export const PROMPTS: Record<string, PromptTemplate> = {
  [AiTask.ANSWER_WITH_CITATIONS]: {
    task: AiTask.ANSWER_WITH_CITATIONS,
    version: "v1",
    systemPrompt: `You are a study assistant. Task: ANSWER_WITH_CITATIONS.
Given a student's question and supporting course material excerpts, provide a clear, accurate answer.
Rules:
- Cite specific chunks by chunk_id.
- Do not fabricate information not in the excerpts.
- Match the requested verbosity level.
- Output valid JSON: { "answer_markdown": string, "citations": [{ "chunk_id": string, "reason": string, "quote_snippet": string }] }`,
    buildUserPrompt: (input: unknown) => {
      const { question, chunks, verbosity } = input as AnswerInput;
      const maxWords = maxWordsByVerbosity[verbosity] || 200;
      const context = chunks
        .map((c, i) => `[${i + 1}] (chunk_id: ${c.chunk_id}) ${c.title}${c.page ? ` p.${c.page}` : ""}\n${c.text.slice(0, 800)}`)
        .join("\n\n");
      return `Question: ${question}\n\nMax words: ${maxWords}\nVerbosity: ${verbosity}\n\nSupporting materials:\n${context}`;
    },
  },

  [AiTask.GENERATE_VARIANT_QUESTION]: {
    task: AiTask.GENERATE_VARIANT_QUESTION,
    version: "v1",
    systemPrompt: `You are a study assistant. Task: GENERATE_VARIANT.
Given an original question that a student got wrong, generate a variant question testing the same concept differently.
Output valid JSON: { "variant_question": string }`,
    buildUserPrompt: (input: unknown) => {
      const { originalQuestion, errorType, correctionRule } = input as VariantInput;
      return `Original question: ${originalQuestion}\nError type: ${errorType}\nCorrection: ${correctionRule}\n\nGenerate a variant question.`;
    },
  },

  [AiTask.SUGGEST_ERROR_TYPE]: {
    task: AiTask.SUGGEST_ERROR_TYPE,
    version: "v1",
    systemPrompt: `You are a study assistant. Task: SUGGEST_ERROR_TYPE.
Classify the student's error into one of: MISCONCEPTION, PROCEDURE, CARELESS, MEMORY, UNKNOWN.
Output valid JSON: { "error_type": string, "confidence": number }`,
    buildUserPrompt: (input: unknown) => {
      const { question, userAnswer, correctConcept } = input as ErrorTypeInput;
      return `Question: ${question}\nStudent answer: ${userAnswer}\nCorrect concept: ${correctConcept}`;
    },
  },

  [AiTask.GENERATE_STUDY_PLAN]: {
    task: AiTask.GENERATE_STUDY_PLAN,
    version: "v2",
    systemPrompt: `You are an expert study planner grounded in learning science research. Task: GENERATE_STUDY_PLAN.

Design an optimal study schedule using ONLY these session modes:
- RETRIEVAL: Active recall, closed-book testing on specific topics
- INTERLEAVED_PRACTICE: Mixed practice across multiple topics
- ERROR_REPAIR: Review and correct mistakes from previous sessions
- EXAM_SIM: Full exam simulation under test conditions
- WORKED_EXAMPLES: Step-through examples with self-explanation

Rules:
1. Apply the research evidence provided to determine session types, ordering, spacing, and duration.
2. Start with a DIAGNOSTIC retrieval session (day 0) to prime learning.
3. Space retrieval sessions on the same topic at least 1 day apart.
4. Include INTERLEAVED_PRACTICE after students have done at least 1 retrieval per topic.
5. Schedule EXAM_SIM in the final 20-30% of the study period.
6. Follow ERROR_REPAIR immediately after RETRIEVAL or EXAM_SIM sessions.
7. Cap individual sessions at 50-60 min for intense modes (RETRIEVAL, EXAM_SIM), 90 min for lighter modes.
8. Never exceed the daily study cap or available window for any day.
9. Every objective must appear in at least 2 RETRIEVAL sessions across different days.
10. Distribute objectives evenly — don't over-index on early objectives.

Output valid JSON:
{
  "blocks": [
    {
      "dayIndex": number,
      "mode": "RETRIEVAL" | "INTERLEAVED_PRACTICE" | "ERROR_REPAIR" | "EXAM_SIM" | "WORKED_EXAMPLES",
      "objectives": string[],
      "plannedMinutes": number,
      "outcomeType": string | null,
      "targetAccuracy": number,
      "closedBookRequired": boolean
    }
  ],
  "reasoning": string
}`,
    buildUserPrompt: (input: unknown) => {
      const { objectives, numDays, dailyCapMinutes, availabilityByDay, researchContext, examDate, preferences, contentContext } =
        input as PlanGeneratorInput;
      const availStr = availabilityByDay
        .map((d) => `Day ${d.dayIndex}: ${d.windowMinutes} min available`)
        .join("\n");

      let prefsStr = "";
      if (preferences) {
        const lines: string[] = [];
        lines.push(`Chronotype: ${preferences.chronotype} — schedule harder sessions (RETRIEVAL, EXAM_SIM) ${preferences.chronotype === "morning" ? "earlier" : preferences.chronotype === "evening" ? "later" : "at any time"} in the day.`);
        lines.push(`Preferred session length: ${preferences.preferredSessionMinutes} minutes — target this duration for each session when possible.`);
        lines.push(`Study style: ${preferences.studyStyle} — ${preferences.studyStyle === "intensive" ? "pack sessions densely, maximize daily study time" : preferences.studyStyle === "relaxed" ? "spread sessions out, allow generous breaks, fewer sessions per day" : "balance study load evenly across available days"}.`);
        prefsStr = `\nStudent preferences:\n${lines.join("\n")}\n`;
      }

      let contentStr = "";
      if (contentContext) {
        contentStr = `\nUploaded course material context:\n${contentContext}\nUse this context to inform topic difficulty and time allocation.\n`;
      }

      return `Objectives (${objectives.length} total):\n${objectives.map((o, i) => `${i + 1}. ${o}`).join("\n")}

Study period: ${numDays} days, exam on ${examDate}
Daily study cap: ${dailyCapMinutes} minutes
Availability per day:
${availStr}
${prefsStr}${contentStr}
${researchContext}

Design the optimal study schedule.`;
    },
  },

  [AiTask.GENERATE_PROMPTS]: {
    task: AiTask.GENERATE_PROMPTS,
    version: "v2",
    systemPrompt: `You are an expert professor creating study questions directly from course materials. Task: GENERATE_PROMPTS.

You generate questions grounded in learning science research on retrieval practice and the testing effect. Your questions are designed to maximize long-term retention, not just assess knowledge.

EVIDENCE-BASED QUESTION DESIGN PRINCIPLES (from Roediger & Karpicke 2006, Adesope et al. 2017, Karpicke 2025):

1. RETRIEVAL EFFORT: Questions should require effortful recall, not recognition. Free-recall and short-answer formats produce stronger learning effects (d=0.48-0.80) than simple recognition. Ask students to PRODUCE answers from memory, not choose from options.

2. TRANSFER-APPROPRIATE PROCESSING: Match question format to how knowledge will be assessed on the exam. If the exam uses problem-solving, ask problem-solving questions. If it uses essay-style, ask for explanations.

3. MIXED FORMAT: Use a mix of question types within a session (effect size g=0.80 for mixed vs g=0.48 for single format). Combine recall, application, comparison, and analysis questions.

4. DESIRABLE DIFFICULTY: Questions should be challenging but achievable. Retrieval that requires effort produces stronger memory traces. Include questions that force the student to connect ideas across different parts of the material.

5. ELABORATIVE RETRIEVAL: Ask questions that require students to generate explanations, connections, and inferences beyond surface facts. "Why" and "how" questions produce deeper encoding than "what" questions.

6. SUCCESSIVE RELEARNING: Reference specific content from the materials so students can verify and correct their answers. This supports the test-restudy cycle that maximizes retention.

7. CONTEXT REINSTATEMENT: Questions that evoke the original learning context (referencing specific examples, diagrams, or problems from the material) enhance retrieval.

8. NEAR-TRANSFER: Include questions that require applying concepts to slightly different scenarios than those in the materials. This tests genuine understanding vs. memorization.

QUESTION GENERATION RULES:
1. Every question MUST be grounded in the provided course material excerpts.
2. Use specific terminology, examples, formulas, and concepts from the materials.
3. For RETRIEVAL mode: Focus on closed-book free recall. Ask students to explain, define, list, or derive from memory. Include both factual and conceptual questions.
4. For INTERLEAVED_PRACTICE mode: Mix questions across different objectives. Include "which concept applies?" questions that force discrimination between similar ideas.
5. For EXAM_SIM mode: Write multi-step questions requiring synthesis. Match likely exam format and difficulty.
6. For ERROR_REPAIR mode: Target commonly confused concepts. Create "near-miss" questions where subtle distinctions matter.
7. Assign difficulty 1-5 (1=recall a definition, 2=explain a concept, 3=apply to a new example, 4=analyze/compare, 5=synthesize across topics or evaluate).
8. NEVER write trivial questions. Even difficulty-1 questions should require genuine retrieval effort.
9. Reference specific examples or problems from the material when possible.
10. Generate exactly the requested number of prompts.

Output valid JSON:
{
  "prompts": [
    {
      "objective_id": string,
      "text": string,
      "difficulty": number
    }
  ]
}`,
    buildUserPrompt: (input: unknown) => {
      const { mode, objectives, topicScope, promptCount, contentChunks, courseName, examName } =
        input as GeneratePromptsInput;

      const objStr = objectives
        .map((o, i) => `${i + 1}. [${o.id}] ${o.title}`)
        .join("\n");

      const contentStr = contentChunks
        .map((c, i) => `[${i + 1}] ${c.doc_title}${c.page_number ? ` (p.${c.page_number})` : ""}\n${c.text.slice(0, 600)}`)
        .join("\n\n");

      let header = `Course: ${courseName}`;
      if (examName) header += ` | Exam: ${examName}`;

      return `${header}
Topic scope: ${topicScope}
Session mode: ${mode}
Generate exactly ${promptCount} questions.

Learning objectives:
${objStr}

Course material excerpts (use these to ground your questions):
${contentStr}

Generate ${promptCount} study questions that test mastery of this specific course material.`;
    },
  },

  [AiTask.EXTRACT_OBJECTIVES]: {
    task: AiTask.EXTRACT_OBJECTIVES,
    version: "v1",
    systemPrompt: `You are an expert curriculum analyst. Task: EXTRACT_OBJECTIVES.
Given excerpts from uploaded course materials, extract key learning objectives that a student should master.

Rules:
1. Extract between 5 and 20 learning objectives from the provided content.
2. Each objective should be specific and testable.
3. Estimate difficulty on a 1-5 scale (1=introductory, 5=advanced).
4. Include related keywords for each objective to aid search and matching.
5. Order objectives from foundational to advanced.

Output valid JSON:
{
  "objectives": [
    {
      "title": string,
      "description": string,
      "difficulty": number,
      "keywords": string[]
    }
  ]
}`,
    buildUserPrompt: (input: unknown) => {
      const { chunkTexts, courseName, examName } = input as ExtractObjectivesInput;
      const contextStr = chunkTexts
        .map((text, i) => `[Excerpt ${i + 1}]\n${text.slice(0, 600)}`)
        .join("\n\n");

      let header = `Course: ${courseName}`;
      if (examName) header += `\nExam: ${examName}`;

      return `${header}

The following excerpts are from the student's uploaded course materials:

${contextStr}

Extract key learning objectives from this content.`;
    },
  },
};

export function getPrompt(task: AiTask): PromptTemplate {
  const prompt = PROMPTS[task];
  if (!prompt) throw new Error(`No prompt registered for task: ${task}`);
  return prompt;
}
