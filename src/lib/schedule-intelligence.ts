/**
 * Schedule Intelligence Module
 *
 * Applies cognitive science research to optimize WHEN study sessions are scheduled,
 * not just WHERE they fit. Provides slot scoring, pre-exam tapering, intraday
 * spacing enforcement, and dynamic session duration adjustment.
 *
 * Research basis:
 * - Circadian task alignment: Wieth & Zacks 2011, Schmidt et al. 2007
 * - Sleep-proximity consolidation: Payne & Kensinger 2008, Gais et al. 2006
 * - Post-exercise cognitive boost: Roig et al. 2013, Blomstrand & Engvall 2021
 * - Cognitive fatigue: Linder et al. 2014, Hockey 2013
 * - Pre-exam taper: Mujika & Padilla 2003 (adapted from athletic tapering)
 * - Intraday spacing: Cepeda et al. 2008
 * - Session duration by cognitive load: Cognitive Research 2020
 * - Post-class consolidation timing: Dewar et al. 2012, Wixted 2004
 * - Retroactive interference avoidance: Underwood 1957
 */

import type { TimeInterval } from "@/lib/google/free-slots";

// ---- Types ----

export type Chronotype = "morning" | "evening" | "flexible";

export type SessionMode =
  | "RETRIEVAL"
  | "INTERLEAVED_PRACTICE"
  | "ERROR_REPAIR"
  | "EXAM_SIM"
  | "WORKED_EXAMPLES";

export interface CalendarEvent {
  summary: string;
  start: number; // unix ms
  end: number;   // unix ms
}

export interface SlotScoreInput {
  slot: TimeInterval;
  mode: SessionMode;
  chronotype: Chronotype;
  /** Events on the same day, used for fatigue + exercise detection */
  dayEvents: CalendarEvent[];
  /** User's typical bedtime hour (0-23). If unknown, defaults to 23. */
  bedtimeHour: number;
  /** The course name for this study session (for class-matching). Optional. */
  courseName?: string;
  /** The topic scope for this study session (for class-matching). Optional. */
  topicScope?: string;
}

// ---- Constants ----

/** Cognitive load rating per mode: higher = more demanding */
const MODE_COGNITIVE_LOAD: Record<SessionMode, number> = {
  RETRIEVAL: 0.9,
  EXAM_SIM: 1.0,
  ERROR_REPAIR: 0.7,
  INTERLEAVED_PRACTICE: 0.6,
  WORKED_EXAMPLES: 0.5,
};

/**
 * Peak performance windows by chronotype (hour ranges, 0-23).
 * Based on Schmidt et al. 2007 and general circadian research.
 */
const PEAK_HOURS: Record<Chronotype, { start: number; end: number }> = {
  morning: { start: 8, end: 12 },
  evening: { start: 16, end: 21 },
  flexible: { start: 9, end: 17 },
};

/** Keywords that identify exercise/workout events in calendar */
const EXERCISE_KEYWORDS = [
  "gym", "workout", "exercise", "run", "running", "jog", "swim",
  "yoga", "crossfit", "hiit", "cardio", "cycling", "bike", "walk",
  "fitness", "sport", "training", "basketball", "soccer", "tennis",
  "lifting", "weights", "pilates", "martial arts", "boxing",
];

/** Keywords that identify class/lecture events in calendar */
const CLASS_KEYWORDS = [
  "class", "lecture", "lab", "recitation", "section", "seminar",
  "tutorial", "workshop", "discussion", "office hours",
  // Common course code patterns are handled by regex in isClassEvent()
];

/**
 * Max recommended session duration (minutes) by mode.
 * Based on cognitive encoding efficiency research.
 * High cognitive load → shorter sessions to avoid diminishing returns.
 */
export const MAX_DURATION_BY_MODE: Record<SessionMode, number> = {
  EXAM_SIM: 50,
  RETRIEVAL: 45,
  ERROR_REPAIR: 40,
  INTERLEAVED_PRACTICE: 60,
  WORKED_EXAMPLES: 60,
};

/**
 * Minimum useful session duration (minutes).
 */
export const MIN_SESSION_MINUTES = 15;

