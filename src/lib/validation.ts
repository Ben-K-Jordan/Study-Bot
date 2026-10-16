import { z } from "zod";

export const SESSION_MODES = [
  "RETRIEVAL",
  "INTERLEAVED_PRACTICE",
  "ERROR_REPAIR",
  "EXAM_SIM",
  "WORKED_EXAMPLES",
] as const;

export type SessionMode = (typeof SESSION_MODES)[number];

export const RUNNABLE_MODES = [
  "RETRIEVAL",
  "INTERLEAVED_PRACTICE",
  "EXAM_SIM",
  "ERROR_REPAIR",
  "WORKED_EXAMPLES",
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

/**
 * Longest answer the server accepts, the same limit as POST /reveal. The text
 * goes into AI prompts in full, so an unbounded answer could overflow the
 * model's context window, and those provider failures count toward the AI
 * circuit breaker that every student shares (src/lib/ai/gateway.ts).
 */
export const MAX_ANSWER_CHARS = 20_000;

const answerText = z
  .string()
  .min(1, "Answer is required")
  .max(MAX_ANSWER_CHARS, "Shorten your answer to 20,000 characters.");

const errorLogSchema = z.object({
  error_type: z.enum(ERROR_TYPES),
  correction_rule: z
    .string()
    .min(1, "Correction rule is required")
    .max(MAX_ANSWER_CHARS, "Shorten your correction rule to 20,000 characters."),
  variant_question: z
    .string()
    .max(MAX_ANSWER_CHARS, "Shorten your similar question to 20,000 characters.")
    .optional(),
});

/**
 * Legacy attempt schema: immediate scoring (RETRIEVAL / INTERLEAVED / ERROR_REPAIR).
 * Backward compatible with existing clients.
 *
 * MCQ attempts send mcq_choice_index instead of self_score — the server grades
 * the choice against the stored correct answer and builds the error log itself.
 */
export const submitAttemptSchema = z
  .object({
    prompt_index: z.number().int().min(0),
    user_answer: answerText,
    self_score: z.enum(SELF_SCORES).optional(),
    mcq_choice_index: z.number().int().min(0).max(3).optional(),
    // Pretest items are diagnostic — errors are expected and are not logged.
    // The server verifies against the stored prompt meta before honoring this.
    is_pretest: z.boolean().optional(),
    // Repair prompts (variants / error-repair decks) already carry their
    // correction rule server-side — no new error log is collected.
    is_repair: z.boolean().optional(),
    time_to_answer_seconds: z.number().int().min(0).max(7200).optional(),
    confidence_rating: z.number().int().min(1).max(5).optional(),
    self_explanation: z.string().max(2000).optional(),
    generated_example: z.string().max(2000).optional(),
    error_log: errorLogSchema.optional(),
  })
  .refine(
    (data) => data.self_score != null || data.mcq_choice_index != null,
    { message: "self_score is required (or mcq_choice_index for MCQ prompts)" }
  )
  .refine(
    (data) => {
      // Server-graded MCQ attempts build their own error log; pretest
      // attempts are diagnostic and never produce error logs; repair
      // prompts update their source error log instead of minting one.
      if (data.mcq_choice_index != null || data.is_pretest || data.is_repair) return true;
      if (data.self_score !== "PARTIAL" && data.self_score !== "INCORRECT") return true;
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
  user_answer: answerText,
  mcq_choice_index: z.number().int().min(0).max(3).optional(),
  time_to_answer_seconds: z.number().int().min(0).max(7200).optional(),
  confidence_rating: z.number().int().min(1).max(5).optional(),
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
    self_explanation: z.string().max(2000).optional(),
    generated_example: z.string().max(2000).optional(),
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
 * Post-review metacognition update: attach a self-explanation or generated
 * example to an attempt that was already submitted (review panel inputs).
 */
export const updateAttemptMetaSchema = z
  .object({
    self_explanation: z.string().max(2000).optional(),
    generated_example: z.string().max(2000).optional(),
    socratic_answer: z.string().max(2000).optional(),
  })
  .refine(
    (data) =>
      data.self_explanation != null ||
      data.generated_example != null ||
      data.socratic_answer != null,
    { message: "Provide self_explanation, generated_example, or socratic_answer" }
  );

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
//
// Messages are written for the student: the New plan form shows them next to
// the field named by each issue's path.

const PLAN_BREAK_TYPES = ["25_5", "50_10", "90_15"] as const;

const dayAvailabilitySchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/, "Choose a start time."),
  end: z.string().regex(/^\d{2}:\d{2}$/, "Choose an end time."),
});

export const createPlanSchema = z
  .object({
    course_name: z.string().trim().min(1, "Enter a course name.").max(120, "Use 120 characters or fewer."),
    course_id: z.string().optional(),
    exam_name: z.string().trim().min(1, "Enter an exam name.").max(120, "Use 120 characters or fewer."),
    exam_id: z.string().optional(),
    exam_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the exam date."),
    // IANA timezone; createPlan falls back to the user's setting, then a default
    timezone: z.string().max(100).optional(),
    objectives: z
      .array(z.string().trim().min(1))
      .optional()
      .default([]),
    document_ids: z
      .array(z.string().min(1))
      .optional()
      .default([]),
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
    /**
     * The plan this one replaces (same course and exam). It is deleted only
     * after the new plan is created, so a failed create never loses it.
     */
    replace_plan_id: z.string().min(1).max(100).optional(),
    /** Also remove the replaced plan's events from Google Calendar. */
    remove_replaced_calendar_events: z.boolean().optional().default(false),
  })
  .refine(
    (data) => {
      return data.availability.every((day) => day.start < day.end);
    },
    { message: "Choose an end time after the start time.", path: ["availability"] }
  )
  .refine(
    (data) => {
      return data.objectives.length >= 3 || data.document_ids.length > 0;
    },
    { message: "Upload materials or type at least 3 topics, one per line.", path: ["objectives"] }
  );
