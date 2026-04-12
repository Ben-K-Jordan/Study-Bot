"use client";

import { useState, useEffect, useCallback } from "react";
import { getOrCreateUserId } from "@/lib/client-utils";

// --- Types ---

type GuideType = "KEY_CONCEPTS" | "FAQ" | "CHEAT_SHEET";

interface GuideSection {
  concept?: string;
  explanation?: string;
  importance?: string;
  question?: string;
  answer?: string;
  topic?: string;
  content?: string;
}

interface StudyGuide {
  id: string;
  course_name: string;
  exam_name: string | null;
  guide_type: GuideType;
  title: string;
  sections: GuideSection[];
  created_at: string;
}

interface CourseOption {
  course_name: string;
  exam_name?: string;
  doc_count: number;
}

// --- API helpers ---

async function apiGet(url: string) {
  const res = await fetch(url, {
    headers: { "X-User-Id": getOrCreateUserId() },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function apiPost(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": getOrCreateUserId(),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

const GUIDE_TYPES: { value: GuideType; label: string; description: string }[] = [
  { value: "KEY_CONCEPTS", label: "Key Concepts", description: "Important concepts with explanations" },
  { value: "FAQ", label: "FAQ", description: "Common questions and detailed answers" },
  { value: "CHEAT_SHEET", label: "Cheat Sheet", description: "Quick reference for exam review" },
];

export default function GuidesPage() {
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<string>("");
  const [guides, setGuides] = useState<StudyGuide[]>([]);
  const [generating, setGenerating] = useState(false);
  const [selectedType, setSelectedType] = useState<GuideType>("KEY_CONCEPTS");
  const [expandedGuide, setExpandedGuide] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch available courses on mount
  useEffect(() => {
    apiGet("/api/content/documents?namespace=COURSE").then((data) => {
      if (data.documents) {
        const courseMap = new Map<string, CourseOption>();
        for (const doc of data.documents as { course_name: string; exam_name: string | null }[]) {
          if (!doc.course_name) continue;
          const key = doc.exam_name
            ? `${doc.course_name}||${doc.exam_name}`
            : doc.course_name;
          const existing = courseMap.get(key);
          if (existing) {
            existing.doc_count++;
          } else {
            courseMap.set(key, {
              course_name: doc.course_name,
              exam_name: doc.exam_name || undefined,
              doc_count: 1,
            });
          }
        }
        const options = Array.from(courseMap.values());
        setCourses(options);
        if (options.length > 0) {
          const first = options[0];
          const val = first.exam_name
            ? `${first.course_name}||${first.exam_name}`
            : first.course_name;
          setSelectedCourse(val);
        }
      }
    }).catch(() => {});
  }, []);

  // Fetch existing guides when course changes
  const fetchGuides = useCallback(async () => {
    if (!selectedCourse) return;
    const [courseName, examName] = selectedCourse.split("||");
    const params = new URLSearchParams({ course_name: courseName });
    if (examName) params.set("exam_name", examName);
    const data = await apiGet(`/api/guides?${params.toString()}`);
    if (data.guides) setGuides(data.guides);
  }, [selectedCourse]);

  useEffect(() => {
    fetchGuides().catch(() => {});
  }, [fetchGuides]);

  const handleGenerate = async () => {
    if (!selectedCourse || generating) return;
    setGenerating(true);
    setError(null);

    const [courseName, examName] = selectedCourse.split("||");

    try {
      const guide = await apiPost("/api/guides", {
        course_name: courseName,
        exam_name: examName || undefined,
        guide_type: selectedType,
      });
      setGuides((prev) => [guide, ...prev]);
      setExpandedGuide(guide.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div style={pageContainer}>
      {/* Header */}
      <div style={headerStyle}>
        <h1 style={titleStyle}>Study Guides</h1>
        <p style={subtitleStyle}>Generate reference guides from your course materials</p>
      </div>

      {/* Course selector + guide type picker */}
      {courses.length > 0 ? (
        <div style={{ marginBottom: "1.5rem" }}>
          <label style={labelStyle}>Course</label>
          <select
            value={selectedCourse}
            onChange={(e) => { setSelectedCourse(e.target.value); setError(null); }}
            style={selectStyle}
          >
            {courses.map((c) => {
              const val = c.exam_name
                ? `${c.course_name}||${c.exam_name}`
                : c.course_name;
              const label = c.exam_name
                ? `${c.course_name} — ${c.exam_name}`
                : c.course_name;
              return (
                <option key={val} value={val}>
                  {label}
                </option>
              );
            })}
          </select>

          <label style={{ ...labelStyle, marginTop: "1rem" }}>Guide Type</label>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
            {GUIDE_TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => setSelectedType(t.value)}
                style={{
                  ...typeButton,
                  background: selectedType === t.value ? "#7ec8e333" : "#334d33",
                  borderColor: selectedType === t.value ? "#7ec8e3" : "#4a6a4a",
                  color: selectedType === t.value ? "#7ec8e3" : "#a89a82",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>{t.label}</div>
                <div style={{ fontSize: "0.7rem", marginTop: "0.15rem" }}>{t.description}</div>
              </button>
            ))}
          </div>

          <button
            onClick={handleGenerate}
            disabled={generating}
            style={{
              ...generateBtn,
              opacity: generating ? 0.5 : 1,
              cursor: generating ? "wait" : "pointer",
            }}
          >
            {generating ? "Generating..." : `Generate ${GUIDE_TYPES.find((t) => t.value === selectedType)?.label}`}
          </button>

          {error && (
            <p style={{ color: "#e88888", fontSize: "0.85rem", marginTop: "0.5rem" }}>{error}</p>
          )}
        </div>
      ) : (
        <div style={{ padding: "2rem 0", textAlign: "center" }}>
          <p style={{ color: "#e8a040", fontSize: "0.9rem" }}>
            No course documents uploaded yet. Upload materials on the Dashboard first.
          </p>
        </div>
      )}

      {/* Existing guides */}
      {guides.length > 0 && (
        <div>
          <h2 style={sectionTitle}>YOUR GUIDES</h2>
          {guides.map((guide) => (
            <div key={guide.id} style={{ marginBottom: "0.75rem" }}>
              <button
                onClick={() =>
                  setExpandedGuide(expandedGuide === guide.id ? null : guide.id)
                }
                style={guideHeader}
              >
                <div style={{ flex: 1, textAlign: "left" }}>
                  <span style={guideTypeTag}>{guide.guide_type.replace(/_/g, " ")}</span>
                  <span style={{ fontSize: "0.9rem" }}>{guide.title}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontSize: "0.7rem", color: "#7a7060" }}>
                    {new Date(guide.created_at).toLocaleDateString()}
                  </span>
                  <span style={{ color: "#7a7060" }}>
                    {expandedGuide === guide.id ? "▼" : "▶"}
                  </span>
                </div>
              </button>

              {expandedGuide === guide.id && (
                <div style={guideContent}>
                  {renderGuideContent(guide)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Render guide content by type ---

function renderGuideContent(guide: StudyGuide): React.ReactNode {
  if (!guide.sections || guide.sections.length === 0) {
    return <p style={{ color: "#a89a82", fontStyle: "italic" }}>No content generated.</p>;
  }

  switch (guide.guide_type) {
    case "KEY_CONCEPTS":
      return (
        <div>
          {guide.sections.map((s, i) => (
            <div key={`concept-${i}`} style={conceptCard}>
              <h3 style={{ margin: "0 0 0.4rem", fontSize: "0.95rem", color: "#f0dc4e" }}>
                {s.concept || `Concept ${i + 1}`}
              </h3>
              {s.explanation && (
                <p style={{ margin: "0 0 0.3rem", fontSize: "0.85rem", lineHeight: 1.6 }}>
                  {s.explanation}
                </p>
              )}
              {s.importance && (
                <p style={{ margin: 0, fontSize: "0.75rem", color: "#7ec8e3", fontStyle: "italic" }}>
                  Why it matters: {s.importance}
                </p>
              )}
            </div>
          ))}
        </div>
      );

    case "FAQ":
      return (
        <div>
          {guide.sections.map((s, i) => (
            <div key={`faq-${i}`} style={conceptCard}>
              <p style={{ margin: "0 0 0.4rem", fontSize: "0.9rem", fontWeight: 600, color: "#e8dcc8" }}>
                Q: {s.question || `Question ${i + 1}`}
              </p>
              {s.answer && (
                <p style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.6, color: "#c8bca8" }}>
                  {s.answer}
                </p>
              )}
            </div>
          ))}
        </div>
      );

    case "CHEAT_SHEET":
      return (
        <div>
          {guide.sections.map((s, i) => (
            <div key={`cheat-${i}`} style={conceptCard}>
              <h3 style={{ margin: "0 0 0.4rem", fontSize: "0.9rem", color: "#e8a040" }}>
                {s.topic || `Topic ${i + 1}`}
              </h3>
              {s.content && (
                <div
                  style={{ fontSize: "0.8rem", lineHeight: 1.6, whiteSpace: "pre-wrap", fontFamily: "monospace" }}
                >
                  {s.content}
                </div>
              )}
            </div>
          ))}
        </div>
      );

    default:
      return <p style={{ color: "#a89a82" }}>Unknown guide type</p>;
  }
}

// --- Styles ---

const pageContainer: React.CSSProperties = {
  maxWidth: 720,
  margin: "0 auto",
  padding: "1.5rem 1rem",
  fontFamily: "var(--font-body), 'Patrick Hand', cursive",
  color: "#e8dcc8",
};

const headerStyle: React.CSSProperties = {
  marginBottom: "1.5rem",
};

const titleStyle: React.CSSProperties = {
  fontSize: "1.6rem",
  margin: "0 0 0.25rem",
  fontFamily: "var(--font-display), 'Caveat', cursive",
  color: "#f0dc4e",
};

const subtitleStyle: React.CSSProperties = {
  color: "#a89a82",
  margin: 0,
  fontSize: "0.9rem",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.75rem",
  color: "#7a7060",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: "0.35rem",
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem",
  fontSize: "0.85rem",
  fontFamily: "inherit",
  background: "#334d33",
  color: "#e8dcc8",
  border: "1px solid #4a6a4a",
  borderRadius: 6,
};

const typeButton: React.CSSProperties = {
  flex: "1 1 0",
  minWidth: 140,
  padding: "0.6rem 0.75rem",
  fontFamily: "inherit",
  border: "1px solid #4a6a4a",
  borderRadius: 6,
  cursor: "pointer",
  textAlign: "left",
};

const generateBtn: React.CSSProperties = {
  width: "100%",
  padding: "0.85rem",
  fontSize: "1.05rem",
  fontFamily: "var(--font-body), 'Patrick Hand', cursive",
  fontWeight: 600,
  background: "#f0dc4e",
  color: "#1f2e1f",
  border: "none",
  borderRadius: 6,
};

const sectionTitle: React.CSSProperties = {
  fontSize: "0.8rem",
  letterSpacing: "0.08em",
  color: "#7ec8e3",
  margin: "0 0 0.75rem",
  fontFamily: "var(--font-display), 'Caveat', cursive",
};

const guideHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  width: "100%",
  padding: "0.75rem 1rem",
  fontSize: "0.85rem",
  fontFamily: "inherit",
  background: "#334d33",
  color: "#e8dcc8",
  border: "1px solid #4a6a4a",
  borderRadius: 6,
  cursor: "pointer",
};

const guideTypeTag: React.CSSProperties = {
  display: "inline-block",
  fontSize: "0.65rem",
  fontWeight: 600,
  color: "#7ec8e3",
  background: "#7ec8e322",
  padding: "0.1rem 0.4rem",
  borderRadius: 3,
  marginRight: "0.5rem",
  letterSpacing: "0.03em",
};

const guideContent: React.CSSProperties = {
  background: "#2d3d2d",
  border: "1px solid #4a6a4a",
  borderTop: "none",
  borderRadius: "0 0 6px 6px",
  padding: "1rem",
};

const conceptCard: React.CSSProperties = {
  background: "#334d33",
  border: "1px solid #4a6a4a",
  borderRadius: 4,
  padding: "0.75rem",
  marginBottom: "0.5rem",
};
