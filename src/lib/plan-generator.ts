import { SessionMode } from "./validation";
import { slugifyObjectiveTitle } from "./objective-keys";

export interface PlanBlock {
  dayIndex: number;
  mode: SessionMode;
  topicScope: string;
  objectives: { id: string; title: string }[];
  plannedMinutes: number;
  targetOutcome: {
    type?: string;
    prompt_count?: number;
    target_accuracy?: number;
    closed_book_required?: boolean;
  };
}

interface PlanGeneratorInput {
  objectives: string[];
  dailyCap: number;
  breakProtocol: string;
  availability: { start: string; end: string }[];
}

function splitIntoPacks(objectives: string[]): string[][] {
  const n = objectives.length;
  if (n <= 6) return [objectives];
  if (n <= 12) {
    const mid = Math.ceil(n / 2);
    return [objectives.slice(0, mid), objectives.slice(mid)];
  }
  if (n <= 20) {
    const size = Math.ceil(n / 3);
    return [
      objectives.slice(0, size),
      objectives.slice(size, size * 2),
      objectives.slice(size * 2),
    ];
  }
  const size = Math.ceil(n / 4);
  return [
    objectives.slice(0, size),
    objectives.slice(size, size * 2),
    objectives.slice(size * 2, size * 3),
    objectives.slice(size * 3),
  ];
}