// ---- Slot Scoring ----

/**
 * Score a time slot for a given session mode. Higher score = better fit.
 * Returns a value in [0, 1] range.
 *
 * Components:
 * 1. Circadian alignment (0.25 weight) — does the slot align with chronotype peak?
 * 2. Fatigue score (0.20 weight) — how cognitively tired is the student from prior events?
 * 3. Post-exercise boost (0.15 weight) — is there a workout within 30-60 min before?
 * 4. Sleep proximity (0.15 weight) — is ERROR_REPAIR near bedtime?
 * 5. Post-class timing (0.25 weight) — respect consolidation window after related classes
 */
export function scoreSlot(input: SlotScoreInput): number {
  const { slot, mode, chronotype, dayEvents, bedtimeHour, courseName, topicScope } = input;

  const slotDate = new Date(slot.start);
  const slotTimeDecimal = slotDate.getHours() + slotDate.getMinutes() / 60;

  // 1. Circadian alignment (0-1)
  const circadianScore = computeCircadianScore(slotTimeDecimal, mode, chronotype);

  // 2. Fatigue score (0-1, where 1 = low fatigue = good)
  const fatigueScore = computeFatigueScore(slot.start, dayEvents);

  // 3. Post-exercise boost (0-1)
  const exerciseScore = computeExerciseBoost(slot.start, dayEvents);

  // 4. Sleep proximity (0-1, only relevant for ERROR_REPAIR)
  const sleepScore = computeSleepProximityScore(slotTimeDecimal, mode, bedtimeHour);

  // 5. Post-class timing (0-1) — avoid same-subject study right after class
  const classScore = computePostClassScore(slot.start, dayEvents, courseName, topicScope);

  return (
    circadianScore * 0.25 +
    fatigueScore * 0.20 +
    exerciseScore * 0.15 +
    sleepScore * 0.15 +
    classScore * 0.25
  );
}

/**
 * Circadian alignment: high-load modes score better at chronotype peak,
 * creative/interleaved modes score better at off-peak (Wieth & Zacks 2011).
 */
function computeCircadianScore(
  hour: number,
  mode: SessionMode,
  chronotype: Chronotype,
): number {
  const peak = PEAK_HOURS[chronotype];
  const isInPeak = hour >= peak.start && hour < peak.end;
  const cogLoad = MODE_COGNITIVE_LOAD[mode];

  if (cogLoad >= 0.8) {
    // High-load modes (RETRIEVAL, EXAM_SIM): best at peak
    return isInPeak ? 1.0 : 0.4;
  }
  if (cogLoad <= 0.6) {
    // Lower-load/creative modes (INTERLEAVED, WORKED_EXAMPLES): fine at off-peak
    // Wieth & Zacks: insight tasks can benefit from non-optimal times
    return isInPeak ? 0.7 : 0.9;
  }
  // Medium load (ERROR_REPAIR): slight peak preference
  return isInPeak ? 0.85 : 0.65;
}

/**
 * Fatigue estimation from preceding calendar events.
 * Each hour of cognitively demanding activity (meetings, focused work) in the
 * prior 4 hours degrades performance ~6.5% (derived from Linder et al. 2014).
 */
function computeFatigueScore(slotStartMs: number, dayEvents: CalendarEvent[]): number {
  const lookbackMs = 4 * 60 * 60 * 1000; // 4 hours
  const lookbackStart = slotStartMs - lookbackMs;

  let fatigueCostMinutes = 0;

  for (const event of dayEvents) {
    // Only consider events that ended before this slot starts
    if (event.end > slotStartMs || event.end <= lookbackStart) continue;

    const durationMin = (event.end - event.start) / (1000 * 60);
    const summary = event.summary.toLowerCase();

    // Assign fatigue cost based on event type
    if (isExerciseEvent(summary)) {
      // Exercise is restorative — negative fatigue (capped)
      fatigueCostMinutes -= Math.min(durationMin * 0.3, 15);
    } else if (isCognitiveEvent(summary)) {
      // Meetings, classes, work = high cognitive cost
      fatigueCostMinutes += durationMin * 0.8;
    } else {
      // Other events = moderate cost
      fatigueCostMinutes += durationMin * 0.3;
    }
  }

  // Apply recency weighting: recent fatigue matters more
  // Convert to 0-1 scale: 0 min fatigue = 1.0, 240 min = 0.0
  const maxFatigueMinutes = 240;
  const normalized = Math.max(0, Math.min(fatigueCostMinutes, maxFatigueMinutes));
  return 1.0 - normalized / maxFatigueMinutes;
}

