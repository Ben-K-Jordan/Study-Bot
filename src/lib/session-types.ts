/**
 * Types shared by the session shell (/s/[sessionId]), its screens, the
 * runner and the server code that prepares them. Plain module: safe to
 * import from server code and from client components.
 *
 * Field names stay snake_case because they mirror the JSON the run API
 * returns; the runner and the e2e suite read them as is.
 */

export interface Prompt {
  id: string;
  objective_id?: string;
  text: string;
  difficulty: number;
  format?: "FREE_RECALL" | "MCQ";
  choices?: string[];
  meta?: {
    source_error_log_id?: string;
    original_prompt_text?: string;
    expected_correction_rule?: string;
    variant_question?: string;
    pack?: string;
  };
}

/** Server-graded MCQ outcome, returned by POST /attempt for MCQ prompts. */
export interface McqResult {
  selected_index: number;
  correct_index: number;
  is_correct: boolean;
  correct_choice: string;
  rationale?: string;
}

/** Response payload of a successful attempt submission. */
export interface AttemptSubmitResult {
  attempt_id?: string;
  status?: string;
  mcq_result?: McqResult | null;
  [key: string]: unknown;
}

export interface PromptView {
  prompt_index: number;
  text: string;
  objective_id?: string;
  difficulty?: number;
  source_type?: string;
  format?: "FREE_RECALL" | "MCQ";
  choices?: string[];
  /** Only present while scoring in exam simulation: the server withholds the answer key before an answer. */
  correctIndex?: number;
  meta?: {
    distractorRationales?: string[];
    original_prompt_text?: string;
    /** Deck-pack marker (PRE_TEST, WORKED_EXAMPLE, WE_*); drives the question's framing. */
    pack?: string;
    [key: string]: unknown;
  };
}

export interface RunMetrics {
  attempts_count: number;
  correct_count: number;
  partial_count: number;
  incorrect_count: number;
  accuracy: number;
  time_spent_seconds: number;
  pretest_count?: number;
  pretest_correct?: number;
  recommended_followups?: { label: string; days_from_now: number; date: string }[];
}

export interface BreakState {
  work_started_at: string;
  current_cycle: number;
  total_cycles: number;
  on_break: boolean;
  break_started_at?: string;
  break_duration_seconds?: number;
  work_duration_seconds: number;
  completed_breaks: string[];
}

export interface RunPolicies {
  scoring: "IMMEDIATE" | "DELAYED";
  requiresErrorLogOn: string[];
  allowHintsBeforeAnswer: boolean;
  allowEndBreakEarly: boolean;
}

export interface RunAttemptSummary {
  id: string;
  prompt_index: number;
  user_answer: string;
  self_score: string | null;
  confidence_rating?: number | null;
}

export interface RunData {
  run_id: string;
  status: string;
  mode: string;
  phase: string;
  current_index: number;
  prompt_count: number;
  current_prompt: PromptView | null;
  answered_count?: number | null;
  scored_count?: number | null;
  /** Legacy: the redacted deck, used only when GET /prompt fails. */
  prompts?: Prompt[];
  policies: RunPolicies;
  metrics: RunMetrics;
  break_state: BreakState;
  /** Saved answers, loaded when scoring starts in exam simulation (GET /api/runs/:runId). */
  attempts?: RunAttemptSummary[];
  /** The attempt just submitted, for deferred feedback. */
  last_attempt_id?: string;
}

/** What the deck of a session holds: shown on the preflight before starting. */
export interface DeckComposition {
  total: number;
  new_count: number;
  /** Pretest questions (code name: diagnostic). */
  diagnostic_count: number;
  /** Questions due for review (code name: warmup). */
  review_count: number;
  repair_count: number;
}

/** A run that is still open, so the preflight can offer Resume session. */
export interface ActiveRunSummary {
  run_id: string;
  phase: string;
  current_index: number;
  prompt_count: number;
  answered_count: number | null;
  started_at: string | null;
}

export interface SessionData {
  session_id: string;
  course_name: string;
  exam_name: string;
  mode: string;
  /** VOICE.md label: "Retrieval", "Exam simulation". */
  mode_label: string;
  /** One sentence on how the mode works. */
  mode_description: string;
  topic_scope: string;
  planned_minutes: number;
  target_outcome: Record<string, unknown> | null;
  break_protocol: Record<string, unknown> | null;
  objectives: { id: string; title: string }[] | null;
  /**
   * @deprecated The preflight receives the deck composition as a streamed
   * promise; this stays null.
   */
  deck_preview?: DeckComposition | null;
  /** Whether a run was open when the page loaded. */
  has_active_run: boolean;
  active_run_id: string | null;
  active_run: ActiveRunSummary | null;
  last_completed_run: {
    run_id: string;
    metrics: Record<string, unknown>;
    ended_at: string | null;
  } | null;
  /** The student's IANA time zone (Settings, else the plan's); null when neither is set. */
  timezone: string | null;
  /** The exam day as an instant at noon in `timezone`, when a plan names it. */
  exam_date: string | null;
  /** When this session is scheduled in the plan, if it is. */
  scheduled_at: string | null;
}

// ---------------------------------------------------------------------------
// Results (end screen)
// ---------------------------------------------------------------------------

export type SelfScore = "CORRECT" | "PARTIAL" | "INCORRECT";

/** One scored, non-pretest answer with the confidence picked before checking. */
export interface RatedAnswer {
  prompt_index: number;
  /** Stored confidence: 1, 3 or 5 (older runs may hold 2 or 4); null when not rated. */
  confidence: number | null;
  score: SelfScore;
}

export interface FollowupItem {
  /** YYYY-MM-DD in the preview's time zone (UTC when it has none). */
  date: string;
  /**
   * An instant on that day: the scheduled start, or noon when nothing is
   * scheduled. With no zone, the moment whole days after the session ended.
   */
  at: string;
  days_from_now: number | null;
  /** The follow-up session, once it is in the plan. */
  session_id?: string;
  /** Skipped days only: after the exam, or a day that has already passed. */
  reason?: "past_exam" | "past";
}

export interface FollowupPreview {
  /** no_plan: nothing to add to; not_scheduled: Add follow-ups to plan; scheduled: already in the plan. */
  status: "no_plan" | "not_scheduled" | "scheduled";
  /**
   * The zone the dates belong to: the plan's, else the student's from
   * Settings. Null when neither is known; each `at` is then an instant
   * whole days after the session ended, shown in the browser's zone.
   */
  timezone: string | null;
  /** The plan's exam, for "falls after Prelim 2". */
  exam_name: string | null;
  /** The plan the follow-ups are in (or would go into), for "Open plan". Null with no plan. */
  plan_id?: string | null;
  items: FollowupItem[];
  /** Recommended days that can't be added: after the exam, or already passed. */
  skipped: FollowupItem[];
}

export interface SessionResults {
  run_id: string;
  session_id: string;
  mode: string;
  started_at: string | null;
  ended_at: string | null;
  metrics: RunMetrics;
  /** Every answered question, pretest questions included. */
  question_count: number;
  pretest_count: number;
  repair_count: number;
  errors_logged: number;
  answered_count: number | null;
  scored_count: number | null;
  answers: RatedAnswer[];
  followups: FollowupPreview | null;
}
