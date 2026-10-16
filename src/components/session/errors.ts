import { ApiError } from "@/lib/client-api";
import type { BreakState } from "@/lib/session-types";

/**
 * One mapper from a failed session request to the words the student reads
 * (VOICE.md: what didn't happen, then the fix). Raw server text such as
 * "Forbidden" or "run_not_completed" never reaches the screen.
 */
export type SessionAction = "start" | "submit" | "finish" | "endBreak" | "results" | "followups";

export interface SessionErrorCopy {
  /** What didn't happen: "Answer not saved." */
  title: string;
  /** The fix, as a sentence. */
  description: string;
  /** Offer a sign-in link instead of Retry. */
  signIn?: boolean;
  /** Another tab moved on; only a reload helps. */
  reload?: boolean;
}

const NOT_DONE: Record<SessionAction, string> = {
  start: "Session not started.",
  submit: "Answer not saved.",
  finish: "Session not finished.",
  endBreak: "Break didn't end.",
  results: "Results didn't load.",
  followups: "Follow-ups not added.",
};

/** What is safe despite the failure, said before the fix. */
const KEPT: Record<SessionAction, string> = {
  start: "",
  submit: "Your answer is still here. ",
  finish: "Your answers are saved. ",
  endBreak: "",
  results: "Your answers are saved. ",
  followups: "",
};

function bodyOf(error: ApiError): Record<string, unknown> {
  return error.body && typeof error.body === "object" ? (error.body as Record<string, unknown>) : {};
}

function isTimeout(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    ((error as { name: unknown }).name === "TimeoutError" || (error as { name: unknown }).name === "AbortError")
  );
}

export function sessionErrorCopy(error: unknown, action: SessionAction): SessionErrorCopy {
  const title = NOT_DONE[action];
  const kept = KEPT[action];

  if (isTimeout(error)) {
    return {
      title,
      description:
        action === "start"
          ? "Preparing the questions took longer than a minute. Retry, and it picks up the questions already prepared."
          : `The server took too long to answer. ${kept}Retry in a moment.`,
    };
  }

  if (!(error instanceof ApiError)) {
    return { title, description: `${kept}Check your connection and retry.` };
  }

  const body = bodyOf(error);
  switch (error.status) {
    case 401:
      return {
        title: "Your sign-in expired.",
        description: "Sign in again to continue. Your answers are saved.",
        signIn: true,
      };
    case 403:
      // The session was never in this account, so don't say it left it.
      return { title, description: "This session belongs to another account." };
    case 404:
      return { title, description: "This session doesn't exist anymore. It may have been deleted." };
    case 429:
      return { title, description: `Too many requests in a short time. ${kept}Wait a minute, then retry.` };
    case 400:
      if (action === "start") {
        return { title, description: "This kind of session can't be practiced yet. Pick another session from Home." };
      }
      return { title, description: `${kept}Reload the page, then retry.` };
    case 409:
      if (action === "followups") {
        return { title, description: "Finish the session before adding follow-ups." };
      }
      if (action === "endBreak") {
        return { title, description: "The break already ended in another tab. Reload to continue.", reload: true };
      }
      if (action === "submit" && typeof body.expected === "number") {
        return {
          title,
          description: "This question was answered in another tab. Reload to continue.",
          reload: true,
        };
      }
      return {
        title,
        description: "This session changed in another tab. Reload to continue.",
        reload: true,
      };
    default:
      return { title, description: `${kept}Retry in a moment.` };
  }
}

/** The copy as one sentence pair, for places that show a single line. */
export function sessionErrorMessage(error: unknown, action: SessionAction): string {
  const copy = sessionErrorCopy(error, action);
  return `${copy.title} ${copy.description}`;
}

/**
 * The same failure as an ApiError whose message is the student-facing copy.
 * Status, code and body survive, so callers can still branch on them.
 */
export function toSessionError(error: unknown, action: SessionAction): ApiError {
  const message = sessionErrorMessage(error, action);
  if (error instanceof ApiError) return new ApiError(message, error.status, error.body);
  return new ApiError(message, 0, null);
}

/** The 409 the attempt route sends when a break started before the answer arrived. */
export function breakStateFromRejection(error: unknown): BreakState | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const state = bodyOf(error).break_state;
  if (state && typeof state === "object" && (state as { on_break?: unknown }).on_break === true) {
    return state as BreakState;
  }
  return null;
}