/**
 * Post-exercise boost: moderate exercise 30-60 min before studying enhances
 * episodic memory encoding (Roig et al. 2013).
 */
function computeExerciseBoost(slotStartMs: number, dayEvents: CalendarEvent[]): number {
  const boostWindowStart = slotStartMs - 60 * 60 * 1000; // 60 min before
  const boostWindowEnd = slotStartMs - 15 * 60 * 1000;   // 15 min before (need some recovery)

  for (const event of dayEvents) {
    if (!isExerciseEvent(event.summary.toLowerCase())) continue;
    // Check if exercise ended within the boost window
    if (event.end >= boostWindowStart && event.end <= boostWindowEnd) {
      return 1.0; // Full boost
    }
    // Partial boost if exercise ended 0-15 min before (still recovering)
    if (event.end > boostWindowEnd && event.end <= slotStartMs) {
      return 0.6;
    }
  }

  return 0.5; // Neutral baseline (no exercise detected)
}

/**
 * Sleep-proximity score: ERROR_REPAIR near bedtime gets a consolidation
 * bonus (Payne & Kensinger 2008, Gais et al. 2006).
 * Material studied within 3h of sleep has significantly better retention.
 */
function computeSleepProximityScore(
  hour: number,
  mode: SessionMode,
  bedtimeHour: number,
): number {
  if (mode !== "ERROR_REPAIR") {
    // Non-ERROR_REPAIR: slight penalty for very late sessions (fatigue)
    const hoursUntilBed = (bedtimeHour - hour + 24) % 24;
    if (hoursUntilBed <= 1) return 0.3; // too close to bed = less effective for hard modes
    return 0.6; // neutral
  }

  // ERROR_REPAIR benefits from sleep proximity
  const hoursUntilBed = (bedtimeHour - hour + 24) % 24;
  if (hoursUntilBed <= 3 && hoursUntilBed >= 0.5) {
    return 1.0; // Sweet spot: 0.5-3 hours before bed
  }
  if (hoursUntilBed <= 5) {
    return 0.7; // Moderate benefit
  }
  return 0.4; // Far from bedtime — less consolidation benefit
}

/**
 * Post-class consolidation timing.
 *
 * Research (Dewar et al. 2012, Wixted 2004, Underwood 1957):
 * - 0-30 min after a related class: consolidation window — studying the same
 *   subject causes retroactive interference. PENALIZE heavily.
 * - 30-60 min after: still risky, mild penalty.
 * - 1-2 hours after: OPTIMAL window for same-subject retrieval practice.
 *   Spacing effect gives best same-day review (Cepeda et al. 2006).
 * - 2+ hours after: neutral — spacing benefit plateaus for same-day.
 * - No related class: neutral score (no penalty or bonus).
 *
 * If the slot is BEFORE a related class, that's fine — no interference issue.
 * Unrelated subjects are not penalized after class.
 */
