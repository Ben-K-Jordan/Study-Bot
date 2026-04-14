"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { getOrCreateUserId, getActiveCourse, setActiveCourse } from "@/lib/client-utils";

// --- Types ---

interface CardData {
  id: string;
  front: string;
  back: string;
  tags: string[] | null;
  ordinal: number;
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  nextDueAt: string | null;
  status: "new" | "learning" | "review" | "mastered";
}

interface StudyDeck {
  deck: { id: string; title: string; courseName: string };
  cards: CardData[];
  stats: { newCount: number; learningCount: number; reviewCount: number; masteredCount: number };
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

interface CourseOption {
  course_name: string;
  exam_name?: string;
  doc_count: number;
}

type ReviewRating = "AGAIN" | "HARD" | "GOOD" | "EASY";

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

async function apiDelete(url: string) {
  const res = await fetch(url, {
    method: "DELETE",
    headers: { "X-User-Id": getOrCreateUserId() },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// --- Status helpers ---

const STATUS_COLORS: Record<string, string> = {
  new: "#7ec8e3",
  learning: "#e8a040",
  review: "#c4a0ff",
  mastered: "#88cc88",
};

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  learning: "Learning",
  review: "Review",
  mastered: "Mastered",
};

const RATING_COLORS: Record<ReviewRating, string> = {
  AGAIN: "#e88888",
  HARD: "#e8a040",
  GOOD: "#88cc88",
  EASY: "#7ec8e3",
};

// --- Component ---

type View = "list" | "study";

export default function FlashcardsPage() {
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [selectedCourse, setSelectedCourseRaw] = useState<string>(() => getActiveCourse());
  const setSelectedCourse = (v: string) => { setSelectedCourseRaw(v); setActiveCourse(v); };
  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingDecks, setLoadingDecks] = useState(false);

  // Study mode state
  const [view, setView] = useState<View>("list");
  const [studyData, setStudyData] = useState<StudyDeck | null>(null);
  const [cardIndex, setCardIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [loadingDeck, setLoadingDeck] = useState(false);
  const [sessionXp, setSessionXp] = useState(0);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [xpPopup, setXpPopup] = useState<{ amount: number; key: number } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [lastReview, setLastReview] = useState<{
    cardIndex: number;
    prevCard: CardData;
    prevXp: number;
    prevReviewedCount: number;
  } | null>(null);

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
          // Use persisted course if it exists in the list, else default to first
          const active = getActiveCourse();
          const match = active && options.some((o) => (o.exam_name ? `${o.course_name}||${o.exam_name}` : o.course_name) === active);
          if (match) {
            setSelectedCourse(active);
          } else if (options.length > 0) {
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
      const data = await apiGet(`/api/flashcards/${deckId}/study`);
      setStudyData(data);
      setCardIndex(0);
      setFlipped(false);
      setSessionXp(0);
      setReviewedCount(0);
      setView("study");
    } catch {
      setError("Failed to load deck");
    } finally {
      setLoadingDeck(false);
    }
  }, []);

  const handleFlip = () => setFlipped((f) => !f);

  const handleReview = useCallback(async (rating: ReviewRating) => {
    if (!studyData || reviewing) return;
    const card = studyData.cards[cardIndex];
    setReviewing(true);

    // Save state for undo before mutating
    setLastReview({
      cardIndex,
      prevCard: { ...card },
      prevXp: sessionXp,
      prevReviewedCount: reviewedCount,
    });

    try {
      const result = await apiPost(`/api/flashcards/${studyData.deck.id}/review`, {
        card_id: card.id,
        rating,
      });

      setStudyData((prev) => {
        if (!prev) return prev;
        const updatedCards = [...prev.cards];
        updatedCards[cardIndex] = {
          ...updatedCards[cardIndex],
          easeFactor: result.easeFactor,
          intervalDays: result.intervalDays,
          repetitions: result.repetitions,
          nextDueAt: result.nextDueAt,
          status: result.intervalDays === 0 ? "learning"
            : result.intervalDays >= 21 ? "mastered"
            : "review",
        };
        return { ...prev, cards: updatedCards };
      });

      const earned = result.xpEarned || 0;
      setSessionXp((prev) => prev + earned);
      setReviewedCount((prev) => prev + 1);

      // XP popup
      if (earned > 0) {
        setXpPopup({ amount: earned, key: Date.now() });
        setTimeout(() => setXpPopup(null), 1500);
      }

      // Advance to next card
      if (cardIndex < studyData.cards.length - 1) {
        setCardIndex((i) => i + 1);
        setFlipped(false);
      } else {
        // Reached end — flip to show summary
        setFlipped(true);
      }
    } catch {
      setError("Failed to submit review");
    } finally {
      setReviewing(false);
    }
  }, [studyData, cardIndex, reviewing]);

  const handleUndo = useCallback(() => {
    if (!lastReview || !studyData) return;
    // Restore the card to its previous state (local only — server state already saved)
    setStudyData((prev) => {
      if (!prev) return prev;
      const updatedCards = [...prev.cards];
      updatedCards[lastReview.cardIndex] = lastReview.prevCard;
      return { ...prev, cards: updatedCards };
    });
    setCardIndex(lastReview.cardIndex);
    setSessionXp(lastReview.prevXp);
    setReviewedCount(lastReview.prevReviewedCount);
    setFlipped(false);
    setLastReview(null);
  }, [lastReview, studyData]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (view !== "study" || !studyData) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === "1") { handleReview("AGAIN"); }
      else if (e.key === "2") { handleReview("HARD"); }
      else if (e.key === "3") { handleReview("GOOD"); }
      else if (e.key === "4") { handleReview("EASY"); }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, studyData, cardIndex, reviewing],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const handleDeleteDeck = useCallback(async (deckId: string) => {
    if (deleting) return;
    setDeleting(deckId);
    try {
      await apiDelete(`/api/flashcards/${deckId}`);
      setDecks((prev) => prev.filter((d) => d.id !== deckId));
    } catch {
      setError("Failed to delete deck");
    } finally {
      setDeleting(null);
    }
  }, [deleting]);

