/**
 * The deck composition the preflight screen states before a run starts.
 */
import { prisma } from "@/lib/db";
import { prependBudget } from "./shared";
import { generateCrossSessionRepairs, generatePretestPrompts, generateWarmupPrompts } from "./generators";

// ---- Deck composition preview ----

export interface DeckComposition {
  total: number;
  new_count: number;
  diagnostic_count: number;
  review_count: number;
  repair_count: number;
}

/**
 * Predict the deck composition for a session BEFORE the run starts, so the
 * preflight screen can state the contract ("7 new · 2 review · 1 diagnostic")
 * instead of surprising the student. Runs the same generators and budget the
 * real deck builder uses (database only — no AI calls), so the prediction
 * matches the deck the run will actually build.
 */
export async function getDeckPreview(
  userId: string,
  params: {
    courseName: string;
    mode: string;
    objectives: { id: string; title: string }[] | null;
    promptCount: number;
  },
): Promise<DeckComposition> {
  const { courseName, mode, objectives, promptCount } = params;

  if (mode === "ERROR_REPAIR") {
    // Course-scoped to mirror the real deck builder (and the cross-session
    // repair injection): only this course's unresolved errors count.
    const unresolved = await prisma.sessionErrorLog.count({
      where: {
        userId,
        resolvedAt: null,
        run: {
          session: { courseName },
        },
      },
    });
    const repairs = Math.min(unresolved, promptCount);
    return repairs > 0
      ? { total: repairs, new_count: 0, diagnostic_count: 0, review_count: 0, repair_count: repairs }
      : { total: Math.min(3, promptCount), new_count: Math.min(3, promptCount), diagnostic_count: 0, review_count: 0, repair_count: 0 };
  }

  if (mode === "EXAM_SIM" || mode === "WORKED_EXAMPLES") {
    return { total: promptCount, new_count: promptCount, diagnostic_count: 0, review_count: 0, repair_count: 0 };
  }

  const budget = prependBudget(promptCount);
  let diagnostic = 0;
  let review = 0;
  let repair = 0;
  if (budget > 0) {
    const [pretests, warmups, repairs] = await Promise.all([
      generatePretestPrompts(userId, courseName, objectives),
      generateWarmupPrompts(userId, courseName, objectives),
      generateCrossSessionRepairs(userId, courseName),
    ]);
    let slots = budget;
    repair = Math.min(repairs.length, slots);
    slots -= repair;
    diagnostic = Math.min(pretests.length, slots);
    slots -= diagnostic;
    review = Math.min(warmups.length, slots);
  }
  const injected = diagnostic + review + repair;
  return {
    total: promptCount,
    new_count: Math.max(1, promptCount - injected),
    diagnostic_count: diagnostic,
    review_count: review,
    repair_count: repair,
  };
}
