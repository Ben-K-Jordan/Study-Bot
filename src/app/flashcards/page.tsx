"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { getOrCreateUserId } from "@/lib/client-utils";

// --- Types ---

interface FlashcardData {
  id: string;
  front: string;
  back: string;
  tags: string[] | null;
  ordinal: number;
}

interface DeckSummary {
  id: string;
  course_name: string;
  exam_name: string | null;
  document_id: string | null;
  title: string;
  card_count: number;
  created_at: string;
}

interface DeckFull extends DeckSummary {
  cards: FlashcardData[];
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

// --- Component ---

type View = "list" | "study";

export default function FlashcardsPage() {
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<string>("");
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingDecks, setLoadingDecks] = useState(false);

  // Study mode state
  const [view, setView] = useState<View>("list");
  const [studyDeck, setStudyDeck] = useState<DeckFull | null>(null);
  const [cardIndex, setCardIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState<Set<number>>(new Set());
  const [loadingDeck, setLoadingDeck] = useState(false);

  const selectedCourseRef = useRef(selectedCourse);
  selectedCourseRef.current = selectedCourse;

  // Fetch courses on mount
  useEffect(() => {
    let mounted = true;
    apiGet("/api/content/documents?namespace=COURSE")
      .then((data) => {
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
          if (options.length > 0) {
            const first = options[0];
            setSelectedCourse(
              first.exam_name
                ? `${first.course_name}||${first.exam_name}`
                : first.course_name,
            );
          }
        }
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  // Fetch decks when course changes
  useEffect(() => {
    if (!selectedCourse) return;
    let mounted = true;
    setLoadingDecks(true);
    const [courseName, examName] = selectedCourse.split("||");
    const params = new URLSearchParams({ course_name: courseName });
    if (examName) params.set("exam_name", examName);
    apiGet(`/api/flashcards?${params.toString()}`)
      .then((data) => {
        if (mounted && data.decks) setDecks(data.decks);
      })
      .catch(() => {
        if (mounted) setDecks([]);
      })
      .finally(() => {
        if (mounted) setLoadingDecks(false);
      });
    return () => { mounted = false; };
  }, [selectedCourse]);

  const handleGenerate = useCallback(async () => {
    if (!selectedCourse || generating) return;
    const courseAtStart = selectedCourse;
    setGenerating(true);
    setError(null);

    const [courseName, examName] = selectedCourse.split("||");

    try {
      const deck = await apiPost("/api/flashcards", {
        course_name: courseName,
        exam_name: examName || undefined,
      });
      if (selectedCourseRef.current === courseAtStart) {
        setDecks((prev) => [deck, ...prev]);
      }
    } catch (err) {
      if (selectedCourseRef.current === courseAtStart) {
        setError(err instanceof Error ? err.message : "Generation failed");
      }
    } finally {
      setGenerating(false);
    }
  }, [selectedCourse, generating]);

  const openStudyMode = useCallback(async (deckId: string) => {
    setLoadingDeck(true);
    try {
      const deck = await apiGet(`/api/flashcards/${deckId}`);
      setStudyDeck(deck);
      setCardIndex(0);
      setFlipped(false);
      setKnown(new Set());
      setView("study");
    } catch {
      setError("Failed to load deck");
    } finally {
      setLoadingDeck(false);
    }
  }, []);

  const handleFlip = () => setFlipped((f) => !f);

  const handleNext = (markKnown: boolean) => {
    if (!studyDeck) return;
    if (markKnown) {
      setKnown((prev) => new Set(prev).add(cardIndex));
    }
    if (cardIndex < studyDeck.cards.length - 1) {
      setCardIndex((i) => i + 1);
      setFlipped(false);
    }
  };

  const handlePrev = () => {
    if (cardIndex > 0) {
      setCardIndex((i) => i - 1);
      setFlipped(false);
    }
  };

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (view !== "study" || !studyDeck) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === "ArrowRight") {
        handleNext(false);
      } else if (e.key === "ArrowLeft") {
        handlePrev();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, studyDeck, cardIndex],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // --- Study Mode ---
  if (view === "study" && studyDeck) {
    const card = studyDeck.cards[cardIndex];
    const total = studyDeck.cards.length;
    const knownCount = known.size;
    const progressPct = total > 0 ? ((cardIndex + 1) / total) * 100 : 0;

    return (
      <div style={pageContainer}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <button onClick={() => setView("list")} style={backBtn}>
            Back to Decks
          </button>
          <span style={{ fontSize: "0.8rem", color: "#7a7060" }}>
            {knownCount}/{total} known
          </span>
        </div>

        <h2 style={{ ...titleStyle, fontSize: "1.3rem", marginBottom: "0.5rem" }}>{studyDeck.title}</h2>

        {/* Progress bar */}
        <div style={progressBarBg}>
          <div style={{ ...progressBarFill, width: `${progressPct}%` }} />
        </div>
        <p style={{ fontSize: "0.75rem", color: "#7a7060", marginBottom: "1rem", textAlign: "center" }}>
          Card {cardIndex + 1} of {total}
        </p>

        {/* Card */}
        <div
          onClick={handleFlip}
          style={{
            ...cardStyle,
            background: flipped ? "#2d4a3d" : "#334d33",
            borderColor: known.has(cardIndex) ? "#88cc88" : flipped ? "#7ec8e3" : "#4a6a4a",
            cursor: "pointer",
          }}
        >
          <div style={{ fontSize: "0.65rem", color: flipped ? "#7ec8e3" : "#a89a82", marginBottom: "0.75rem", letterSpacing: "0.08em" }}>
            {flipped ? "ANSWER" : "QUESTION"}
          </div>
          <div style={{ fontSize: "1.05rem", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
            {flipped ? card.back : card.front}
          </div>
          {card.tags && card.tags.length > 0 && (
            <div style={{ marginTop: "1rem", display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
              {(card.tags as string[]).map((tag) => (
                <span key={tag} style={tagStyle}>{tag}</span>
              ))}
            </div>
          )}
        </div>

        <p style={{ fontSize: "0.7rem", color: "#7a7060", textAlign: "center", margin: "0.5rem 0" }}>
          Tap card or press Space to flip
        </p>

        {/* Controls */}
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
          <button
            onClick={handlePrev}
            disabled={cardIndex === 0}
            style={{ ...navBtn, opacity: cardIndex === 0 ? 0.3 : 1 }}
          >
            Prev
          </button>
          <button
            onClick={() => handleNext(false)}
            disabled={cardIndex === total - 1}
            style={{ ...navBtn, flex: 2, opacity: cardIndex === total - 1 ? 0.3 : 1 }}
          >
            Next
          </button>
          <button
            onClick={() => handleNext(true)}
            disabled={cardIndex === total - 1}
            style={{
              ...navBtn,
              background: "#88cc8833",
              borderColor: "#88cc88",
              color: "#88cc88",
              opacity: cardIndex === total - 1 ? 0.3 : 1,
            }}
          >
            Got it
          </button>
        </div>

        {/* End of deck */}
        {cardIndex === total - 1 && flipped && (
          <div style={{ textAlign: "center", marginTop: "1.5rem", padding: "1rem", background: "#334d33", borderRadius: 6, border: "1px solid #4a6a4a" }}>
            <p style={{ fontSize: "1.1rem", color: "#f0dc4e", margin: "0 0 0.5rem" }}>
              Deck complete!
            </p>
            <p style={{ fontSize: "0.85rem", color: "#a89a82", margin: 0 }}>
              You marked {knownCount} of {total} cards as known.
            </p>
            <button
              onClick={() => { setCardIndex(0); setFlipped(false); setKnown(new Set()); }}
              style={{ ...generateBtnStyle, marginTop: "0.75rem", fontSize: "0.9rem", padding: "0.6rem" }}
            >
              Study Again
            </button>
          </div>
        )}
      </div>
    );
  }

  // --- List Mode ---
  return (
    <div style={pageContainer}>
      <div style={headerStyle}>
        <h1 style={titleStyle}>Flashcards</h1>
        <p style={subtitleStyle}>Auto-generated flashcards from your course materials</p>
      </div>

      {courses.length > 0 ? (
        <div style={{ marginBottom: "1.5rem" }}>
          <label style={labelStyle}>Course</label>
          <select
            aria-label="Select course"
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
              return <option key={val} value={val}>{label}</option>;
            })}
          </select>

          <button
            onClick={handleGenerate}
            disabled={generating}
            style={{
              ...generateBtnStyle,
              marginTop: "0.75rem",
              opacity: generating ? 0.5 : 1,
              cursor: generating ? "wait" : "pointer",
            }}
          >
            {generating ? "Generating..." : "Generate Flashcards"}
          </button>

          {error && <p role="alert" style={{ color: "#e88888", fontSize: "0.85rem", marginTop: "0.5rem" }}>{error}</p>}
        </div>
      ) : (
        <div style={{ padding: "2rem 0", textAlign: "center" }}>
          <p style={{ color: "#e8a040", fontSize: "0.9rem" }}>
            No course documents uploaded yet.{" "}
            <Link href="/" style={{ color: "#f0dc4e", textDecoration: "underline" }}>
              Upload materials on the Dashboard
            </Link>
          </p>
        </div>
      )}

      {/* Decks list */}
      {loadingDecks && (
        <p style={{ color: "#7a7060", fontSize: "0.85rem", textAlign: "center", padding: "1rem 0" }}>
          Loading decks...
        </p>
      )}
      {!loadingDecks && courses.length > 0 && decks.length === 0 && (
        <p style={{ color: "#7a7060", fontSize: "0.85rem", textAlign: "center", padding: "1rem 0" }}>
          No flashcard decks yet. Hit Generate to create one!
        </p>
      )}
      {decks.length > 0 && (
        <div>
          <h2 style={sectionTitle}>YOUR DECKS</h2>
          {decks.map((deck) => (
            <button
              key={deck.id}
              onClick={() => openStudyMode(deck.id)}
              disabled={loadingDeck}
              style={deckCard}
            >
              <div style={{ flex: 1, textAlign: "left" }}>
                <div style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.2rem" }}>
                  {deck.title}
                </div>
                <div style={{ fontSize: "0.75rem", color: "#7a7060" }}>
                  {deck.card_count} cards · {new Date(deck.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </div>
              </div>
              <span style={{ color: "#f0dc4e", fontSize: "0.85rem", fontWeight: 600 }}>
                Study →
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Styles ---

const pageContainer: React.CSSProperties = {
  maxWidth: 720,
  margin: "0 auto",
  padding: "1.5rem 1rem",
  fontFamily: "var(--font-body), 'Patrick Hand', cursive",
  color: "#e8dcc8",
};

const headerStyle: React.CSSProperties = { marginBottom: "1.5rem" };

const titleStyle: React.CSSProperties = {
  fontSize: "1.6rem",
  margin: "0 0 0.25rem",
  fontFamily: "var(--font-display), 'Caveat', cursive",
  color: "#f0dc4e",
};

const subtitleStyle: React.CSSProperties = { color: "#a89a82", margin: 0, fontSize: "0.9rem" };

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

const generateBtnStyle: React.CSSProperties = {
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

const deckCard: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  width: "100%",
  padding: "0.85rem 1rem",
  fontFamily: "inherit",
  background: "#334d33",
  color: "#e8dcc8",
  border: "1px solid #4a6a4a",
  borderRadius: 6,
  cursor: "pointer",
  marginBottom: "0.5rem",
  textAlign: "left",
};

const cardStyle: React.CSSProperties = {
  minHeight: 200,
  padding: "1.5rem",
  borderRadius: 8,
  border: "2px solid #4a6a4a",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  transition: "background 0.2s, border-color 0.2s",
};

const progressBarBg: React.CSSProperties = {
  height: 4,
  background: "#334d33",
  borderRadius: 2,
  marginBottom: "0.25rem",
  overflow: "hidden",
};

const progressBarFill: React.CSSProperties = {
  height: "100%",
  background: "#7ec8e3",
  borderRadius: 2,
  transition: "width 0.3s",
};

const navBtn: React.CSSProperties = {
  flex: 1,
  padding: "0.65rem",
  fontSize: "0.85rem",
  fontFamily: "inherit",
  fontWeight: 600,
  background: "#334d33",
  color: "#e8dcc8",
  border: "1px solid #4a6a4a",
  borderRadius: 6,
  cursor: "pointer",
};

const backBtn: React.CSSProperties = {
  fontSize: "0.8rem",
  fontFamily: "inherit",
  color: "#7a7060",
  background: "none",
  border: "1px solid #3a5a3a",
  borderRadius: 4,
  padding: "0.3rem 0.6rem",
  cursor: "pointer",
};

const tagStyle: React.CSSProperties = {
  fontSize: "0.6rem",
  background: "#7ec8e322",
  color: "#7ec8e3",
  padding: "0.1rem 0.4rem",
  borderRadius: 3,
  letterSpacing: "0.03em",
};
