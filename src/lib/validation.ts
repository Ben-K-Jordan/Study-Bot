import { z } from "zod/v4";

export const SESSION_MODES = [
  "RETRIEVAL",
  "INTERLEAVED_PRACTICE",
  "ERROR_REPAIR",
  "EXAM_SIM",
  "WORKED_EXAMPLES",
  "OFFICE_HOURS_PREP",
] as const;

export type SessionMode = (typeof SESSION_MODES)[number];

export const BREAK_TYPES = ["50_10", "25_5", "custom"] as const;

export const createSessionSchema = z.object({
  course_id: z.string().optional(),
  course_name: z.string().min(1, "course_name is required"),
  exam_id: z.string().optional(),
  exam_name: z.string().min(1, "exam_name is required"),
  mode: z.enum(SESSION_MODES),
  topic_scope: z.string().min(1, "topic_scope is required"),
  planned_minutes: z
    .number()
    .int()
    .min(15, "planned_minutes must be at least 15")
    .max(240, "planned_minutes must be at most 240"),
  objectives: z
    .array(z.object({ id: z.string(), title: z.string() }))
    .optional(),
  target_outcome: z
    .object({
      type: z.string().optional(),
      prompt_count: z.number().optional(),
      target_accuracy: z.number().min(0).max(1).optional(),
      closed_book_required: z.boolean().optional(),
      deliverables: z.array(z.string()).optional(),
    })
    .optional(),
  break_protocol: z
    .object({
      type: z.string().optional(),
      cycles: z.number().int().min(1).optional(),
    })
    .optional(),
  resources: z
    .array(
      z.object({
        type: z.string(),
        ref: z.string(),
        range: z.string().optional(),
      })
    )
    .optional(),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
