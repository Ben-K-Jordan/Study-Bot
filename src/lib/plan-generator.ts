import { SessionMode } from "./validation";

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

/**
 * Derive a stable objective id from its title. The same title always yields
 * the same id, so an objective keeps one identity across every block it
 * appears in (SM-2 mastery rows and feedback anchors are keyed by this id).
 */
export function slugifyObjectiveTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60)
    .replace(/_+$/g, "");
  return slug || "objective";
}

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
