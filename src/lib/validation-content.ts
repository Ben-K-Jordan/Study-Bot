import { z } from "zod/v4";

// ---- Content Documents ----

const CONTENT_NAMESPACES = ["COURSE", "RESEARCH"] as const;

export const uploadDocumentSchema = z
  .object({
    namespace: z.enum(CONTENT_NAMESPACES),
    course_name: z.string().optional(),
    exam_name: z.string().optional(),
    title: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.namespace === "COURSE") return !!data.course_name;
      return true;
    },
    { message: "course_name is required for COURSE namespace" }
  );

export const searchContentSchema = z.object({
  q: z.string().min(1, "Search query is required"),
  namespace: z.enum(CONTENT_NAMESPACES),
  course_name: z.string().optional(),
  exam_name: z.string().optional(),
  top_k: z.number().int().min(1).max(10).default(5),
});

export const listDocumentsSchema = z.object({
  namespace: z.enum(CONTENT_NAMESPACES).optional(),
  course_name: z.string().optional(),
  exam_name: z.string().optional(),
});

// ---- Practice Bank ----

const QUESTION_KINDS = ["SHORT_ANSWER", "MCQ", "CODING"] as const;

export const createPracticeSetSchema = z.object({
  course_name: z.string().min(1, "course_name is required"),
  exam_name: z.string().optional(),
  title: z.string().min(1, "title is required"),
});

export const practiceQuestionSchema = z.object({
  kind: z.enum(QUESTION_KINDS),
  prompt_text: z.string().min(1, "prompt_text is required"),
  answer_key: z.string().optional(),
  solution_steps: z.string().optional(),
  tags: z.record(z.string(), z.unknown()).optional(),
});

export const importQuestionsSchema = z.object({
  questions: z.array(practiceQuestionSchema).min(1, "At least one question required"),
});

// ---- Evidence (SSKB) ----

const EVIDENCE_STRENGTHS = ["WEAK", "MODERATE", "STRONG"] as const;

export const createEvidencePaperSchema = z.object({
  title: z.string().min(1, "title is required"),
  authors: z.string().optional(),
  year: z.number().int().optional(),
  venue: z.string().optional(),
  document_id: z.string().min(1, "document_id is required"),
  tags: z.array(z.string()).optional(),
});

export const createEvidenceCardSchema = z.object({
  claim: z.string().min(1, "claim is required"),
  recommendation: z.string().min(1, "recommendation is required"),
  boundary_conditions: z.string().optional(),
  strength: z.enum(EVIDENCE_STRENGTHS),
  tags: z.array(z.string()).optional(),
});