function availableMinutes(avail: { start: string; end: string }): number {
  const [sh, sm] = avail.start.split(":").map(Number);
  const [eh, em] = avail.end.split(":").map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

function clampDuration(desired: number, cap: number, windowMinutes: number): number {
  const max = Math.min(cap, windowMinutes);
  return Math.max(15, Math.min(desired, max));
}

// Objective ids are slugs of their titles; the rule lives in objective-keys.
export { slugifyObjectiveTitle };

/**
 * Build a title -> id map for a whole plan's objectives. Ids are slugs of the
 * titles; when two distinct titles collide on the same slug, later ones get
 * a deterministic _2/_3/... suffix in first-seen order.
 */
export function buildObjectiveIdMap(titles: string[]): Map<string, string> {
  const idByTitle = new Map<string, string>();
  const used = new Set<string>();
  for (const title of titles) {
    if (idByTitle.has(title)) continue;
    const base = slugifyObjectiveTitle(title);
    let id = base;
    let n = 2;
    while (used.has(id)) {
      id = `${base}_${n}`;
      n += 1;
    }
    idByTitle.set(title, id);
    used.add(id);
  }
  return idByTitle;
}

function toObjectiveEntries(
  strs: string[],
  idByTitle: Map<string, string>,
): { id: string; title: string }[] {
  return strs.map((s) => ({
    id: idByTitle.get(s) ?? slugifyObjectiveTitle(s),
    title: s,
  }));
}

export function generatePlan(input: PlanGeneratorInput): PlanBlock[] {
  const { objectives, dailyCap, availability } = input;
  const objectiveIds = buildObjectiveIdMap(objectives);
  const packs = splitIntoPacks(objectives);
  const blocks: PlanBlock[] = [];

  const packA = packs[0];
  const packB = packs[1] || packs[0];
  const packC = packs[2] || packs[0];
  const packD = packs[3] || null;
  const allObjs = objectives;

  const schedule: {
    dayIndex: number;
    mode: SessionMode;
    scope: string;
    objs: string[];
    desiredMinutes: number;
    outcomeType?: string;
  }[] = [
    // Day 0: Diagnostic + Retrieval pack A
    {
      dayIndex: 0,
      mode: "RETRIEVAL",
      scope: packA.slice(0, 5).join(", "),
      objs: packA.slice(0, 5),
      desiredMinutes: 20,
      outcomeType: "diagnostic",
    },
    {
      dayIndex: 0,
      mode: "RETRIEVAL",
      scope: packA.join(", "),
      objs: packA,
      desiredMinutes: 70,
    },
    // Day 1: Worked examples for first exposure to pack B (Sweller & Cooper
    // 1985: novices learn more from studying solutions than problem solving),
    // then retrieval on the same material.
    {
      dayIndex: 1,
      mode: "WORKED_EXAMPLES",
      scope: packB.join(", "),
      objs: packB,
      desiredMinutes: 30,
    },
    {
      dayIndex: 1,
      mode: "RETRIEVAL",
      scope: packB.join(", "),
      objs: packB,
      desiredMinutes: 60,
    },
    // Day 2: Interleaved A+B
    {
      dayIndex: 2,
      mode: "INTERLEAVED_PRACTICE",
      scope: [...packA, ...packB].join(", "),
      objs: [...packA, ...packB],
      desiredMinutes: 70,
    },
    // Day 3: Retrieval pack C (or revisit A)
    {
      dayIndex: 3,
      mode: "RETRIEVAL",
      scope: packC.join(", "),
      objs: packC,
      desiredMinutes: 80,
    },
  ];

  // If there's a pack D, give it its own retrieval day and interleave with C+D
  if (packD) {
    schedule.push(
      {
        dayIndex: 4,
        mode: "RETRIEVAL",
        scope: packD.join(", "),
        objs: packD,
        desiredMinutes: 60,
      },
      {
        dayIndex: 4,
        mode: "INTERLEAVED_PRACTICE",
        scope: [...packC, ...packD].join(", "),
        objs: [...packC, ...packD],
        desiredMinutes: 50,
      },
    );
  } else {
    schedule.push({
      dayIndex: 4,
      mode: "INTERLEAVED_PRACTICE",
      scope: [...packB, ...packC].join(", "),
      objs: [...packB, ...packC],
      desiredMinutes: 70,
    });
  }

  schedule.push(
    // Day 5: Exam Sim + Error Repair
    {
      dayIndex: 5,
      mode: "EXAM_SIM",
      scope: allObjs.join(", "),
      objs: allObjs,
      desiredMinutes: 60,
    },
    {
      dayIndex: 5,
      mode: "ERROR_REPAIR",
      scope: allObjs.join(", "),
      objs: allObjs,
      desiredMinutes: 45,
    },
    // Day 6: Final mixed retrieval
    {
      dayIndex: 6,
      mode: "RETRIEVAL",
      scope: allObjs.join(", "),
      objs: allObjs,
      desiredMinutes: 90,
    },
  );

  // Track remaining minutes per day
  const dayRemaining = availability.map((a) =>
    Math.min(dailyCap, availableMinutes(a))
  );

  for (const item of schedule) {
    const window = availableMinutes(availability[item.dayIndex]);
    const remaining = dayRemaining[item.dayIndex];
    if (remaining < 15) continue; // skip if no time left

    const minutes = clampDuration(item.desiredMinutes, remaining, window);
    dayRemaining[item.dayIndex] -= minutes;

    const promptCount = Math.max(5, Math.round(minutes / 4));

    blocks.push({
      dayIndex: item.dayIndex,
      mode: item.mode,
      topicScope: item.scope,
      objectives: toObjectiveEntries(item.objs, objectiveIds),
      plannedMinutes: minutes,
      targetOutcome: {
        type: item.outcomeType,
        prompt_count: promptCount,
        target_accuracy: item.mode === "EXAM_SIM" ? 0.7 : 0.8,
        closed_book_required: item.mode === "RETRIEVAL" || item.mode === "EXAM_SIM",
      },
    });
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Laying blocks out in time
// ---------------------------------------------------------------------------

const QUARTER_HOUR_MS = 15 * 60 * 1000;

/** The next quarter hour at or after an instant (every real UTC offset is a multiple of 15 minutes). */
export function nextQuarterHour(ms: number): number {
  return Math.ceil(ms / QUARTER_HOUR_MS) * QUARTER_HOUR_MS;
}

export interface BlockPlacement {
  dayIndex: number;
  start: number;
  end: number;
}

/**
 * Times for blocks laid end to end in each day's study window, from the
 * window start. Day 0 is today: its blocks start no earlier than `earliest`
 * (now, rounded up), so a plan made in the evening never schedules sessions
 * that already passed. A day-0 block that no longer fits before today's
 * window ends moves to the first later day (up to `lastDayIndex`) with room
 * left in its window and daily cap, after that day's own blocks; with no room
 * anywhere it gets null. Blocks on other days keep their order and times.
 *
 * `window(dayIndex)` gives that day's window as instants (ms).
 */
export function layoutBlocks<B extends { dayIndex: number; plannedMinutes: number }>(
  blocks: readonly B[],
  options: {
    window: (dayIndex: number) => { start: number; end: number };
    earliest: number;
    dailyCapMinutes: number;
    lastDayIndex?: number;
  },
): (BlockPlacement | null)[] {
  const lastDayIndex = options.lastDayIndex ?? 6;
  const cursor = new Map<number, number>();
  const usedMinutes = new Map<number, number>();
  const placements: (BlockPlacement | null)[] = blocks.map(() => null);
  const overflow: number[] = [];

  const startOf = (day: number) => {
    const known = cursor.get(day);
    if (known !== undefined) return known;
    const start = options.window(day).start;
    return day === 0 ? Math.max(start, options.earliest) : start;
  };
  const place = (index: number, day: number, start: number) => {
    const minutes = blocks[index].plannedMinutes;
    const end = start + minutes * 60_000;
    placements[index] = { dayIndex: day, start, end };
    cursor.set(day, end);
    usedMinutes.set(day, (usedMinutes.get(day) ?? 0) + minutes);
  };

  blocks.forEach((block, index) => {
    const start = startOf(block.dayIndex);
    if (block.dayIndex === 0 && start + block.plannedMinutes * 60_000 > options.window(0).end) {
      overflow.push(index);
      return;
    }
    place(index, block.dayIndex, start);
  });

  for (const index of overflow) {
    const minutes = blocks[index].plannedMinutes;
    for (let day = 1; day <= lastDayIndex; day++) {
      const start = startOf(day);
      const fitsWindow = start + minutes * 60_000 <= options.window(day).end;
      const fitsCap = (usedMinutes.get(day) ?? 0) + minutes <= options.dailyCapMinutes;
      if (fitsWindow && fitsCap) {
        place(index, day, start);
        break;
      }
    }
  }

  return placements;
}

/**
 * Places blocks one day at a time with `fitDay`, which fits that day's
 * blocks into its free time (the Google Calendar path) and returns a slot or
 * null for each. A block with no room on its day rolls to the next day, after
 * that day's own blocks and within the daily cap, and keeps rolling until
 * `lastDayIndex`; one that fits nowhere gets null. Blocks that rolled keep
 * their original order, so the earliest goes first.
 */
export function rollBlocksForward<B extends { dayIndex: number; plannedMinutes: number }>(
  blocks: readonly B[],
  options: {
    lastDayIndex: number;
    dailyCapMinutes: number;
    fitDay: (dayIndex: number, dayBlocks: readonly B[]) => readonly ({ start: number; end: number } | null)[];
  },
): (BlockPlacement | null)[] {
  const placements: (BlockPlacement | null)[] = blocks.map(() => null);
  const byDay = new Map<number, number[]>();
  blocks.forEach((block, index) => {
    const list = byDay.get(block.dayIndex) ?? [];
    list.push(index);
    byDay.set(block.dayIndex, list);
  });

  let carried: number[] = [];
  for (let day = 0; day <= options.lastDayIndex; day++) {
    const own = byDay.get(day) ?? [];
    let used = own.reduce((sum, index) => sum + blocks[index].plannedMinutes, 0);
    const joining: number[] = [];
    const waiting: number[] = [];
    for (const index of carried) {
      const minutes = blocks[index].plannedMinutes;
      if (used + minutes <= options.dailyCapMinutes) {
        joining.push(index);
        used += minutes;
      } else {
        waiting.push(index);
      }
    }

    const dayIndexes = [...own, ...joining];
    if (dayIndexes.length === 0) {
      carried = waiting;
      continue;
    }
    const slots = options.fitDay(day, dayIndexes.map((index) => blocks[index]));
    const unplaced: number[] = [];
    dayIndexes.forEach((index, k) => {
      const slot = slots[k];
      if (slot) placements[index] = { dayIndex: day, start: slot.start, end: slot.end };
      else unplaced.push(index);
    });
    carried = [...unplaced, ...waiting].sort((a, b) => a - b);
  }

  return placements;
}

/**
 * Whether a YYYY-MM-DD string names a real calendar day. The API schema
 * only checks the shape, and Date.UTC rolls 2026-02-31 over to March 3 and
 * 2026-13-01 into the next year.
 */
export function isCalendarDay(key: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return false;
  const [y, m, d] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
