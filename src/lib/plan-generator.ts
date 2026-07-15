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

function toObjectiveEntries(strs: string[]): { id: string; title: string }[] {
  return strs.map((s, i) => ({ id: `obj_${i}`, title: s }));
}

export function generatePlan(input: PlanGeneratorInput): PlanBlock[] {
  const { objectives, dailyCap, availability } = input;
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
    // Day 1: Retrieval pack B
    {
      dayIndex: 1,
      mode: "RETRIEVAL",
      scope: packB.join(", "),
      objs: packB,
      desiredMinutes: 80,
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
      objectives: toObjectiveEntries(item.objs),
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
