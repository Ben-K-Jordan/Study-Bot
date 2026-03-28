import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { SessionRunner } from "./session-runner";

interface SessionPageProps {
  params: { sessionId: string };
}

const MODE_LABELS: Record<string, string> = {
  RETRIEVAL: "Retrieval",
  INTERLEAVED_PRACTICE: "Interleaved Practice",
  ERROR_REPAIR: "Error Repair",
  EXAM_SIM: "Exam Sim",
  WORKED_EXAMPLES: "Worked Examples",
  OFFICE_HOURS_PREP: "Office Hours Prep",
};

export default async function SessionPage({ params }: SessionPageProps) {
  const { sessionId } = await params;

  const session = await prisma.session.findUnique({
    where: { sessionId },
    include: {
      runs: {
        where: { status: { in: ["CREATED", "ACTIVE"] } },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!session) {
    notFound();
  }

  const modeLabel = MODE_LABELS[session.mode] ?? session.mode;
  const outcome = session.targetOutcome as Record<string, unknown> | null;
  const breaks = session.breakProtocol as Record<string, unknown> | null;
  const objectives = session.objectives as { id: string; title: string }[] | null;

  // Check for most recent completed run for summary display
  const lastCompletedRun = await prisma.sessionRun.findFirst({
    where: { sessionId: session.sessionId, status: "COMPLETED" },
    orderBy: { endedAt: "desc" },
  });

  const sessionData = {
    session_id: session.sessionId,
    course_name: session.courseName,
    exam_name: session.examName,
    mode: session.mode,
    mode_label: modeLabel,
    topic_scope: session.topicScope,
    planned_minutes: session.plannedMinutes,
    target_outcome: outcome,
    break_protocol: breaks,
    objectives,
    has_active_run: session.runs.length > 0,
    active_run_id: session.runs[0]?.runId ?? null,
    last_completed_run: lastCompletedRun
      ? {
          run_id: lastCompletedRun.runId,
          metrics: lastCompletedRun.metrics as Record<string, unknown>,
          ended_at: lastCompletedRun.endedAt?.toISOString() ?? null,
        }
      : null,
  };

  return <SessionRunner session={sessionData} />;
}
