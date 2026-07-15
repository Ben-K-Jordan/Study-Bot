"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { getActiveCourse, setActiveCourse } from "@/lib/client-utils";
import { apiGet, apiPost, apiDelete, type CourseOption } from "@/lib/client-api";
import {
  headerStyle,
  titleStyle,
  subtitleStyle,
  labelStyle,
  selectStyle,
  generateBtnStyle,
  sectionTitleStyle,
  deleteBtnStyle,
} from "@/lib/shared-styles";

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

const GUIDE_TYPES: { value: GuideType; label: string; description: string }[] = [
  { value: "KEY_CONCEPTS", label: "Key Concepts", description: "Important concepts with explanations" },
  { value: "FAQ", label: "FAQ", description: "Common questions and detailed answers" },
  { value: "CHEAT_SHEET", label: "Cheat Sheet", description: "Quick reference for exam review" },
];

export default function GuidesPage() {
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [selectedCourse, setSelectedCourseRaw] = useState<string>(() => getActiveCourse());
  const setSelectedCourse = (v: string) => { setSelectedCourseRaw(v); setActiveCourse(v); };
  const [guides, setGuides] = useState<StudyGuide[]>([]);
  const [generating, setGenerating] = useState(false);
  const [selectedType, setSelectedType] = useState<GuideType>("KEY_CONCEPTS");
  const [expandedGuide, setExpandedGuide] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingGuides, setLoadingGuides] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const selectedCourseRef = useRef(selectedCourse);
  selectedCourseRef.current = selectedCourse;

  // Fetch available courses on mount
  useEffect(() => {
    let mounted = true;
    apiGet("/api/content/documents?namespace=COURSE").then((data) => {
      if (!mounted) return;
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
        const active = getActiveCourse();
        const match = active && options.some((o) => (o.exam_name ? `${o.course_name}||${o.exam_name}` : o.course_name) === active);
        if (match) {
          setSelectedCourse(active);
        } else if (options.length > 0) {
          const first = options[0];
          setSelectedCourse(first.exam_name ? `${first.course_name}||${first.exam_name}` : first.course_name);
        }
      }
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  // Fetch existing guides when course changes
  useEffect(() => {
    if (!selectedCourse) return;
    let mounted = true;
    setLoadingGuides(true);
    const [courseName, examName] = selectedCourse.split("||");
    const params = new URLSearchParams({ course_name: courseName });
    if (examName) params.set("exam_name", examName);
    apiGet(`/api/guides?${params.toString()}`).then((data) => {
      if (mounted && data.guides) setGuides(data.guides);
    }).catch(() => {
      if (mounted) setGuides([]);
    }).finally(() => {
      if (mounted) setLoadingGuides(false);
    });
    return () => { mounted = false; };
  }, [selectedCourse]);

  const handleGenerate = async () => {
    if (!selectedCourse || generating) return;
    const courseAtStart = selectedCourse;
    setGenerating(true);
    setError(null);

    const [courseName, examName] = selectedCourse.split("||");

    try {
      const guide = await apiPost("/api/guides", {
        course_name: courseName,
        exam_name: examName || undefined,
        guide_type: selectedType,
      });
      // Only update list if user hasn't switched courses during generation
      if (selectedCourseRef.current === courseAtStart) {
        setGuides((prev) => [guide, ...prev]);
        setExpandedGuide(guide.id);
      }
    } catch (err) {
      if (selectedCourseRef.current === courseAtStart) {
        setError(err instanceof Error ? err.message : "Generation failed");
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleDeleteGuide = async (guideId: string) => {
    if (deleting) return;
    if (!window.confirm("Delete this guide? This cannot be undone.")) return;
    setDeleting(guideId);
    try {
      await apiDelete(`/api/guides/${guideId}`);
      setGuides((prev) => prev.filter((g) => g.id !== guideId));
      if (expandedGuide === guideId) setExpandedGuide(null);
    } catch {
      setError("Failed to delete guide");
    } finally {
      setDeleting(null);
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
                aria-pressed={selectedType === t.value}
                onClick={() => setSelectedType(t.value)}
                style={{
                  ...typeButton,
                  background: selectedType === t.value ? "var(--color-bg-info-tint)" : "var(--color-bg-card)",
                  borderColor: selectedType === t.value ? "var(--color-info)" : "var(--color-border)",
                  color: selectedType === t.value ? "var(--color-info)" : "var(--color-text-muted)",
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
              ...generateBtnStyle,
              opacity: generating ? 0.5 : 1,
              cursor: generating ? "wait" : "pointer",
            }}
          >
            {generating ? "Generating..." : `Generate ${GUIDE_TYPES.find((t) => t.value === selectedType)?.label}`}
          </button>

          {error && (
            <p role="alert" style={{ color: "var(--color-error)", fontSize: "0.85rem", marginTop: "0.5rem" }}>{error}</p>
          )}
        </div>
      ) : (
        <div style={{ textAlign: "center", padding: "2rem 1rem", border: "1px dashed var(--color-border-done)", borderRadius: "var(--radius-lg)" }}>
          <p style={{ color: "var(--color-text-muted)", fontSize: "1rem", margin: "0 0 0.5rem" }}>
            No course documents yet
          </p>
          <p style={{ color: "var(--color-text-faint)", fontSize: "0.85rem", margin: "0 0 1rem" }}>
            Upload your course materials first, then come back to generate study guides.
          </p>
          <Link href="/flashcards" style={{ padding: "0.5rem 1rem", background: "var(--color-primary)", color: "var(--color-bg-darkest)", borderRadius: "var(--radius)", fontWeight: 700, textDecoration: "none", fontSize: "0.9rem" }}>
            Upload Documents
          </Link>
        </div>
      )}

      {/* Existing guides */}
      {loadingGuides && (
        <p style={{ color: "var(--color-text-dim)", fontSize: "0.85rem", textAlign: "center", padding: "1rem 0" }}>
          Loading guides...
        </p>
      )}
      {!loadingGuides && courses.length > 0 && guides.length === 0 && (
        <div style={{ textAlign: "center", padding: "2rem 1rem", border: "1px dashed var(--color-border-done)", borderRadius: "var(--radius-lg)" }}>
          <p style={{ color: "var(--color-text-muted)", fontSize: "0.95rem", margin: "0 0 0.5rem" }}>
            No guides generated yet for this course
          </p>
          <p style={{ color: "var(--color-text-faint)", fontSize: "0.8rem", margin: 0 }}>
            Pick a guide type above and hit Generate to create Key Concepts, FAQs, or Cheat Sheets from your materials.
          </p>
        </div>
      )}
      {guides.length > 0 && (
        <div>
          <h2 style={{ ...sectionTitleStyle, color: "var(--color-text-muted)", fontWeight: 600, textTransform: "uppercase" }}>YOUR GUIDES</h2>
          {guides.map((guide) => (
            <div key={guide.id} style={{ marginBottom: "0.75rem" }}>
              <div style={{ display: "flex", gap: "0.35rem" }}>
                <button
                  aria-expanded={expandedGuide === guide.id}
                  onClick={() =>
                    setExpandedGuide(expandedGuide === guide.id ? null : guide.id)
                  }
                  style={{ ...guideHeader, flex: 1 }}
                >
                  <div style={{ flex: 1, textAlign: "left" }}>
                    <span style={guideTypeTag}>{guide.guide_type.replace(/_/g, " ")}</span>
                    <span style={{ fontSize: "0.9rem" }}>{guide.title}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ fontSize: "0.7rem", color: "var(--color-text-dim)" }}>
                      {new Date(guide.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                    <span style={{ color: "var(--color-text-dim)" }}>
                      {expandedGuide === guide.id ? "▼" : "▶"}
                    </span>
                  </div>
                </button>
                <button
                  onClick={() => handleDeleteGuide(guide.id)}
                  disabled={deleting === guide.id}
                  aria-label={`Delete ${guide.title}`}
                  style={deleteBtnStyle}
                >
                  {deleting === guide.id ? "..." : "×"}
                </button>
              </div>

              {expandedGuide === guide.id && (
                <div style={guideContent}>
                  {renderGuideContent(guide)}
                  <div style={{ marginTop: "1rem", borderTop: "1px solid var(--color-border-subtle)", paddingTop: "0.75rem", textAlign: "right" }}>
                    <button
                      type="button"
                      onClick={() => {
                        const text = guide.sections
                          .map((s) => {
                            const parts: string[] = [];
                            if (s.concept) parts.push(`## ${s.concept}`);
                            if (s.question) parts.push(`**Q: ${s.question}**`);
                            if (s.topic) parts.push(`## ${s.topic}`);
                            if (s.explanation) parts.push(s.explanation);
                            if (s.answer) parts.push(s.answer);
                            if (s.content) parts.push(s.content);
                            if (s.importance) parts.push(`_Why it matters: ${s.importance}_`);
                            return parts.join("\n");
                          })
                          .join("\n\n---\n\n");
                        const blob = new Blob([`# ${guide.title}\n\n${text}`], { type: "text/markdown" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `${guide.title.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "-").toLowerCase()}.md`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      style={{
                        fontSize: "0.75rem",
                        fontFamily: "inherit",
                        color: "var(--color-info)",
                        background: "var(--color-bg)",
                        border: "1px solid var(--color-border-subtle)",
                        borderRadius: "var(--radius-sm)",
                        padding: "0.35rem 0.75rem",
                        cursor: "pointer",
                      }}
                    >
                      Download as Markdown
                    </button>
                  </div>
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
    return <p style={{ color: "var(--color-text-muted)", fontStyle: "italic" }}>No content generated.</p>;
  }

  switch (guide.guide_type) {
    case "KEY_CONCEPTS":
      return (
        <div>
          {guide.sections.map((s, i) => (
            <div key={`concept-${i}`} style={conceptCard}>
              <h3 style={{ margin: "0 0 0.4rem", fontSize: "0.95rem", color: "var(--color-primary)" }}>
                {s.concept || `Concept ${i + 1}`}
              </h3>
              {s.explanation && (
                <p style={{ margin: "0 0 0.3rem", fontSize: "0.85rem", lineHeight: 1.6 }}>
                  {s.explanation}
                </p>
              )}
              {s.importance && (
                <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--color-info)", fontStyle: "italic" }}>
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
              <p style={{ margin: "0 0 0.4rem", fontSize: "0.9rem", fontWeight: 600, color: "var(--color-text)" }}>
                Q: {s.question || `Question ${i + 1}`}
              </p>
              {s.answer && (
                <p style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.6, color: "var(--color-text-secondary)" }}>
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
              <h3 style={{ margin: "0 0 0.4rem", fontSize: "0.9rem", color: "var(--color-warning)" }}>
                {s.topic || `Topic ${i + 1}`}
              </h3>
              {s.content && (
                <div
                  style={{ fontSize: "0.8rem", lineHeight: 1.6, whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)" }}
                >
                  {s.content}
                </div>
              )}
            </div>
          ))}
        </div>
      );

    default:
      return <p style={{ color: "var(--color-text-muted)" }}>Unknown guide type</p>;
  }
}

// --- Styles ---

const pageContainer: React.CSSProperties = {
  maxWidth: 700,
  margin: "0 auto",
  padding: "1.5rem 1rem",
  fontFamily: "var(--font-body)",
  color: "var(--color-text)",
};

const typeButton: React.CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  padding: "0.6rem 0.75rem",
  fontFamily: "inherit",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius)",
  cursor: "pointer",
  textAlign: "left",
};

const guideHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  width: "100%",
  padding: "0.75rem 1rem",
  fontSize: "0.85rem",
  fontFamily: "inherit",
  background: "var(--color-bg-card)",
  color: "var(--color-text)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius)",
  cursor: "pointer",
};

const guideTypeTag: React.CSSProperties = {
  display: "inline-block",
  fontSize: "0.65rem",
  fontWeight: 600,
  color: "var(--color-info)",
  background: "var(--color-bg-info-tint)",
  padding: "0.1rem 0.4rem",
  borderRadius: 3,
  marginRight: "0.5rem",
  letterSpacing: "0.03em",
};

const guideContent: React.CSSProperties = {
  background: "var(--color-bg)",
  border: "1px solid var(--color-border)",
  borderTop: "none",
  borderRadius: "0 0 var(--radius) var(--radius)",
  padding: "1rem 1.25rem",
  boxShadow: "var(--shadow-card)",
};


const conceptCard: React.CSSProperties = {
  background: "var(--color-bg-card)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  padding: "0.75rem 1rem",
  marginBottom: "0.5rem",
};
