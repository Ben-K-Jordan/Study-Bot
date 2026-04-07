"use client";

import { useState, useRef, useEffect } from "react";
import type { RunData, SessionData, FeedbackExcerpt, FeedbackResult } from "../session-runner";
import { fetchFeedback } from "../session-runner";

const ERROR_TYPES = [
  { value: "MISCONCEPTION", label: "Misconception" },
  { value: "PROCEDURE", label: "Procedure Error" },
  { value: "CARELESS", label: "Careless Mistake" },
  { value: "MEMORY", label: "Memory Gap" },
  { value: "UNKNOWN", label: "Unknown" },
];

interface Props {
  run: RunData;
  session: SessionData;
  onSubmit: (attempt: Record<string, unknown>) => void;
  onComplete: () => void;
}

type UIPhase = "answering" | "scoring" | "error_log" | "review";

export function RunnerScreen({ run, session, onSubmit, onComplete }: Props) {
  const isExamSim = run.mode === "EXAM_SIM";
  const isExamPhase = isExamSim && run.phase === "EXAM";
  const isReviewPhase = isExamSim && run.phase === "REVIEW";

  const [uiPhase, setUIPhase] = useState<UIPhase>(() =>
    isReviewPhase ? "scoring" : "answering"
  );
  const [answer, setAnswer] = useState("");
  const [score, setScore] = useState<string | null>(null);
  const [errorType, setErrorType] = useState("MISCONCEPTION");
  const [correctionRule, setCorrectionRule] = useState("");
  const [variantQuestion, setVariantQuestion] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedbackExcerpts, setFeedbackExcerpts] = useState<FeedbackExcerpt[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [lastScore, setLastScore] = useState<string | null>(null);
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [aiKeyTakeaway, setAiKeyTakeaway] = useState<string | null>(null);
  const [aiReinforcement, setAiReinforcement] = useState<string | null>(null);
  const [aiDeeperInsight, setAiDeeperInsight] = useState<string | null>(null);
  const [conceptConnection, setConceptConnection] = useState<string | null>(null);
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [patternAdvice, setPatternAdvice] = useState<string | null>(null);
  const [socraticFollowup, setSocraticFollowup] = useState<string | null>(null);
  const startTimeRef = useRef(Date.now());
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Use current_prompt from run data (Phase 2: no full prompt array needed)
  const currentPrompt = run.current_prompt;
  const currentIndex = run.current_index;
  const total = run.prompt_count || run.prompts?.length || 0;

  // For EXAM_SIM, progress tracking differs by phase
  const progressLabel = isExamSim
    ? isExamPhase
      ? `ANSWERING ${currentIndex + 1} / ${total}`
      : `REVIEWING ${currentIndex + 1} / ${total}`
    : `PROMPT ${currentIndex + 1} / ${total}`;

  const progressPct = total > 0 ? (currentIndex / total) * 100 : 0;

  // Get saved answer for REVIEW phase
  const savedAnswer = isReviewPhase && run.attempts
    ? run.attempts.find((a) => a.prompt_index === currentIndex)?.user_answer ?? ""
    : "";

  // Phase 1: Deferred feedback — fetch after scoring (all scores, including CORRECT)
  useEffect(() => {
    const shouldFetch =
      run.last_attempt_id &&
      !feedbackLoading &&
      feedbackExcerpts.length === 0 &&
      !aiExplanation &&
      !aiReinforcement &&
      uiPhase === "review";

    if (!shouldFetch) return;

    setFeedbackLoading(true);
    fetchFeedback(run.last_attempt_id!)
      .then((result: FeedbackResult) => {
        if (result.status === "OK") {
          if (result.excerpts.length > 0) setFeedbackExcerpts(result.excerpts);
          if (result.explanation) setAiExplanation(result.explanation);
          if (result.key_takeaway) setAiKeyTakeaway(result.key_takeaway);
          if (result.reinforcement) setAiReinforcement(result.reinforcement);
          if (result.deeper_insight) setAiDeeperInsight(result.deeper_insight);
          if (result.concept_connection) setConceptConnection(result.concept_connection);
          if (result.mnemonic) setMnemonic(result.mnemonic);
          if (result.pattern_advice) setPatternAdvice(result.pattern_advice);
          if (result.socratic_followup) setSocraticFollowup(result.socratic_followup);
        }
      })
      .catch(() => {
        // Feedback failure is non-fatal
      })
      .finally(() => setFeedbackLoading(false));
  }, [run.last_attempt_id, uiPhase, feedbackLoading, feedbackExcerpts.length, aiExplanation, aiReinforcement]);

  // Reset state when prompt changes
  useEffect(() => {
    if (uiPhase === "review" && (feedbackExcerpts.length > 0 || feedbackLoading)) return;
    if (isReviewPhase) {
      setUIPhase("scoring");
    } else {
      setUIPhase("answering");
    }
    setAnswer("");
    setScore(null);
    setCorrectionRule("");
    setVariantQuestion("");
    setErrorType("MISCONCEPTION");
    setFeedbackExcerpts([]);
    setFeedbackLoading(false);
    setLastScore(null);
    setAiExplanation(null);
    setAiKeyTakeaway(null);
    setAiReinforcement(null);
    setAiDeeperInsight(null);
    setConceptConnection(null);
    setMnemonic(null);
    setPatternAdvice(null);
    setSocraticFollowup(null);
    startTimeRef.current = Date.now();
    if (!isReviewPhase) {
      textareaRef.current?.focus();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, isReviewPhase]);

  if (!currentPrompt) {
    // All prompts completed for this phase
    if (isExamPhase) {
      return (
        <div style={{ textAlign: "center", padding: "2rem 0" }}>
          <p style={{ fontSize: "1.2rem", marginBottom: "1rem" }}>All answers submitted. Transitioning to review...</p>
        </div>
      );
    }
    return (
      <div style={{ textAlign: "center", padding: "2rem 0" }}>
        <p style={{ fontSize: "1.2rem", marginBottom: "1rem" }}>All prompts completed!</p>
        <button onClick={onComplete} style={primaryBtn}>
          View Summary
        </button>
      </div>
    );
  }

  const handleAnswerSubmit = () => {
    if (!answer.trim()) return;
    if (isExamPhase) {
      doExamAnswer();
    } else {
      setUIPhase("scoring");
    }
  };

  const doExamAnswer = async () => {
    setSubmitting(true);
    const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000);
    await onSubmit({
      prompt_index: currentIndex,
      kind: "ANSWER",
      user_answer: answer,
      time_to_answer_seconds: elapsed,
    });
    setSubmitting(false);
  };

  const handleScore = (s: string) => {
    setScore(s);
    if (s === "CORRECT") {
      if (isReviewPhase) {
        doReviewScore(s);
      } else {
        doImmediateSubmit(s);
      }
    } else {
      setUIPhase("error_log");
    }
  };

  const doImmediateSubmit = async (finalScore?: string) => {
    const s = finalScore || score;
    if (!s) return;
    setSubmitting(true);
    setLastScore(s);

    const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000);
    const attempt: Record<string, unknown> = {
      prompt_index: currentIndex,
      user_answer: answer,
      self_score: s,
      time_to_answer_seconds: elapsed,
    };

    if (s !== "CORRECT" && correctionRule.trim()) {
      attempt.error_log = {
        error_type: errorType,
        correction_rule: correctionRule.trim(),
        variant_question: variantQuestion.trim() || undefined,
      };
    }

    await onSubmit(attempt);
    setSubmitting(false);

    // Show review phase for all scores (CORRECT gets reinforcement, others get explanation)
    setUIPhase("review");
  };

  const doReviewScore = async (finalScore?: string) => {
    const s = finalScore || score;
    if (!s) return;
    setSubmitting(true);
    setLastScore(s);

    const attempt: Record<string, unknown> = {
      prompt_index: currentIndex,
      kind: "SCORE",
      self_score: s,
    };

    if (s !== "CORRECT" && correctionRule.trim()) {
      attempt.error_log = {
        error_type: errorType,
        correction_rule: correctionRule.trim(),
        variant_question: variantQuestion.trim() || undefined,
      };
    }

    await onSubmit(attempt);
    setSubmitting(false);

    // Show review phase for all scores
    setUIPhase("review");
  };

  return (
    <div>
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.5rem",
          fontSize: "0.75rem",
          color: "#888",
        }}
      >
        <span>
          {session.course_name} | {session.mode_label}
        </span>
        <span>
          {run.metrics.correct_count}✓ {run.metrics.partial_count}~ {run.metrics.incorrect_count}✗
        </span>
      </div>

      {/* EXAM MODE banner */}
      {isExamPhase && (
        <div
          style={{
            background: "#2d1b4e",
            border: "1px solid #6c3fc0",
            borderRadius: 4,
            padding: "0.4rem 0.75rem",
            marginBottom: "0.75rem",
            fontSize: "0.7rem",
            color: "#c9a0ff",
            textAlign: "center",
            letterSpacing: "0.05em",
          }}
        >
          EXAM MODE — feedback after all answers
        </div>
      )}

      {/* REVIEW MODE banner */}
      {isReviewPhase && (
        <div
          style={{
            background: "#1b3a4e",
            border: "1px solid #3f8cc0",
            borderRadius: 4,
            padding: "0.4rem 0.75rem",
            marginBottom: "0.75rem",
            fontSize: "0.7rem",
            color: "#a0d4ff",
            textAlign: "center",
            letterSpacing: "0.05em",
          }}
        >
          REVIEW PHASE — score your answers
        </div>
      )}

      {/* Progress bar */}
      <div
        style={{
          height: 4,
          background: "#333",
          borderRadius: 2,
          marginBottom: "1.5rem",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${progressPct}%`,
            background: isReviewPhase ? "#3f8cc0" : "#4cc9f0",
            transition: "width 0.3s ease",
          }}
        />
      </div>

      {/* Prompt */}
      <div
        style={{
          background: "#16213e",
          border: "1px solid #333",
          borderRadius: 6,
          padding: "1.25rem",
          marginBottom: "1.25rem",
        }}
      >
        <div
          style={{
            fontSize: "0.7rem",
            color: "#4cc9f0",
            marginBottom: "0.5rem",
            letterSpacing: "0.08em",
          }}
        >
          {progressLabel}
        </div>
        <p style={{ margin: 0, fontSize: "1rem", lineHeight: 1.5 }}>
          {currentPrompt.text}
        </p>
      </div>

      {/* REVIEW: show saved answer read-only */}
      {isReviewPhase && savedAnswer && (
        <div
          style={{
            background: "#0f3460",
            borderRadius: 6,
            padding: "1rem",
            marginBottom: "1rem",
            fontSize: "0.85rem",
            lineHeight: 1.6,
          }}
        >
          <strong>Your answer:</strong>
          <p style={{ margin: "0.5rem 0 0", whiteSpace: "pre-wrap" }}>{savedAnswer}</p>
        </div>
      )}

      {/* Answering phase */}
      {uiPhase === "answering" && !isReviewPhase && (
        <div>
          <textarea
            ref={textareaRef}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Type your answer from memory..."
            rows={6}
            style={textareaStyle}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                handleAnswerSubmit();
              }
            }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.7rem", color: "#666" }}>Ctrl+Enter to submit</span>
            <button
              onClick={handleAnswerSubmit}
              disabled={!answer.trim() || submitting}
              style={{
                ...primaryBtn,
                width: "auto",
                padding: "0.6rem 1.5rem",
                opacity: answer.trim() && !submitting ? 1 : 0.4,
              }}
            >
              {submitting ? "Submitting..." : "Submit Answer"}
            </button>
          </div>
        </div>
      )}

      {/* Scoring phase */}
      {uiPhase === "scoring" && (
        <div>
          {!isReviewPhase && (
            <div
              style={{
                background: "#0f3460",
                borderRadius: 6,
                padding: "1rem",
                marginBottom: "1rem",
                fontSize: "0.85rem",
                lineHeight: 1.6,
              }}
            >
              <strong>Your answer:</strong>
              <p style={{ margin: "0.5rem 0 0", whiteSpace: "pre-wrap" }}>{answer}</p>
            </div>
          )}

          <p style={{ fontSize: "0.85rem", color: "#ccc", marginBottom: "0.75rem" }}>
            How did you do? Be honest.
          </p>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={() => handleScore("CORRECT")} style={scoreBtn("#2ecc71")}>
              ✓ Correct
            </button>
            <button onClick={() => handleScore("PARTIAL")} style={scoreBtn("#f39c12")}>
              ~ Partial
            </button>
            <button onClick={() => handleScore("INCORRECT")} style={scoreBtn("#e74c3c")}>
              ✗ Incorrect
            </button>
          </div>
        </div>
      )}

      {/* Error logging phase */}
      {uiPhase === "error_log" && (
        <div>
          <div
            style={{
              background: score === "INCORRECT" ? "#3d1111" : "#3d2e11",
              border: `1px solid ${score === "INCORRECT" ? "#e74c3c" : "#f39c12"}`,
              borderRadius: 6,
              padding: "1rem",
              marginBottom: "1rem",
            }}
          >
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.85rem", fontWeight: 600 }}>
              {score === "INCORRECT" ? "✗ Incorrect" : "~ Partial"} — Log the error
            </p>

            <label style={fieldLabel}>Error type</label>
            <select
              value={errorType}
              onChange={(e) => setErrorType(e.target.value)}
              style={selectStyle}
            >
              {ERROR_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>

            <label style={fieldLabel}>
              Correction rule <span style={{ color: "#e74c3c" }}>*</span>
            </label>
            <textarea
              value={correctionRule}
              onChange={(e) => setCorrectionRule(e.target.value)}
              placeholder="Write the correct rule/fact you should have known..."
              rows={2}
              style={{ ...textareaStyle, marginBottom: "0.75rem" }}
            />

            <label style={fieldLabel}>Variant question (optional)</label>
            <textarea
              value={variantQuestion}
              onChange={(e) => setVariantQuestion(e.target.value)}
              placeholder="Write a similar question for next time..."
              rows={2}
              style={textareaStyle}
            />
          </div>

          <button
            onClick={() => isReviewPhase ? doReviewScore() : doImmediateSubmit()}
            disabled={!correctionRule.trim() || submitting}
            style={{
              ...primaryBtn,
              opacity: correctionRule.trim() && !submitting ? 1 : 0.4,
            }}
          >
            {submitting ? "Saving..." : "Save & Next Prompt"}
          </button>
        </div>
      )}

      {/* Review & Repair panel — shown AFTER scoring with deferred feedback */}
      {uiPhase === "review" && (
        <div data-testid="review-panel">
          {/* AI Reinforcement for CORRECT answers */}
          {lastScore === "CORRECT" && (aiReinforcement || aiDeeperInsight || conceptConnection || socraticFollowup) && (
            <div
              style={{
                background: "#1a2e1a",
                border: "1px solid #2ecc71",
                borderRadius: 6,
                padding: "1rem",
                marginBottom: "1rem",
              }}
            >
              <p style={{ margin: "0 0 0.75rem", fontSize: "0.85rem", fontWeight: 600, color: "#2ecc71" }}>
                Nice work!
              </p>
              {aiReinforcement && (
                <p style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", lineHeight: 1.6 }}>
                  {aiReinforcement}
                </p>
              )}
              {aiDeeperInsight && (
                <div style={insightBox}>
                  <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: "#4cc9f0", marginBottom: "0.3rem" }}>
                    Deeper Insight
                  </p>
                  <p style={{ margin: 0, fontSize: "0.8rem", lineHeight: 1.5 }}>
                    {aiDeeperInsight}
                  </p>
                </div>
              )}
              {conceptConnection && (
                <div style={{ ...insightBox, borderColor: "#a78bfa" }}>
                  <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: "#a78bfa", marginBottom: "0.3rem" }}>
                    Connection
                  </p>
                  <p style={{ margin: 0, fontSize: "0.8rem", lineHeight: 1.5 }}>
                    {conceptConnection}
                  </p>
                </div>
              )}
              {socraticFollowup && (
                <div style={{ ...insightBox, borderColor: "#fbbf24" }}>
                  <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: "#fbbf24", marginBottom: "0.3rem" }}>
                    Think Deeper
                  </p>
                  <p style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.5, fontStyle: "italic" }}>
                    {socraticFollowup}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* CORRECT with no AI feedback yet — show brief loading or skip */}
          {lastScore === "CORRECT" && !aiReinforcement && !aiDeeperInsight && !conceptConnection && !socraticFollowup && (
            <div
              style={{
                background: "#1a2e1a",
                border: "1px solid #2ecc71",
                borderRadius: 6,
                padding: "1rem",
                marginBottom: "1rem",
              }}
            >
              <p style={{ margin: 0, fontSize: "0.85rem", fontWeight: 600, color: "#2ecc71" }}>
                {feedbackLoading ? "Generating insight..." : "Correct!"}
              </p>
            </div>
          )}

          {/* AI Explanation for PARTIAL/INCORRECT answers */}
          {lastScore && lastScore !== "CORRECT" && (
            <div
              style={{
                background: "#1a2e1a",
                border: "1px solid #2ecc71",
                borderRadius: 6,
                padding: "1rem",
                marginBottom: "1rem",
              }}
            >
              <p style={{ margin: "0 0 0.75rem", fontSize: "0.85rem", fontWeight: 600, color: "#2ecc71" }}>
                REVIEW (from your materials)
              </p>

              {/* AI-powered explanation */}
              {aiExplanation && (
                <div
                  style={{
                    background: "#1e293b",
                    border: "1px solid #3b82f6",
                    borderRadius: 4,
                    padding: "0.75rem",
                    marginBottom: "0.75rem",
                  }}
                >
                  <p style={{ margin: "0 0 0.5rem", fontSize: "0.75rem", fontWeight: 600, color: "#3b82f6" }}>
                    Professor&apos;s Explanation
                  </p>
                  <p style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.6 }}>
                    {aiExplanation}
                  </p>
                  {aiKeyTakeaway && (
                    <div
                      style={{
                        background: "#172554",
                        borderRadius: 4,
                        padding: "0.5rem 0.75rem",
                        marginTop: "0.5rem",
                      }}
                    >
                      <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: "#fbbf24" }}>
                        Key Takeaway: {aiKeyTakeaway}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {feedbackLoading && !aiExplanation && (
                <p style={{ fontSize: "0.8rem", color: "#aaa", fontStyle: "italic" }} data-testid="feedback-loading">
                  Loading feedback...
                </p>
              )}

              {/* Raw excerpts from course materials */}
              {feedbackExcerpts.map((excerpt, i) => (
                <div
                  key={excerpt.chunk_id}
                  style={{
                    background: "#16213e",
                    border: "1px solid #333",
                    borderRadius: 4,
                    padding: "0.75rem",
                    marginBottom: i < feedbackExcerpts.length - 1 ? "0.5rem" : 0,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", color: "#888", marginBottom: "0.4rem" }}>
                    <span data-testid="excerpt-doc-title">{excerpt.doc_title}</span>
                    {excerpt.page_number && <span>p. {excerpt.page_number}</span>}
                  </div>
                  <p
                    style={{ margin: 0, fontSize: "0.8rem", lineHeight: 1.5 }}
                    dangerouslySetInnerHTML={{
                      __html: excerpt.snippet
                        .replace(/<<(.*?)>>/g, '<mark style="background:#4cc9f033;color:#4cc9f0">$1</mark>'),
                    }}
                  />
                </div>
              ))}

              {!feedbackLoading && feedbackExcerpts.length === 0 && !aiExplanation && (
                <p style={{ fontSize: "0.8rem", color: "#aaa", fontStyle: "italic" }}>
                  No relevant excerpts found in your materials.
                </p>
              )}

              {/* Concept connection */}
              {conceptConnection && (
                <div style={{ ...insightBox, borderColor: "#a78bfa", marginTop: "0.75rem" }}>
                  <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: "#a78bfa", marginBottom: "0.3rem" }}>
                    Connection
                  </p>
                  <p style={{ margin: 0, fontSize: "0.8rem", lineHeight: 1.5 }}>
                    {conceptConnection}
                  </p>
                </div>
              )}

              {/* Mnemonic / memory aid */}
              {mnemonic && (
                <div style={{ ...insightBox, borderColor: "#34d399", marginTop: "0.5rem" }}>
                  <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: "#34d399", marginBottom: "0.3rem" }}>
                    Memory Aid
                  </p>
                  <p style={{ margin: 0, fontSize: "0.8rem", lineHeight: 1.5 }}>
                    {mnemonic}
                  </p>
                </div>
              )}

              {/* Mistake pattern advice */}
              {patternAdvice && (
                <div style={{ ...insightBox, borderColor: "#f97316", marginTop: "0.5rem" }}>
                  <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: "#f97316", marginBottom: "0.3rem" }}>
                    Pattern Noticed
                  </p>
                  <p style={{ margin: 0, fontSize: "0.8rem", lineHeight: 1.5 }}>
                    {patternAdvice}
                  </p>
                </div>
              )}

              {/* Socratic follow-up */}
              {socraticFollowup && (
                <div style={{ ...insightBox, borderColor: "#fbbf24", marginTop: "0.5rem" }}>
                  <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: "#fbbf24", marginBottom: "0.3rem" }}>
                    Think Deeper
                  </p>
                  <p style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.5, fontStyle: "italic" }}>
                    {socraticFollowup}
                  </p>
                </div>
              )}

              {/* Repair prompt for PARTIAL/INCORRECT */}
              {(correctionRule || variantQuestion) && (
                <div
                  style={{
                    background: "#2d1b1b",
                    border: "1px solid #e74c3c55",
                    borderRadius: 4,
                    padding: "0.75rem",
                    marginTop: "0.75rem",
                  }}
                >
                  <p style={{ margin: "0 0 0.5rem", fontSize: "0.75rem", fontWeight: 600, color: "#e74c3c" }}>
                    Repair Prompt
                  </p>
                  {correctionRule && (
                    <p style={{ margin: "0 0 0.3rem", fontSize: "0.8rem" }}>
                      <strong>Rule:</strong> {correctionRule}
                    </p>
                  )}
                  {variantQuestion && (
                    <p style={{ margin: "0 0 0.3rem", fontSize: "0.8rem" }}>
                      <strong>Try this:</strong> {variantQuestion}
                    </p>
                  )}
                  <p style={{ margin: "0.5rem 0 0", fontSize: "0.7rem", color: "#aaa", fontStyle: "italic" }}>
                    Say the correct answer aloud once before moving on.
                  </p>
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => {
              setFeedbackExcerpts([]);
              setFeedbackLoading(false);
              setLastScore(null);
              setAiExplanation(null);
              setAiKeyTakeaway(null);
              setAiReinforcement(null);
              setAiDeeperInsight(null);
              setConceptConnection(null);
              setMnemonic(null);
              setPatternAdvice(null);
              setSocraticFollowup(null);
              if (isReviewPhase) {
                setUIPhase("scoring");
              } else {
                setUIPhase("answering");
              }
            }}
            style={primaryBtn}
          >
            Next Prompt
          </button>
        </div>
      )}
    </div>
  );
}

// --- Styles ---

const insightBox: React.CSSProperties = {
  background: "#16213e",
  border: "1px solid #333",
  borderRadius: 4,
  padding: "0.75rem",
  marginTop: "0.5rem",
};

const primaryBtn: React.CSSProperties = {
  width: "100%",
  padding: "0.75rem",
  fontSize: "0.9rem",
  fontFamily: "inherit",
  fontWeight: 600,
  background: "#4cc9f0",
  color: "#1a1a2e",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
};

const scoreBtn = (color: string): React.CSSProperties => ({
  flex: 1,
  padding: "0.75rem",
  fontSize: "0.85rem",
  fontFamily: "inherit",
  fontWeight: 600,
  background: "transparent",
  color,
  border: `2px solid ${color}`,
  borderRadius: 6,
  cursor: "pointer",
});

const textareaStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.75rem",
  fontSize: "0.85rem",
  fontFamily: "inherit",
  background: "#16213e",
  color: "#e0e0e0",
  border: "1px solid #333",
  borderRadius: 6,
  resize: "vertical",
  marginBottom: "0.5rem",
  boxSizing: "border-box",
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem",
  fontSize: "0.85rem",
  fontFamily: "inherit",
  background: "#16213e",
  color: "#e0e0e0",
  border: "1px solid #333",
  borderRadius: 6,
  marginBottom: "0.75rem",
};

const fieldLabel: React.CSSProperties = {
  display: "block",
  fontSize: "0.75rem",
  color: "#aaa",
  marginBottom: "0.25rem",
};
