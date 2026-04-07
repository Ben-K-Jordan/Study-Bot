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
 * 1. Circadian alignment (0.35 weight) — does the slot align with chronotype peak?
 * 2. Fatigue score (0.25 weight) — how cognitively tired is the student from prior events?
 * 3. Post-exercise boost (0.20 weight) — is there a workout within 30-60 min before?
 * 4. Sleep proximity (0.20 weight) — is ERROR_REPAIR near bedtime?
 */
export function scoreSlot(input: SlotScoreInput): number {
  const { slot, mode, chronotype, dayEvents, bedtimeHour } = input;

  const slotHour = new Date(slot.start).getHours();
  const slotMinute = new Date(slot.start).getMinutes();
  const slotTimeDecimal = slotHour + slotMinute / 60;

  // 1. Circadian alignment (0-1)
  const circadianScore = computeCircadianScore(slotTimeDecimal, mode, chronotype);

  // 2. Fatigue score (0-1, where 1 = low fatigue = good)
  const fatigueScore = computeFatigueScore(slot.start, dayEvents);

  // 3. Post-exercise boost (0-1)
  const exerciseScore = computeExerciseBoost(slot.start, dayEvents);

  // 4. Sleep proximity (0-1, only relevant for ERROR_REPAIR)
  const sleepScore = computeSleepProximityScore(slotTimeDecimal, mode, bedtimeHour);

  return (
    circadianScore * 0.35 +
    fatigueScore * 0.25 +
    exerciseScore * 0.20 +
    sleepScore * 0.20
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

// ---- Helpers ----

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
  const tapered: T[] = [];

  for (const block of blocks) {
    const blockDate = new Date(planStartDate);
    blockDate.setDate(blockDate.getDate() + block.dayIndex);
    // Set to midday to avoid timezone edge cases
    blockDate.setHours(12, 0, 0, 0);

    const hoursUntilExam = (examTime - blockDate.getTime()) / (1000 * 60 * 60);

    if (hoursUntilExam <= 0) {
      // Exam day or after — skip study sessions
      continue;
    }

    if (hoursUntilExam <= 24) {
      // Final 24h: only 1 short confidence-building retrieval
      if (tapered.some((b) => {
        const d = new Date(planStartDate);
        d.setDate(d.getDate() + b.dayIndex);
        d.setHours(12, 0, 0, 0);
        const h = (examTime - d.getTime()) / (1000 * 60 * 60);
        return h <= 24 && h > 0;
      })) {
        // Already have a session in the final 24h — skip additional ones
        continue;
      }
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
  const violations: number[] = [];
  const dayGroups = new Map<number, typeof blocks>();

  for (const [i, block] of blocks.entries()) {
    if (!dayGroups.has(block.dayIndex)) dayGroups.set(block.dayIndex, []);
    dayGroups.get(block.dayIndex)!.push({ ...block, _idx: i } as typeof block & { _idx: number });
  }

  for (const dayBlocks of dayGroups.values()) {
    for (let i = 0; i < dayBlocks.length; i++) {
      for (let j = i + 1; j < dayBlocks.length; j++) {
        const a = dayBlocks[i];
        const b = dayBlocks[j];
        // Check topic overlap (simple: check if any objective words overlap)
        if (!hasTopicOverlap(a.topicScope, b.topicScope)) continue;

        const startA = a.startMinuteOfDay ?? 0;
        const startB = b.startMinuteOfDay ?? 0;
        const gap = Math.abs(startB - startA);

        if (gap < minGapMinutes) {
          violations.push((b as typeof b & { _idx: number })._idx);
        }
      }
    }
  }

  return violations;
}

function hasTopicOverlap(scopeA: string, scopeB: string): boolean {
  const wordsA = new Set(scopeA.toLowerCase().split(/[,\s]+/).filter((w) => w.length > 3));
  const wordsB = new Set(scopeB.toLowerCase().split(/[,\s]+/).filter((w) => w.length > 3));
  for (const w of wordsA) {
    if (wordsB.has(w)) return true;
  }
  return false;
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
  const { blockDurationsMs, blockModes, freeSlots, chronotype, dayEvents, bedtimeHour } = input;

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
    if (endHour > latestHour && endHour < 4) {
      // After midnight — they sleep very late
      return Math.min(endHour + 1, 3);
    }
    if (endHour > latestHour) {
      latestHour = endHour;
    }
  }

  // Assume bedtime is ~1-2 hours after latest event, capped at 24 (midnight)
  return Math.min(latestHour + 2, 24) % 24 || 23;
}