  // --- Study Mode ---
  if (view === "study" && studyData) {
    const card = studyData.cards[cardIndex];
    const total = studyData.cards.length;
    const progressPct = total > 0 ? ((cardIndex + 1) / total) * 100 : 0;
    const isLastCard = cardIndex === total - 1;
    const sessionComplete = isLastCard && reviewedCount >= total;

    return (
      <div id="main-content" style={pageContainer}>
        <style>{`
          @keyframes xp-float { 0% { opacity: 1; transform: translateY(0); } 100% { opacity: 0; transform: translateY(-30px); } }
        `}</style>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={() => setView("list")} style={backBtn}>
              Back to Decks
            </button>
            {lastReview && (
              <button onClick={handleUndo} style={{ ...backBtn, color: "var(--color-warning)", borderColor: "#e8a04044" }}>
                Undo
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
            <span style={{ fontSize: "0.8rem", color: "var(--color-primary)", fontWeight: 600 }}>
              +{sessionXp} XP
            </span>
            <span style={{ fontSize: "0.8rem", color: "var(--color-text-faint)" }}>
              {reviewedCount}/{total} reviewed
            </span>
          </div>
        </div>

        <h2 style={{ ...titleStyle, fontSize: "1.3rem", marginBottom: "0.5rem" }}>{studyData.deck.title}</h2>

        {/* Stats bar */}
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
          {(["new", "learning", "review", "mastered"] as const).map((s) => {
            const count = studyData.stats[`${s}Count` as keyof typeof studyData.stats];
            return (
              <span key={s} style={{ fontSize: "0.7rem", color: STATUS_COLORS[s], background: `${STATUS_COLORS[s]}22`, padding: "0.15rem 0.5rem", borderRadius: 3 }}>
                {STATUS_LABELS[s]}: {count}
              </span>
            );
          })}
        </div>

        {/* Progress bar */}
        <div style={progressBarBg}>
          <div style={{ ...progressBarFill, width: `${progressPct}%` }} />
        </div>
        <p style={{ fontSize: "0.75rem", color: "var(--color-text-dim)", marginBottom: "1rem", textAlign: "center" }}>
          Card {cardIndex + 1} of {total}
        </p>

        {/* Card */}
        <div style={{ position: "relative" }} role="region" aria-label="Flashcard">
          {xpPopup && (
            <div
              key={xpPopup.key}
              style={{
                position: "absolute", top: -10, right: 10, zIndex: 10,
                color: "var(--color-primary)", fontWeight: 700, fontSize: "1.1rem",
                animation: "xp-float 1.5s ease-out forwards",
                pointerEvents: "none",
              }}
            >
              +{xpPopup.amount} XP
            </div>
          )}
          <div
            onClick={handleFlip}
            style={{
              ...cardStyle,
              background: flipped ? "#2d4a3d" : "var(--color-bg-card)",
              borderColor: flipped ? "var(--color-info)" : "var(--color-border)",
              cursor: "pointer",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
              <span style={{ fontSize: "0.65rem", color: flipped ? "var(--color-info)" : "var(--color-text-muted)", letterSpacing: "0.08em" }}>
                {flipped ? "ANSWER" : "QUESTION"}
              </span>
              <span style={{ fontSize: "0.6rem", color: STATUS_COLORS[card.status], background: `${STATUS_COLORS[card.status]}22`, padding: "0.1rem 0.4rem", borderRadius: 3 }}>
                {STATUS_LABELS[card.status]}
                {card.intervalDays > 0 && ` · ${card.intervalDays}d`}
              </span>
            </div>
            <div aria-live="polite" style={{ fontSize: "1.05rem", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
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
        </div>

        {!flipped && (
          <p style={{ fontSize: "0.7rem", color: "var(--color-text-dim)", textAlign: "center", margin: "0.5rem 0" }}>
            Tap card or press Space to flip
          </p>
        )}

        {/* Rating buttons — only show when flipped */}
        {flipped && !sessionComplete && (
          <div style={{ marginTop: "0.75rem" }}>
            <p style={{ fontSize: "0.7rem", color: "var(--color-text-dim)", textAlign: "center", marginBottom: "0.5rem" }}>
              How well did you know this?
            </p>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              {(["AGAIN", "HARD", "GOOD", "EASY"] as const).map((rating, i) => (
                <button
                  key={rating}
                  onClick={() => handleReview(rating)}
                  disabled={reviewing}
                  aria-label={`Rate ${rating.charAt(0) + rating.slice(1).toLowerCase()} (${i + 1})`}
                  type="button"
                  style={{
                    ...ratingBtn,
                    borderColor: RATING_COLORS[rating],
                    color: RATING_COLORS[rating],
                    opacity: reviewing ? 0.5 : 1,
                  }}
                >
                  <span style={{ fontSize: "0.7rem", opacity: 0.6 }}>{i + 1}</span>
                  <span>{rating.charAt(0) + rating.slice(1).toLowerCase()}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* End of deck summary */}
        {sessionComplete && (
          <div style={{ textAlign: "center", marginTop: "1.5rem", padding: "1.25rem", background: "var(--color-bg-card)", borderRadius: 8, border: "1px solid var(--color-border)" }}>
            <p style={{ fontSize: "1.2rem", color: "var(--color-primary)", margin: "0 0 0.5rem", fontFamily: "var(--font-display)" }}>
              Session Complete!
            </p>
            <p style={{ fontSize: "0.9rem", color: "var(--color-success)", margin: "0 0 0.25rem" }}>
              +{sessionXp} XP earned
            </p>
            <p style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", margin: "0 0 1rem" }}>
              {reviewedCount} cards reviewed
            </p>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center" }}>
              <button
                onClick={() => openStudyMode(studyData.deck.id)}
                style={{ ...generateBtnStyle, fontSize: "0.9rem", padding: "0.6rem" }}
              >
                Study Again
              </button>
              <button
                onClick={() => setView("list")}
                style={{ ...backBtn, padding: "0.6rem 1rem" }}
              >
                Back to Decks
              </button>
            </div>
          </div>
        )}

        {error && <p role="alert" style={{ color: "var(--color-error)", fontSize: "0.85rem", marginTop: "0.5rem" }}>{error}</p>}
      </div>
    );
  }

  // --- List Mode ---
  return (
    <div id="main-content" style={pageContainer}>
      <div style={headerStyle}>
        <h1 style={titleStyle}>Flashcards</h1>
        <p style={subtitleStyle}>Spaced repetition flashcards from your course materials</p>
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

          {error && <p role="alert" style={{ color: "var(--color-error)", fontSize: "0.85rem", marginTop: "0.5rem" }}>{error}</p>}
        </div>
      ) : (
        <div style={{ textAlign: "center", padding: "2rem 1rem", border: "1px dashed var(--color-border-done)", borderRadius: 8 }}>
          <p style={{ color: "#b0a090", fontSize: "1rem", margin: "0 0 0.5rem" }}>
            No course documents yet
          </p>
          <p style={{ color: "var(--color-text-faint)", fontSize: "0.85rem", margin: "0 0 1rem" }}>
            Upload your lecture notes, textbooks, or slides to get started with flashcards.
          </p>
          <Link href="/plan" style={{ padding: "0.5rem 1rem", background: "var(--color-primary)", color: "var(--color-bg-darkest)", borderRadius: 6, fontWeight: 700, textDecoration: "none", fontSize: "0.9rem" }}>
            Create a Study Plan
          </Link>
        </div>
      )}

      {/* Decks list */}
      {loadingDecks && (
        <p style={{ color: "var(--color-text-dim)", fontSize: "0.85rem", textAlign: "center", padding: "1rem 0" }}>
          Loading decks...
        </p>
      )}
      {!loadingDecks && courses.length > 0 && decks.length === 0 && (
        <div style={{ textAlign: "center", padding: "2rem 1rem", border: "1px dashed var(--color-border-done)", borderRadius: 8 }}>
          <p style={{ color: "#b0a090", fontSize: "0.95rem", margin: "0 0 0.5rem" }}>
            No flashcard decks yet for this course
          </p>
          <p style={{ color: "var(--color-text-faint)", fontSize: "0.8rem", margin: "0 0 1rem" }}>
            Hit the Generate button above to create your first deck from your uploaded documents.
          </p>
        </div>
      )}
      {decks.length > 0 && (
        <div>
          <h2 style={sectionTitle}>YOUR DECKS</h2>
          {decks.map((deck) => (
            <div key={deck.id} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <button
                onClick={() => openStudyMode(deck.id)}
                disabled={loadingDeck}
                style={{ ...deckCard, flex: 1 }}
              >
                <div style={{ flex: 1, textAlign: "left" }}>
                  <div style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.2rem" }}>
                    {deck.title}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--color-text-dim)" }}>
                    {deck.card_count} cards · {new Date(deck.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </div>
                </div>
                <span style={{ color: "var(--color-primary)", fontSize: "0.85rem", fontWeight: 600 }}>
                  Study →
                </span>
              </button>
              <button
                onClick={() => handleDeleteDeck(deck.id)}
                disabled={deleting === deck.id}
                aria-label={`Delete ${deck.title}`}
                style={deleteBtnStyle}
              >
                {deleting === deck.id ? "..." : "×"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Styles ---

const pageContainer: React.CSSProperties = {
  maxWidth: 700,
  margin: "0 auto",
  padding: "1.5rem 1rem",
  fontFamily: "var(--font-body)",
  color: "var(--color-text)",
};

const headerStyle: React.CSSProperties = { marginBottom: "1.5rem" };

const titleStyle: React.CSSProperties = {
  fontSize: "1.6rem",
  margin: "0 0 0.25rem",
  fontFamily: "var(--font-display)",
  color: "var(--color-primary)",
};

const subtitleStyle: React.CSSProperties = { color: "var(--color-text-muted)", margin: 0, fontSize: "0.9rem" };

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.75rem",
  color: "var(--color-text-dim)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: "0.35rem",
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem",
  fontSize: "0.85rem",
  fontFamily: "inherit",
  background: "var(--color-bg-card)",
  color: "var(--color-text)",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
};

const generateBtnStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.75rem 1.5rem",
  fontSize: "1.05rem",
  fontFamily: "var(--font-body)",
  fontWeight: 600,
  background: "var(--color-primary)",
  color: "var(--color-bg-darkest)",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
};

const sectionTitle: React.CSSProperties = {
  fontSize: "0.8rem",
  letterSpacing: "0.08em",
  color: "var(--color-info)",
  margin: "0 0 0.75rem",
  fontFamily: "var(--font-display)",
};

const deckCard: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "0.85rem 1rem",
  fontFamily: "inherit",
  background: "var(--color-bg-card)",
  color: "var(--color-text)",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  cursor: "pointer",
  textAlign: "left",
};

const deleteBtnStyle: React.CSSProperties = {
  padding: "0 0.65rem",
  fontFamily: "inherit",
  fontSize: "1.1rem",
  fontWeight: 700,
  background: "none",
  color: "var(--color-error)",
  border: "1px solid #e8888844",
  borderRadius: 6,
  cursor: "pointer",
  flexShrink: 0,
};

const cardStyle: React.CSSProperties = {
  minHeight: 200,
  padding: "1.5rem",
  borderRadius: 8,
  border: "2px solid var(--color-border)",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  transition: "background 0.2s, border-color 0.2s",
};

const progressBarBg: React.CSSProperties = {
  height: 4,
  background: "var(--color-bg-card)",
  borderRadius: 2,
  marginBottom: "0.25rem",
  overflow: "hidden",
};

const progressBarFill: React.CSSProperties = {
  height: "100%",
  background: "var(--color-info)",
  borderRadius: 2,
  transition: "width 0.3s",
};

const ratingBtn: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "0.15rem",
  padding: "0.6rem 0.3rem",
  fontSize: "0.8rem",
  fontFamily: "inherit",
  fontWeight: 600,
  background: "var(--color-bg-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  cursor: "pointer",
};

const backBtn: React.CSSProperties = {
  fontSize: "0.8rem",
  fontFamily: "inherit",
  color: "var(--color-text-dim)",
  background: "none",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: 4,
  padding: "0.3rem 0.6rem",
  cursor: "pointer",
};

const tagStyle: React.CSSProperties = {
  fontSize: "0.6rem",
  background: "#7ec8e322",
  color: "var(--color-info)",
  padding: "0.1rem 0.4rem",
  borderRadius: 3,
  letterSpacing: "0.03em",
};
