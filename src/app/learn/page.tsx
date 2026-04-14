"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { getOrCreateUserId } from "@/lib/client-utils";

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
  weeklyXp: number;
}

export default function LearnPage() {
  const [data, setData] = useState<LearnData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);

  useEffect(() => {
    const userId = getOrCreateUserId();
    fetch("/api/learn", { headers: { "X-User-Id": userId } })
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        if (d.courses?.length > 0) setSelectedCourse(d.courses[0].courseName);
      })
      .catch(() => setData({ courses: [], hasCourses: false, weeklyXp: 0 }))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <main style={mainStyle}>
        <style>{`@keyframes dash-spin { to { transform: rotate(360deg); } }`}</style>
        <h1 style={headingStyle}>Learn</h1>
        <div style={{ textAlign: "center", padding: "4rem 0", color: "#a89a82" }}>
          <div style={spinnerStyle} />
          <p style={{ marginTop: "1rem" }}>Loading your courses...</p>
        </div>
      </main>
    );
  }

  if (!data?.hasCourses) {
    return (
      <main style={mainStyle}>
        <h1 style={headingStyle}>Learn</h1>
        <div style={emptyCardStyle}>
          <p style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>No courses yet</p>
          <p style={{ color: "#7a7060", fontSize: "0.95rem", marginBottom: "1.5rem" }}>
            Upload your first document to start learning. Study Bot will help you create flashcards, guides, and practice sessions.
          </p>
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/plan" style={primaryBtnStyle}>Create a Study Plan</Link>
            <Link href="/flashcards" style={secondaryBtnStyle}>Go to Flashcards</Link>
          </div>
        </div>
      </main>
    );
  }

  const course = data.courses.find((c) => c.courseName === selectedCourse) || data.courses[0];

  return (
    <main style={mainStyle}>
      <h1 style={headingStyle}>Learn</h1>

      {/* Course selector */}
      {data.courses.length > 1 && (
        <div style={{ marginBottom: "1.5rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {data.courses.map((c) => (
            <button
              key={c.courseName}
              onClick={() => setSelectedCourse(c.courseName)}
              style={{
                padding: "0.4rem 0.9rem",
                fontSize: "0.9rem",
                fontFamily: "inherit",
                background: selectedCourse === c.courseName ? "#f0dc4e22" : "#334d33",
                color: selectedCourse === c.courseName ? "#f0dc4e" : "#a89a82",
                border: `1px solid ${selectedCourse === c.courseName ? "#f0dc4e66" : "#4a6a4a"}`,
                borderRadius: 6,
                cursor: "pointer",
                fontWeight: selectedCourse === c.courseName ? 600 : 400,
              }}
            >
              {c.courseName}
              {c.dueCardCount > 0 && (
                <span style={{
                  marginLeft: "0.4rem",
                  background: "#e8a040",
                  color: "#1f2e1f",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  padding: "0.1rem 0.35rem",
                  borderRadius: 8,
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
          <p style={{ color: "#7a7060", fontSize: "0.85rem", margin: "0.2rem 0 0" }}>
            Exams: {course.examNames.join(", ")}
          </p>
        )}
      </section>

      {/* Course stats row */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.5rem", marginBottom: "1.5rem" }}>
        <div style={miniStatStyle}>
          <span style={miniStatNumStyle}>{course.docCount}</span>
          <span style={miniStatLabelStyle}>Docs</span>
        </div>
        <div style={miniStatStyle}>
          <span style={{ ...miniStatNumStyle, color: "#7ec8e3" }}>{course.deckCount}</span>
          <span style={miniStatLabelStyle}>Decks</span>
        </div>
        <div style={miniStatStyle}>
          <span style={{ ...miniStatNumStyle, color: course.dueCardCount > 0 ? "#e8a040" : "#88cc88" }}>
            {course.dueCardCount}
          </span>
          <span style={miniStatLabelStyle}>Due Cards</span>
        </div>
        <div style={miniStatStyle}>
          <span style={{ ...miniStatNumStyle, color: "#c4a0ff" }}>{course.guideCount}</span>
          <span style={miniStatLabelStyle}>Guides</span>
        </div>
      </section>

      {/* Smart recommendations */}
      {course.dueCardCount > 0 && (
        <section style={recommendationStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.3rem" }}>
            <span style={{ color: "#e8a040", fontSize: "1.1rem" }}>!</span>
            <span style={{ color: "#e8a040", fontWeight: 600, fontSize: "0.9rem" }}>
              {course.dueCardCount} card{course.dueCardCount !== 1 ? "s" : ""} due for review
            </span>
          </div>
          <p style={{ color: "#7a7060", fontSize: "0.8rem", margin: 0 }}>
            Reviewing now helps retain information using spaced repetition.
          </p>
        </section>
      )}

      {/* Action cards */}
      <section style={{ marginBottom: "1.5rem" }}>
        <h3 style={sectionLabelStyle}>Study Actions</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          <Link href="/flashcards" style={actionCardStyle}>
            <span style={{ fontSize: "1.5rem", marginBottom: "0.3rem" }}>{"\u{1F0CF}"}</span>
            <span style={actionTitleStyle}>Review Flashcards</span>
            <span style={actionDescStyle}>
              {course.dueCardCount > 0
                ? `${course.dueCardCount} cards due`
                : course.deckCount > 0
                  ? "All caught up!"
                  : "Generate a deck first"}
            </span>
          </Link>

          <Link href="/flashcards" style={actionCardStyle}>
            <span style={{ fontSize: "1.5rem", marginBottom: "0.3rem" }}>{"\u2728"}</span>
            <span style={actionTitleStyle}>Generate Flashcards</span>
            <span style={actionDescStyle}>
              {course.processedDocCount > 0
                ? "From your documents"
                : "Upload docs first"}
            </span>
          </Link>

          <Link href="/guides" style={actionCardStyle}>
            <span style={{ fontSize: "1.5rem", marginBottom: "0.3rem" }}>{"\u{1F4D6}"}</span>
            <span style={actionTitleStyle}>Study Guides</span>
            <span style={actionDescStyle}>
              {course.guideCount > 0
                ? `${course.guideCount} guide${course.guideCount !== 1 ? "s" : ""} available`
                : "Generate your first guide"}
            </span>
          </Link>

          <Link href="/chat" style={actionCardStyle}>
            <span style={{ fontSize: "1.5rem", marginBottom: "0.3rem" }}>{"\u{1F4AC}"}</span>
            <span style={actionTitleStyle}>Ask a Question</span>
            <span style={actionDescStyle}>Chat with your course materials</span>
          </Link>

          <Link href="/plan" style={actionCardStyle}>
            <span style={{ fontSize: "1.5rem", marginBottom: "0.3rem" }}>{"\u{1F4C5}"}</span>
            <span style={actionTitleStyle}>Study Plan</span>
            <span style={actionDescStyle}>Schedule practice sessions</span>
          </Link>

          <Link href="/" style={actionCardStyle}>
            <span style={{ fontSize: "1.5rem", marginBottom: "0.3rem" }}>{"\u{1F3C6}"}</span>
            <span style={actionTitleStyle}>Dashboard</span>
            <span style={actionDescStyle}>View your progress & XP</span>
          </Link>
        </div>
      </section>

      {/* Suggested learning path */}
      <section style={{ marginBottom: "1.5rem" }}>
        <h3 style={sectionLabelStyle}>Suggested Learning Path</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
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

      {/* Weekly XP */}
      {data.weeklyXp > 0 && (
        <div style={{ textAlign: "center", color: "#7a7060", fontSize: "0.8rem", marginTop: "1rem" }}>
          {data.weeklyXp} XP earned this week
        </div>
      )}
    </main>
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
      padding: "0.75rem 1rem",
      background: done ? "#2d4a2d" : "#334d33",
      border: `1px solid ${done ? "#5a8a5a" : "#4a6a4a"}`,
      borderRadius: 6,
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
        background: done ? "#88cc88" : "#4a6a4a",
        color: done ? "#1f2e1f" : "#a89a82",
        fontSize: "0.8rem",
        fontWeight: 700,
        flexShrink: 0,
      }}>
        {done ? "\u2713" : step}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{
          fontSize: "0.95rem",
          color: done ? "#88cc88" : "#e8dcc8",
          fontWeight: 600,
          textDecoration: done ? "line-through" : "none",
          opacity: done ? 0.7 : 1,
        }}>
          {title}
        </div>
        <div style={{ fontSize: "0.75rem", color: "#7a7060", marginTop: "0.1rem" }}>
          {description}
        </div>
      </div>
    </Link>
  );
}

// ---- Styles ----

const mainStyle: React.CSSProperties = {
  maxWidth: 700,
  margin: "0 auto",
  padding: "1.5rem 1rem",
  fontFamily: "var(--font-body), 'Patrick Hand', cursive",
  color: "#e8dcc8",
  backgroundColor: "#2a3d2a",
  minHeight: "100vh",
};

const headingStyle: React.CSSProperties = {
  fontSize: "2rem",
  margin: "0 0 1.5rem",
  color: "#f0dc4e",
  fontWeight: 700,
  fontFamily: "var(--font-display), 'Caveat', cursive",
};

const courseNameStyle: React.CSSProperties = {
  fontSize: "1.4rem",
  color: "#e8dcc8",
  fontWeight: 700,
  margin: 0,
  fontFamily: "var(--font-display), 'Caveat', cursive",
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: "0.85rem",
  color: "#a89a82",
  marginBottom: "0.75rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const miniStatStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  padding: "0.75rem 0.5rem",
  border: "1px solid #4a6a4a",
  borderRadius: 6,
  backgroundColor: "#334d33",
};

const miniStatNumStyle: React.CSSProperties = {
  fontSize: "1.3rem",
  fontWeight: 700,
  color: "#f0dc4e",
  lineHeight: 1,
  fontFamily: "var(--font-display), 'Caveat', cursive",
};

const miniStatLabelStyle: React.CSSProperties = {
  fontSize: "0.65rem",
  color: "#7a7060",
  marginTop: "0.3rem",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const recommendationStyle: React.CSSProperties = {
  background: "#3d4a2d",
  border: "1px solid #5a6a3a",
  borderRadius: 6,
  padding: "0.75rem 1rem",
  marginBottom: "1.5rem",
};

const actionCardStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  textAlign: "center",
  padding: "1.25rem 0.75rem",
  background: "#334d33",
  border: "1px solid #4a6a4a",
  borderRadius: 8,
  textDecoration: "none",
  cursor: "pointer",
  transition: "border-color 0.15s, background 0.15s",
};

const actionTitleStyle: React.CSSProperties = {
  fontSize: "0.9rem",
  fontWeight: 600,
  color: "#e8dcc8",
  marginBottom: "0.2rem",
};

const actionDescStyle: React.CSSProperties = {
  fontSize: "0.7rem",
  color: "#7a7060",
};

const emptyCardStyle: React.CSSProperties = {
  padding: "3rem 2rem",
  border: "1px dashed #5a7a5a",
  borderRadius: 8,
  textAlign: "center",
  color: "#c8bca8",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "0.6rem 1.25rem",
  fontSize: "0.95rem",
  background: "#f0dc4e",
  color: "#1f2e1f",
  border: "none",
  borderRadius: 6,
  fontWeight: 700,
  fontFamily: "inherit",
  textDecoration: "none",
  cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "0.6rem 1.25rem",
  fontSize: "0.95rem",
  background: "transparent",
  color: "#f0dc4e",
  border: "1px solid #f0dc4e44",
  borderRadius: 6,
  fontWeight: 600,
  fontFamily: "inherit",
  textDecoration: "none",
  cursor: "pointer",
};

const spinnerStyle: React.CSSProperties = {
  width: "32px",
  height: "32px",
  border: "3px solid #4a6a4a",
  borderTop: "3px solid #f0dc4e",
  borderRadius: "50%",
  margin: "0 auto",
  animation: "dash-spin 0.8s linear infinite",
};
