/**
 * Bodies for POST /api/sessions when a weak spot starts a session directly.
 * They mirror what the Study page sends so the runner sees the same shape.
 */

export interface SessionRequest {
  course_name: string;
  exam_name: string;
  mode: "RETRIEVAL" | "ERROR_REPAIR";
  topic_scope: string;
  planned_minutes: number;
  objectives?: { id: string; title: string }[];
  target_outcome: { prompt_count: number };
  break_protocol: { type: string; cycles: number };
}

const ONE_BLOCK = { type: "25_5", cycles: 1 };

/** Error repair for one course: its unresolved errors, confident ones first. */
export function repairRequest(courseName: string, examName: string, errorCount: number): SessionRequest {
  return {
    course_name: courseName,
    exam_name: examName,
    mode: "ERROR_REPAIR",
    topic_scope: "Unresolved errors",
    planned_minutes: 30,
    target_outcome: { prompt_count: Math.max(1, Math.min(errorCount, 10)) },
    break_protocol: ONE_BLOCK,
  };
}

/** Retrieval practice on one topic. */
export function practiceRequest(
  courseName: string,
  examName: string,
  topic: { key: string; title: string },
): SessionRequest {
  return {
    course_name: courseName,
    exam_name: examName,
    mode: "RETRIEVAL",
    topic_scope: topic.title,
    planned_minutes: 30,
    objectives: [{ id: topic.key, title: topic.title }],
    target_outcome: { prompt_count: 8 },
    break_protocol: ONE_BLOCK,
  };
}