function computePostClassScore(
  slotStartMs: number,
  dayEvents: CalendarEvent[],
  courseName?: string,
  topicScope?: string,
): number {
  if (!courseName && !topicScope) return 0.6; // no topic info — neutral

  // Find class/lecture events that might be related to this study session
  let closestRelatedClassEndMs: number | null = null;
  let closestAnyClassEndMs: number | null = null;

  for (const event of dayEvents) {
    if (event.end > slotStartMs) continue; // class hasn't ended yet
    if (!isClassEvent(event.summary)) continue;

    const gapMs = slotStartMs - event.end;
    const gapHours = gapMs / (1000 * 60 * 60);
    if (gapHours > 4) continue; // too far back to matter

    // Check if this class is related to the study session
    const related = isRelatedClass(event.summary, courseName, topicScope);

    if (related) {
      if (closestRelatedClassEndMs === null || event.end > closestRelatedClassEndMs) {
        closestRelatedClassEndMs = event.end;
      }
    }
    if (closestAnyClassEndMs === null || event.end > closestAnyClassEndMs) {
      closestAnyClassEndMs = event.end;
    }
  }

  // If there's a related class before this slot, apply consolidation timing rules
  if (closestRelatedClassEndMs !== null) {
    const gapMinutes = (slotStartMs - closestRelatedClassEndMs) / (1000 * 60);

    if (gapMinutes < 30) {
      // 0-30 min: consolidation window — retroactive interference risk
      return 0.1; // Strong penalty
    }
    if (gapMinutes < 60) {
      // 30-60 min: still some interference risk
      return 0.35;
    }
    if (gapMinutes <= 120) {
      // 1-2 hours: OPTIMAL retrieval practice window
      return 1.0; // Strong bonus
    }
    // 2-4 hours: good but not optimal
    return 0.7;
  }

  // If there's an unrelated class before this slot, check for general fatigue
  // (already handled by fatigue score) — no additional penalty
  if (closestAnyClassEndMs !== null) {
    const gapMinutes = (slotStartMs - closestAnyClassEndMs) / (1000 * 60);
    if (gapMinutes < 15) {
      // Very short gap after ANY class — need a breather (Boksem et al. 2005)
      return 0.4;
    }
  }

  return 0.6; // No nearby class — neutral
}

// ---- Helpers ----

/**
 * Detect if a calendar event is a class/lecture.
 * Checks for class keywords AND common course code patterns (e.g., "CS 101", "MATH 240").
 */
export function isClassEvent(summary: string): boolean {
  const lower = summary.toLowerCase();

  // Check class keywords
  if (CLASS_KEYWORDS.some((kw) => lower.includes(kw))) return true;

  // Check for course code patterns: 2-4 uppercase letters followed by digits
  // e.g., "CS 101", "MATH240", "PHYS 2A", "BIO 101L"
  if (/\b[A-Z]{2,4}\s*\d{1,4}[A-Z]?\b/.test(summary)) return true;

  return false;
}

/**
 * Check if a class event is related to the study session's course/topic.
 * Uses fuzzy word matching between the event summary and the course name / topic scope.
 */
export function isRelatedClass(
  eventSummary: string,
  courseName?: string,
  topicScope?: string,
): boolean {
  const summaryLower = eventSummary.toLowerCase();

  // Direct course name match (e.g., "CS 101" in event, "CS 101" as course)
  if (courseName) {
    const courseNameLower = courseName.toLowerCase();
    if (summaryLower.includes(courseNameLower)) return true;
    // Check if most course name words appear in the event summary
    const courseWords = courseNameLower.split(/[\s,]+/).filter((w) => w.length > 1);
    const matchCount = courseWords.filter((w) => summaryLower.includes(w)).length;
    if (courseWords.length > 0 && matchCount >= Math.ceil(courseWords.length * 0.6)) return true;
  }

  // Topic scope word overlap
  if (topicScope) {
    const topicWords = new Set(
      topicScope.toLowerCase().split(/[,\s]+/).filter((w) => w.length > 3),
    );
    const summaryWords = new Set(
      summaryLower.split(/[\s:,\-/]+/).filter((w) => w.length > 3),
    );
    let overlap = 0;
    for (const w of topicWords) {
      if (summaryWords.has(w)) overlap++;
    }
    if (overlap >= 1) return true;
  }

  return false;
}

function isExerciseEvent(summaryLower: string): boolean {
  return EXERCISE_KEYWORDS.some((kw) => summaryLower.includes(kw));
}

function isCognitiveEvent(summaryLower: string): boolean {
  const cognitiveKeywords = [
    "meeting", "class", "lecture", "seminar", "workshop",
    "presentation", "review", "standup", "sprint", "brainstorm",
    "interview", "exam", "test", "quiz", "office hours",
    "1:1", "one-on-one", "sync", "planning", "retro",
  ];
  return cognitiveKeywords.some((kw) => summaryLower.includes(kw));
}

