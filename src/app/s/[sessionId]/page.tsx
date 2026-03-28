import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";

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
  });

  if (!session) {
    notFound();
  }

  const modeLabel = MODE_LABELS[session.mode] ?? session.mode;
  const outcome = session.targetOutcome as Record<string, unknown> | null;
  const breaks = session.breakProtocol as Record<string, unknown> | null;

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "2rem 1rem", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>
        {session.courseName} | {session.examName}
      </h1>
      <p style={{ color: "#666", marginBottom: "1.5rem" }}>
        {modeLabel}: {session.topicScope}
      </p>

      <section style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>Target Outcome</h2>
        {outcome ? (
          <ul style={{ paddingLeft: "1.25rem" }}>
            {outcome.target_accuracy != null && outcome.prompt_count != null && (
              <li>
                Score &ge; {((outcome.target_accuracy as number) * 100).toFixed(0)}% on{" "}
                {outcome.prompt_count as number} prompts
              </li>
            )}
            {Boolean(outcome.closed_book_required) && <li>Closed-book first pass</li>}
            {Array.isArray(outcome.deliverables) &&
              (outcome.deliverables as string[]).map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        ) : (
          <p style={{ color: "#999" }}>No target outcome set.</p>
        )}
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>Break Protocol</h2>
        {breaks ? (
          <p>
            {breaks.type === "50_10" ? "50 min work / 10 min break" : String(breaks.type)}
            {breaks.cycles ? `, ${breaks.cycles} cycle(s)` : ""}
          </p>
        ) : (
          <p style={{ color: "#999" }}>No break protocol set.</p>
        )}
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>Details</h2>
        <p>{session.plannedMinutes} minutes planned</p>
      </section>

      <button
        style={{
          padding: "0.75rem 2rem",
          fontSize: "1rem",
          backgroundColor: "#000",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        Start Session
      </button>
    </main>
  );
}
