"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { getActiveCourse, setActiveCourse, MODE_LABELS } from "@/lib/client-utils";
import { apiGet } from "@/lib/client-api";

/** Pretty label for a session mode (e.g. "RETRIEVAL" → "Retrieval"). */
function modeLabel(mode: string): string {
  return MODE_LABELS[mode] || mode.replace(/_/g, " ");
}

/** Render a mastery key / objective slug (e.g. "photosynthesis_light_reactions") as a clean label. */
function prettifyObjectiveKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface CourseData {
  courseName: string;
  examNames: string[];
  docCount: number;
  processedDocCount: number;
  deckCount: number;
  dueCardCount: number;
  guideCount: number;
}

interface LearnData {
  courses: CourseData[];
  hasCourses: boolean;
}

interface Recommendation {
  next_session: {
    mode: string;
    objectives: string[];
    topic_scope: string;
    reason: string;
  };
  overdue_objectives: { objective_key: string; days_overdue: number }[];
  weak_objectives: { objective_key: string; last_accuracy: number | null }[];
  unresolved_errors: { count: number; recent_error_types: string[] };
  streak: number;
  plan_nudge: {
    plan_id: string;
    items: { session_id: string; start_time: string; message: string }[];
  } | null;
}

export default function LearnPage() {
  const [data, setData] = useState<LearnData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCourse, setSelectedCourseRaw] = useState<string | null>(null);
  const [recs, setRecs] = useState<Recommendation | null>(null);
  const [startingSession, setStartingSession] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // The core-loop entry point: turn the recommendation into a real session
  // and go study. Objective ids reuse the mastery keys so spaced repetition,
  // warm-ups, and pretest gating stay continuous with past sessions.
  const startRecommendedSession = async () => {
    if (!recs || !data || startingSession) return;
    const activeCourse = data.courses.find((c) => c.courseName === selectedCourse) || data.courses[0];
    if (!activeCourse) return;
    setStartingSession(true);
    setStartError(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course_name: activeCourse.courseName,
          exam_name: activeCourse.examNames[0] || "General",
          mode: recs.next_session.mode,
          topic_scope: recs.next_session.topic_scope || activeCourse.courseName,
          planned_minutes: 30,
          objectives: recs.next_session.objectives.length > 0
            ? recs.next_session.objectives.map((key) => ({ id: key, title: prettifyObjectiveKey(key) }))
            : undefined,
          target_outcome: { prompt_count: 10 },
          break_protocol: { type: "25_5", cycles: 1 },
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to create session");
      window.location.href = body.session_url || `/s/${body.session_id}`;
    } catch (e: unknown) {
      setStartError(e instanceof Error ? e.message : "Failed to create session");
      setStartingSession(false);
    }
  };
  const setSelectedCourse = (v: string | null) => { setSelectedCourseRaw(v); if (v) setActiveCourse(v); };

  useEffect(() => {
    apiGet("/api/learn")
      .then((d) => {
        setData(d);
        if (d.courses?.length > 0) {
          const active = getActiveCourse();
          const match = d.courses.find((c: CourseData) => c.courseName === active);
          setSelectedCourse(match ? match.courseName : d.courses[0].courseName);
        }
      })
      .catch(() => setData({ courses: [], hasCourses: false }))
      .finally(() => setLoading(false));
  }, []);

  // Fetch mastery-driven recommendations when selected course changes
  useEffect(() => {
    if (!selectedCourse) return;
    setRecs(null);
    apiGet(`/api/learn/recommendations?course_name=${encodeURIComponent(selectedCourse)}`)
      .then(setRecs)
      .catch(() => {}); // Graceful: recommendations are optional
  }, [selectedCourse]);

  if (loading) {
    return (
      <div style={mainStyle}>
        <style>{`@keyframes dash-spin { to { transform: rotate(360deg); } }`}</style>
        <h1 style={headingStyle}>Learn</h1>
        <div style={{ textAlign: "center", padding: "4rem 0", color: "var(--sb-text-muted)" }}>
          <div style={spinnerStyle} />
          <p style={{ marginTop: "1rem" }}>Loading your courses...</p>
        </div>
      </div>
    );
  }

  if (!data?.hasCourses) {
    return (
      <div style={mainStyle}>
        <h1 style={headingStyle}>Learn</h1>
        <div style={emptyCardStyle}>
          <p style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>No courses yet</p>
          <p style={{ color: "var(--sb-text-dim)", fontSize: "0.95rem", marginBottom: "1.5rem" }}>
            Upload your first document to start learning. Study Bot will help you create flashcards, guides, and practice sessions.
          </p>
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/plan" style={primaryBtnStyle}>Create a Study Plan</Link>
            <Link href="/flashcards" style={secondaryBtnStyle}>Go to Flashcards</Link>
          </div>
        </div>
      </div>
    );
  }

  const course = data.courses.find((c) => c.courseName === selectedCourse) || data.courses[0];

  return (
    <div style={mainStyle}>
      <h1 style={headingStyle}>Learn</h1>

      {/* Course selector */}
      {data.courses.length > 1 && (
        <div style={{ marginBottom: "1.5rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {data.courses.map((c) => (
            <button
              key={c.courseName}
              onClick={() => setSelectedCourse(c.courseName)}
              aria-pressed={selectedCourse === c.courseName}
              style={{
                padding: "0.5rem 1rem",
                fontSize: "0.9rem",
                fontFamily: "inherit",
                background: selectedCourse === c.courseName ? "var(--sb-bg-selected)" : "var(--sb-bg-card)",
                color: selectedCourse === c.courseName ? "var(--sb-primary)" : "var(--sb-text-muted)",
                border: `1px solid ${selectedCourse === c.courseName ? "var(--sb-primary)" : "var(--sb-border)"}`,
                borderRadius: "var(--sb-radius)",
                cursor: "pointer",
                fontWeight: selectedCourse === c.courseName ? 600 : 400,
              }}
            >
              {c.courseName}
              {c.dueCardCount > 0 && (
                <span style={{
                  marginLeft: "0.4rem",
                  background: "var(--sb-warning)",
                  color: "var(--sb-bg-darkest)",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  padding: "0.1rem 0.35rem",
                  borderRadius: "var(--sb-radius-lg)",
                }}>
                  {c.dueCardCount}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Course header */}
      <section style={{ marginBottom: "1.5rem" }}>
        <h2 style={courseNameStyle}>{course.courseName}</h2>
        {course.examNames.length > 0 && (
          <p style={{ color: "var(--sb-text-dim)", fontSize: "0.85rem", margin: "0.2rem 0 0" }}>
            Exams: {course.examNames.join(", ")}
          </p>
        )}
      </section>

      {/* Mastery-driven recommendation */}
      {recs && (
        <section style={{ ...recommendationStyle, borderLeftColor: "var(--sb-primary)" }}>
          {recs.streak > 0 && (
            <div style={{ fontSize: "0.8rem", color: "var(--sb-success)", marginBottom: "0.4rem", fontWeight: 600 }}>
              {recs.streak} day streak
            </div>
          )}
          {recs.plan_nudge && recs.plan_nudge.items.length > 0 && (
            <div style={{ marginBottom: "0.6rem", padding: "0.5rem 0.75rem", background: "var(--sb-bg-darkest)", borderRadius: "var(--sb-radius-sm)", border: "1px solid var(--sb-border)" }}>
              {recs.plan_nudge.items.map((item, i) => (
                <div key={i} style={{ fontSize: "0.85rem", color: "var(--sb-info)", marginBottom: i < recs.plan_nudge!.items.length - 1 ? "0.3rem" : 0 }}>
                  {item.message} ({new Date(item.start_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.4rem" }}>
            <span style={{ color: "var(--sb-primary)", fontWeight: 700, fontSize: "1.35rem", fontFamily: "var(--sb-font-display)" }}>
              Recommended: {modeLabel(recs.next_session.mode)}
            </span>
          </div>
          <p style={{ color: "var(--sb-text-dim)", fontSize: "0.95rem", margin: "0 0 0.75rem", lineHeight: 1.5, maxWidth: "60ch" }}>
            {recs.next_session.reason}
          </p>
          {recs.overdue_objectives.length > 0 && (
            <div style={{ fontSize: "0.8rem", color: "var(--sb-warning)", marginBottom: "0.3rem" }}>
              {recs.overdue_objectives.length} objective{recs.overdue_objectives.length !== 1 ? "s" : ""} overdue for review
            </div>
          )}
          {recs.unresolved_errors.count > 0 && (
            <div style={{ fontSize: "0.8rem", color: "var(--sb-error)", marginBottom: "0.3rem" }}>
              {recs.unresolved_errors.count} unresolved error{recs.unresolved_errors.count !== 1 ? "s" : ""} to repair
            </div>
          )}
          <button
            onClick={startRecommendedSession}
            disabled={startingSession}
            style={{ ...primaryBtnStyle, display: "inline-block", marginTop: "0.6rem", opacity: startingSession ? 0.6 : 1, cursor: startingSession ? "wait" : "pointer", border: "none" }}
          >
            {startingSession ? "Creating session..." : `Start ${modeLabel(recs.next_session.mode)} Session`}
          </button>
          {startError && (
            <p style={{ color: "var(--sb-error)", fontSize: "0.8rem", margin: "0.4rem 0 0" }}>{startError}</p>
          )}
        </section>
      )}

      {/* Quick actions — focused on what matters now */}
      <section style={{ marginBottom: "1.5rem" }}>
        <h3 style={sectionLabelStyle}>Quick Actions</h3>
        <div style={quickActionsGridStyle}>
          {course.deckCount > 0 && course.dueCardCount > 0 && (
            <Link href="/flashcards" style={{ ...quickActionStyle, borderLeftColor: "var(--sb-warning)" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: "var(--sb-text)", fontSize: "1.05rem" }}>Review Due Cards</div>
                <div style={{ fontSize: "0.85rem", color: "var(--sb-text-faint)", marginTop: "0.25rem", lineHeight: 1.4 }}>
                  {course.dueCardCount} card{course.dueCardCount !== 1 ? "s" : ""} ready for spaced repetition review
                </div>
              </div>
              <span style={{ color: "var(--sb-warning)", fontWeight: 700, fontSize: "0.9rem" }}>Review →</span>
            </Link>
          )}
          {course.processedDocCount > 0 && course.deckCount === 0 && (
            <Link href="/flashcards" style={{ ...quickActionStyle, borderLeftColor: "var(--sb-info)" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: "var(--sb-text)", fontSize: "1.05rem" }}>Generate Flashcards</div>
                <div style={{ fontSize: "0.85rem", color: "var(--sb-text-faint)", marginTop: "0.25rem", lineHeight: 1.4 }}>
                  {course.processedDocCount} doc{course.processedDocCount !== 1 ? "s" : ""} processed and ready
                </div>
              </div>
              <span style={{ color: "var(--sb-info)", fontWeight: 700, fontSize: "0.9rem" }}>Generate →</span>
            </Link>
          )}
          {course.guideCount === 0 && course.processedDocCount > 0 && (
            <Link href="/guides" style={{ ...quickActionStyle, borderLeftColor: "var(--sb-review)" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: "var(--sb-text)", fontSize: "1.05rem" }}>Create Study Guide</div>
                <div style={{ fontSize: "0.85rem", color: "var(--sb-text-faint)", marginTop: "0.25rem", lineHeight: 1.4 }}>
                  Key concepts, FAQs, or cheat sheets from your materials
                </div>
              </div>
              <span style={{ color: "var(--sb-review)", fontWeight: 700, fontSize: "0.9rem" }}>Create →</span>
            </Link>
          )}
          <Link href="/chat" style={{ ...quickActionStyle, borderLeftColor: "var(--sb-success)" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, color: "var(--sb-text)", fontSize: "1.05rem" }}>Ask a Question</div>
              <div style={{ fontSize: "0.85rem", color: "var(--sb-text-faint)", marginTop: "0.25rem", lineHeight: 1.4 }}>
                Chat with your {course.courseName} materials
              </div>
            </div>
            <span style={{ color: "var(--sb-success)", fontWeight: 700, fontSize: "0.9rem" }}>Chat →</span>
          </Link>
          {course.dueCardCount === 0 && course.deckCount > 0 && (
            <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "1rem", color: "var(--sb-success)", fontSize: "0.9rem", background: "var(--sb-bg-done)", borderRadius: "var(--sb-radius)", border: "1px solid var(--sb-border-done)" }}>
              All caught up! No cards due for review right now.
            </div>
          )}
        </div>
      </section>

      {/* Suggested learning path — onboarding scaffolding for new courses.
          Once materials are uploaded and the first deck exists, the user has
          found the core loop and this checklist just repeats the nav. */}
      {!(course.processedDocCount > 0 && course.deckCount > 0) && (
      <section style={{ marginBottom: "1.5rem" }}>
        <h3 style={sectionLabelStyle}>Suggested Learning Path</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          <LearningStep
            step={1}
            title="Upload Course Materials"
            description="Add your lecture notes, textbooks, or slides"
            done={course.processedDocCount > 0}
            href="/flashcards"
          />
          <LearningStep
            step={2}
            title="Generate Flashcards"
            description="Create study decks from your documents"
            done={course.deckCount > 0}
            href="/flashcards"
          />
          <LearningStep
            step={3}
            title="Review & Master Cards"
            description="Use spaced repetition to build long-term memory"
            done={course.dueCardCount === 0 && course.deckCount > 0}
            href="/flashcards"
          />
          <LearningStep
            step={4}
            title="Generate Study Guides"
            description="Get key concepts, FAQs, and cheat sheets"
            done={course.guideCount > 0}
            href="/guides"
          />
          <LearningStep
            step={5}
            title="Practice with Sessions"
            description="Schedule timed practice and exam simulations"
            done={false}
            href="/plan"
          />
        </div>
      </section>
      )}
    </div>
  );
}

// ---- Learning Step Component ----

function LearningStep({ step, title, description, done, href }: {
  step: number;
  title: string;
  description: string;
  done: boolean;
  href: string;
}) {
  return (
    <Link href={href} style={{
      display: "flex",
      alignItems: "center",
      gap: "0.75rem",
      padding: "1rem 1.25rem",
      background: done ? "var(--sb-bg-done)" : "var(--sb-bg-card)",
      border: `1px solid ${done ? "var(--sb-border-done)" : "var(--sb-border)"}`,
      borderRadius: "var(--sb-radius)",
      textDecoration: "none",
      cursor: "pointer",
    }}>
      <div style={{
        width: 28,
        height: 28,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: done ? "var(--sb-success)" : "var(--sb-border)",
        color: done ? "var(--sb-bg-darkest)" : "var(--sb-text-muted)",
        fontSize: "0.8rem",
        fontWeight: 700,
        flexShrink: 0,
      }}>
        {done ? "\u2713" : step}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{
          fontSize: "0.95rem",
          color: done ? "var(--sb-success)" : "var(--sb-text)",
          fontWeight: 600,
          textDecoration: done ? "line-through" : "none",
          opacity: done ? 0.7 : 1,
        }}>
          {title}
        </div>
        <div style={{ fontSize: "0.75rem", color: "var(--sb-text-dim)", marginTop: "0.1rem" }}>
          {description}
        </div>
      </div>
    </Link>
  );
}

// ---- Styles ----

const mainStyle: React.CSSProperties = {
  maxWidth: 1100,
  margin: "0 auto",
  padding: "1.5rem clamp(24px, 4vw, 32px)",
  fontFamily: "var(--sb-font-body)",
  color: "var(--sb-text)",
  backgroundColor: "var(--sb-bg)",
  minHeight: "100vh",
};

const headingStyle: React.CSSProperties = {
  fontSize: "2rem",
  margin: "0 0 1.5rem",
  color: "var(--sb-primary)",
  fontWeight: 700,
  fontFamily: "var(--sb-font-display)",
};

const courseNameStyle: React.CSSProperties = {
  fontSize: "1.4rem",
  color: "var(--sb-text)",
  fontWeight: 700,
  margin: 0,
  fontFamily: "var(--sb-font-display)",
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: "0.85rem",
  color: "var(--sb-text-muted)",
  marginBottom: "0.75rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const recommendationStyle: React.CSSProperties = {
  background: "var(--sb-bg-selected)",
  border: "1px solid var(--sb-border)",
  borderLeft: "3px solid var(--sb-border)",
  borderRadius: "var(--sb-radius)",
  padding: "1.5rem clamp(1.25rem, 3vw, 2rem)",
  marginBottom: "1.5rem",
  boxShadow: "var(--sb-shadow-card)",
};

const quickActionsGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
  gap: 16,
};

const quickActionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem",
  padding: "1.25rem 1.5rem",
  background: "var(--sb-bg-card)",
  border: "1px solid var(--sb-border)",
  borderLeft: "3px solid var(--sb-border)",
  borderRadius: "var(--sb-radius)",
  textDecoration: "none",
  cursor: "pointer",
  boxShadow: "var(--sb-shadow-card)",
};

const emptyCardStyle: React.CSSProperties = {
  padding: "3rem 2rem",
  border: "1px dashed var(--sb-border-done)",
  borderRadius: "var(--sb-radius-lg)",
  textAlign: "center",
  color: "var(--sb-text-secondary)",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "0.7rem 1.4rem",
  fontSize: "1rem",
  background: "var(--sb-primary)",
  color: "var(--sb-bg-darkest)",
  border: "none",
  borderRadius: "var(--sb-radius)",
  fontWeight: 700,
  fontFamily: "inherit",
  textDecoration: "none",
  cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "0.7rem 1.25rem",
  fontSize: "0.95rem",
  background: "transparent",
  color: "var(--sb-primary)",
  border: "1px solid var(--sb-primary)",
  borderRadius: "var(--sb-radius)",
  fontWeight: 600,
  fontFamily: "inherit",
  textDecoration: "none",
  cursor: "pointer",
};

const spinnerStyle: React.CSSProperties = {
  width: "32px",
  height: "32px",
  border: "3px solid var(--sb-border)",
  borderTop: "3px solid var(--sb-primary)",
  borderRadius: "50%",
  margin: "0 auto",
  animation: "dash-spin 0.8s linear infinite",
};