// ---- Pre-Exam Taper ----

export interface TaperInput {
  blocks: { dayIndex: number; mode: string; plannedMinutes: number }[];
  examDate: Date;
  planStartDate: Date;
}

/**
 * Apply pre-exam taper: reduce study volume in the final 48h before the exam.
 * Based on athletic taper research (Mujika & Padilla 2003) adapted for cognition:
 * - Final 48h: reduce total volume by 40-50%
 * - Final 24h: max 1 short RETRIEVAL session (confidence-building review)
 * - Final 48h: shift all sessions to RETRIEVAL only (no new material)
 *
 * Returns a new blocks array with adjustments applied. Does not mutate input.
 */
export function applyPreExamTaper<T extends { dayIndex: number; mode: string; plannedMinutes: number }>(
  blocks: T[],
  examDate: Date,
  planStartDate: Date,
): T[] {
  const examTime = examDate.getTime();
  const planStartMs = planStartDate.getTime();
  const tapered: T[] = [];
  let hasSessionInFinal24h = false;

  // If exam is already in the past relative to plan start, skip tapering entirely
  if (examTime <= planStartMs) {
    return [...blocks];
  }

  for (const block of blocks) {
    // Compute block midday timestamp without creating intermediate Date objects
    const blockMiddayMs = planStartMs + block.dayIndex * 86400000 + 43200000; // +12h

    const hoursUntilExam = (examTime - blockMiddayMs) / 3600000;

    if (hoursUntilExam <= 0) {
      // Exam day or after — skip study sessions
      continue;
    }

    if (hoursUntilExam <= 24) {
      // Final 24h: only 1 short confidence-building retrieval
      if (hasSessionInFinal24h) continue;
      hasSessionInFinal24h = true;
      tapered.push({
        ...block,
        mode: "RETRIEVAL",
        plannedMinutes: Math.min(block.plannedMinutes, 25),
      });
    } else if (hoursUntilExam <= 48) {
      // Final 48h: reduce volume by 40%, shift to RETRIEVAL only
      tapered.push({
        ...block,
        mode: "RETRIEVAL",
        plannedMinutes: Math.round(block.plannedMinutes * 0.6),
      });
    } else {
      // Normal — keep as-is
      tapered.push({ ...block });
    }
  }

  return tapered;
}

// ---- Intraday Spacing ----

/**
 * Enforce minimum spacing between same-topic sessions on the same day.
 * If two sessions covering the same objectives are scheduled less than
 * minGapMinutes apart, the second one is shifted or flagged.
 *
 * Returns indices of blocks that violate spacing (caller should reschedule).
 */
export function findIntradaySpacingViolations(
  blocks: { dayIndex: number; topicScope: string; startMinuteOfDay?: number }[],
  minGapMinutes: number = 60,
): number[] {
  // Pre-compute word sets once to avoid recreating in O(n²) pair comparisons
  const wordSets = blocks.map((b) =>
    new Set(b.topicScope.toLowerCase().split(/[,\s]+/).filter((w) => w.length > 3)),
  );

  const violations: number[] = [];
  const dayGroups = new Map<number, number[]>();

  for (let i = 0; i < blocks.length; i++) {
    const day = blocks[i].dayIndex;
    if (!dayGroups.has(day)) dayGroups.set(day, []);
    dayGroups.get(day)!.push(i);
  }

  for (const indices of dayGroups.values()) {
    for (let i = 0; i < indices.length; i++) {
      for (let j = i + 1; j < indices.length; j++) {
        const idxA = indices[i];
        const idxB = indices[j];

        // Check topic overlap using pre-computed sets
        let hasOverlap = false;
        for (const w of wordSets[idxA]) {
          if (wordSets[idxB].has(w)) { hasOverlap = true; break; }
        }
        if (!hasOverlap) continue;

        const startA = blocks[idxA].startMinuteOfDay ?? 0;
        const startB = blocks[idxB].startMinuteOfDay ?? 0;
        if (Math.abs(startB - startA) < minGapMinutes) {
          violations.push(idxB);
        }
      }
    }
  }

  return violations;
}

