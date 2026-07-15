/**
 * Error reporting integration point.
 * Replace with Sentry, Datadog, or similar in production.
 *
 * Usage:
 *   captureException(err, { user_id, run_id, action: "submitAttempt" })
 */

import { logger } from "./logger";

interface ErrorContext {
  user_id?: string;
  session_id?: string;
  run_id?: string;
  action?: string;
  [key: string]: unknown;
}

export function captureException(error: unknown, context?: ErrorContext): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  logger.error("exception.captured", {
    message,
    stack,
    ...context,
  });

  // TODO: Replace with Sentry.captureException(error, { extra: context })
  // or your preferred error reporting service.
}
