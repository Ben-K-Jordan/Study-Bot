/**
 * Core types for the AI control plane.
 */

export enum AiTask {
  EMBED_TEXTS = "EMBED_TEXTS",
  ANSWER_WITH_CITATIONS = "ANSWER_WITH_CITATIONS",
  GENERATE_VARIANT_QUESTION = "GENERATE_VARIANT_QUESTION",
  SUGGEST_ERROR_TYPE = "SUGGEST_ERROR_TYPE",
  GENERATE_STUDY_PLAN = "GENERATE_STUDY_PLAN",
  EXTRACT_OBJECTIVES = "EXTRACT_OBJECTIVES",
}

export interface AiUsage {
  tokenIn?: number;
  tokenOut?: number;
  costUsdMicros?: number;
}

export interface AiResult<T> {
  output: T;
  usage?: AiUsage;
}

export interface AiError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface AiCallMeta {
  cacheHit: boolean;
  latencyMs: number;
  promptVersion: string;
  model: string;
  task: AiTask;
}

export interface TaskSpec<T> {
  task: AiTask;
  promptVersion: string;
  model: string;
  input: unknown;
  /** Parse and validate the raw output into the expected type */
  parseOutput: (raw: unknown) => T;
}

export interface RunTaskResult<T> {
  output: T;
  meta: AiCallMeta;
}