// ---- Dynamic Session Duration ----

/**
 * Adjust planned session duration based on cognitive load of the mode.
 * High-load modes (RETRIEVAL, EXAM_SIM) are capped shorter to prevent
 * diminishing returns from cognitive fatigue.
 */
export function adjustDurationByMode(
  plannedMinutes: number,
  mode: string,
): number {
  const maxDuration = MAX_DURATION_BY_MODE[mode as SessionMode];
  if (!maxDuration) return plannedMinutes;
  return Math.max(MIN_SESSION_MINUTES, Math.min(plannedMinutes, maxDuration));
}

// ---- Scored Slot Fitting ----

export interface ScoredFitInput {
  blockDurationsMs: number[];
  blockModes: SessionMode[];
  freeSlots: TimeInterval[];
  chronotype: Chronotype;
  dayEvents: CalendarEvent[];
  bedtimeHour: number;
  /** Course name for class-matching (applied to all blocks). Optional. */
  courseName?: string;
  /** Per-block topic scopes for class-matching. Optional. */
  blockTopicScopes?: string[];
}

/**
 * Fit study blocks into free slots using cognitive scoring instead of greedy first-fit.
 *
 * For each block, scores all available slots and picks the best one.
 * Higher-priority blocks (by cognitive load) are placed first to get optimal slots.
 *
 * Returns scheduled time intervals in the same order as input blocks.
 */
export function fitBlocksScored(input: ScoredFitInput): (TimeInterval | null)[] {
  const { blockDurationsMs, blockModes, freeSlots, chronotype, dayEvents, bedtimeHour, courseName, blockTopicScopes } = input;

  // Track remaining capacity in each slot
  const slotStarts = freeSlots.map((s) => s.start);
  const slotEnds = freeSlots.map((s) => s.end);

  // Sort blocks by cognitive load (highest first) to give priority
  const indices = blockModes.map((_, i) => i);
  indices.sort((a, b) => {
    const loadA = MODE_COGNITIVE_LOAD[blockModes[a]] ?? 0.5;
    const loadB = MODE_COGNITIVE_LOAD[blockModes[b]] ?? 0.5;
    return loadB - loadA; // higher load first
  });

  const results: (TimeInterval | null)[] = new Array(blockDurationsMs.length).fill(null);

  for (const idx of indices) {
    const dur = blockDurationsMs[idx];
    const mode = blockModes[idx];

    let bestSlotIdx = -1;
    let bestScore = -1;

    for (let si = 0; si < slotStarts.length; si++) {
      const available = slotEnds[si] - slotStarts[si];
      if (available < dur) continue;

      const candidateSlot: TimeInterval = { start: slotStarts[si], end: slotStarts[si] + dur };
      const score = scoreSlot({
        slot: candidateSlot,
        mode,
        chronotype,
        dayEvents,
        bedtimeHour,
        courseName,
        topicScope: blockTopicScopes?.[idx],
      });

      if (score > bestScore) {
        bestScore = score;
        bestSlotIdx = si;
      }
    }

    if (bestSlotIdx >= 0) {
      const start = slotStarts[bestSlotIdx];
      const end = start + dur;
      results[idx] = { start, end };
      slotStarts[bestSlotIdx] = end; // consume portion
    }
  }

  return results;
}

// ---- Bedtime Estimation ----

/**
 * Estimate bedtime from calendar events. If the user has events ending late,
 * infer they sleep after the last event. Otherwise default to 23:00.
 */
export function estimateBedtime(events: CalendarEvent[]): number {
  if (events.length === 0) return 23;

  // Find the latest event end time across all events
  let latestHour = 0;
  for (const event of events) {
    const endHour = new Date(event.end).getHours();
    if (endHour < 4) {
      // After midnight — they sleep very late
      return Math.min(endHour + 1, 3);
    }
    if (endHour > latestHour) {
      latestHour = endHour;
    }
  }

  // Assume bedtime is ~1-2 hours after latest event, capped at 23 (11 PM)
  return Math.min(latestHour + 2, 23);
}
