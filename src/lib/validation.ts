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

export const RUNNABLE_MODES = [
  "RETRIEVAL",
  "INTERLEAVED_PRACTICE",
  "EXAM_SIM",
  "ERROR_REPAIR",
] as const;

export type RunnableMode = (typeof RUNNABLE_MODES)[number];

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

// --- Run / Attempt validation ---

export const SELF_SCORES = ["CORRECT", "PARTIAL", "INCORRECT"] as const;
export const ERROR_TYPES = [
  "MISCONCEPTION",
  "PROCEDURE",
  "CARELESS",
  "MEMORY",
  "UNKNOWN",
] as const;
const errorLogSchema = z.object({
  error_type: z.enum(ERROR_TYPES),
  correction_rule: z.string().min(1, "Correction rule is required"),
  variant_question: z.string().optional(),
});

/**
 * Legacy attempt schema: immediate scoring (RETRIEVAL / INTERLEAVED / ERROR_REPAIR).
 * Backward compatible with existing clients.
 */
export const submitAttemptSchema = z
  .object({
    prompt_index: z.number().int().min(0),
    user_answer: z.string().min(1, "Answer is required"),
    self_score: z.enum(SELF_SCORES),
    time_to_answer_seconds: z.number().int().min(0).max(7200).optional(),
    error_log: errorLogSchema.optional(),
  })
  .refine(
    (data) => {
      if (data.self_score === "CORRECT") return true;
      return data.error_log != null;
    },
    { message: "error_log is required when self_score is PARTIAL or INCORRECT" }
  );

export type SubmitAttemptInput = z.infer<typeof submitAttemptSchema>;

/**
 * EXAM_SIM ANSWER payload: submit answer without scoring (EXAM phase).
 */
export const examAnswerSchema = z.object({
  prompt_index: z.number().int().min(0),
  kind: z.literal("ANSWER"),
  user_answer: z.string().min(1, "Answer is required"),
  time_to_answer_seconds: z.number().int().min(0).max(7200).optional(),
});

export type ExamAnswerInput = z.infer<typeof examAnswerSchema>;

/**
 * EXAM_SIM SCORE payload: score a previously answered prompt (REVIEW phase).
 */
export const examScoreSchema = z
  .object({
    prompt_index: z.number().int().min(0),
    kind: z.literal("SCORE"),
    self_score: z.enum(SELF_SCORES),
    error_log: errorLogSchema.optional(),
  })
  .refine(
    (data) => {
      if (data.self_score === "CORRECT") return true;
      return data.error_log != null;
    },
    { message: "error_log is required when self_score is PARTIAL or INCORRECT" }
  );

export type ExamScoreInput = z.infer<typeof examScoreSchema>;

/**
 * Unified attempt schema: accepts legacy (no kind) or new (kind=ANSWER|SCORE).
 * Use parseAttemptPayload() to normalize.
 */
export type AttemptPayload =
  | ({ kind?: undefined } & SubmitAttemptInput)
  | ExamAnswerInput
  | ExamScoreInput;

/**
 * Parse and normalize an attempt request body.
 * Returns a discriminated result or throws ZodError.
 */
export function parseAttemptPayload(body: unknown): AttemptPayload {
  const raw = body as Record<string, unknown>;
  if (raw?.kind === "ANSWER") {
    return examAnswerSchema.parse(body) as ExamAnswerInput;
  }
  if (raw?.kind === "SCORE") {
    return examScoreSchema.parse(body) as ExamScoreInput;
  }
  // Legacy format (no kind field)
  return submitAttemptSchema.parse(body) as SubmitAttemptInput;
}

// --- Plan validation ---

const PLAN_BREAK_TYPES = ["25_5", "50_10", "90_15"] as const;

const dayAvailabilitySchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM format"),
  end: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:MM format"),
});

export const createPlanSchema = z
  .object({
    course_name: z.string().min(1, "course_name is required"),
    course_id: z.string().optional(),
    exam_name: z.string().min(1, "exam_name is required"),
    exam_id: z.string().optional(),
    exam_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
    timezone: z.string().optional().default("America/New_York"),
    objectives: z
      .array(z.string().min(1))
      .min(3, "At least 3 objectives required"),
    availability: z
      .array(dayAvailabilitySchema)
      .length(7, "Must provide availability for 7 days"),
    daily_study_cap_minutes: z
      .number()
      .int()
      .min(30)
      .max(600)
      .optional()
      .default(180),
    break_protocol_default: z
      .enum(PLAN_BREAK_TYPES)
      .optional()
      .default("50_10"),
    use_google_availability: z.boolean().optional(),
    chronotype: z
      .enum(["morning", "evening", "flexible"])
      .optional()
      .default("flexible"),
    preferred_session_minutes: z
      .number()
      .int()
      .min(15)
      .max(120)
      .optional()
      .default(50),
    study_style: z
      .enum(["intensive", "balanced", "relaxed"])
      .optional()
      .default("balanced"),
  })
  .refine(
    (data) => {
      return data.availability.every((day) => day.start < day.end);
    },
    { message: "Each day's end time must be after start time" }
  );
