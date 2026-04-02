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
};

export function getPrompt(task: AiTask): PromptTemplate {
  const prompt = PROMPTS[task];
  if (!prompt) throw new Error(`No prompt registered for task: ${task}`);
  return prompt;
}
