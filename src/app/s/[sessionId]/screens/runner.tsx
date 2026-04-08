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
  // Consolidated AI feedback content — avoids 8 separate setState calls
  const emptyFeedback: FeedbackResult = { status: "", excerpts: [] };
  const [fb, setFb] = useState<FeedbackResult>(emptyFeedback);
  const [confidence, setConfidence] = useState<number>(3);
  const [selfExplanation, setSelfExplanation] = useState("");
  const [generatedExample, setGeneratedExample] = useState("");
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
      !fb.explanation &&
      !fb.reinforcement &&
      uiPhase === "review";

    if (!shouldFetch) return;

    setFeedbackLoading(true);
    fetchFeedback(run.last_attempt_id!)
      .then((result: FeedbackResult) => {
        if (result.status === "OK") {
          if (result.excerpts.length > 0) setFeedbackExcerpts(result.excerpts);
          setFb(result);
        }
      })
      .catch(() => {
        // Feedback failure is non-fatal
      })
      .finally(() => setFeedbackLoading(false));
  }, [run.last_attempt_id, uiPhase, feedbackLoading, feedbackExcerpts.length, fb.explanation, fb.reinforcement]);

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
    setFb(emptyFeedback);
    setConfidence(3);
    setSelfExplanation("");
    setGeneratedExample("");
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
      confidence_rating: confidence,
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
      confidence_rating: confidence,
    };

    if (selfExplanation.trim()) attempt.self_explanation = selfExplanation.trim();
    if (generatedExample.trim()) attempt.generated_example = generatedExample.trim();

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
          color: "#a89a82",
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
            background: "#3d3050",
            border: "1px solid #9a70d0",
            borderRadius: 4,
            padding: "0.4rem 0.75rem",
            marginBottom: "0.75rem",
            fontSize: "0.7rem",
            color: "#c4a0ff",
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
            background: "#2d4a3d",
            border: "1px solid #5aa0c0",
            borderRadius: 4,
            padding: "0.4rem 0.75rem",
            marginBottom: "0.75rem",
            fontSize: "0.7rem",
            color: "#7ec8e3",
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
          background: "#4a6a4a",
          borderRadius: 2,
          marginBottom: "1.5rem",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${progressPct}%`,
            background: isReviewPhase ? "#5aa0c0" : "#7ec8e3",
            transition: "width 0.3s ease",
          }}
        />
      </div>

      {/* Prompt */}
      <div
        style={{
          background: "#334d33",
          border: "1px solid #4a6a4a",
          borderRadius: 6,
          padding: "1.25rem",
          marginBottom: "1.25rem",
        }}
      >
        <div
          style={{
            fontSize: "0.7rem",
            color: "#7ec8e3",
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
            background: "#334d33",
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
          {/* Confidence rating */}
          {answer.trim() && (
            <div
              style={{
                background: "#334d33",
                border: "1px solid #4a6a4a",
                borderRadius: 6,
                padding: "0.75rem 1rem",
                marginBottom: "0.75rem",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
                <span style={{ fontSize: "0.8rem", color: "#c8bca8" }}>How confident are you?</span>
                <span style={{ fontSize: "0.8rem", fontWeight: 600, color: confidenceColors[confidence - 1] }}>
                  {confidenceLabels[confidence - 1]}
                </span>
              </div>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                {[1, 2, 3, 4, 5].map((level) => (
                  <button
                    key={level}
                    onClick={() => setConfidence(level)}
                    style={{
                      flex: 1,
                      padding: "0.4rem",
                      fontSize: "0.8rem",
                      fontWeight: confidence === level ? 700 : 400,
                      background: confidence === level ? confidenceColors[level - 1] + "33" : "#334d33",
                      color: confidence === level ? confidenceColors[level - 1] : "#7a7060",
                      border: `1px solid ${confidence === level ? confidenceColors[level - 1] : "#4a6a4a"}`,
                      borderRadius: 4,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.7rem", color: "#7a7060" }}>Ctrl+Enter to submit</span>
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
                background: "#334d33",
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

          <p style={{ fontSize: "0.85rem", color: "#c8bca8", marginBottom: "0.75rem" }}>
            How did you do? Be honest.
          </p>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button onClick={() => handleScore("CORRECT")} style={scoreBtn("#88cc88")}>
              ✓ Correct
            </button>
            <button onClick={() => handleScore("PARTIAL")} style={scoreBtn("#e8a040")}>
              ~ Partial
            </button>
            <button onClick={() => handleScore("INCORRECT")} style={scoreBtn("#e88888")}>
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
              background: score === "INCORRECT" ? "#4a3030" : "#4a4030",
              border: `1px solid ${score === "INCORRECT" ? "#e88888" : "#e8a040"}`,
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
              Correction rule <span style={{ color: "#e88888" }}>*</span>
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
          {lastScore === "CORRECT" && (fb.reinforcement || fb.deeper_insight || fb.concept_connection || fb.socratic_followup) && (
            <div
              style={{
                background: "#334d33",
                border: "1px solid #88cc88",
                borderRadius: 6,
                padding: "1rem",
                marginBottom: "1rem",
              }}
            >
              <p style={{ margin: "0 0 0.75rem", fontSize: "0.85rem", fontWeight: 600, color: "#88cc88" }}>
                Nice work!
              </p>
              {fb.reinforcement && (
                <p style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", lineHeight: 1.6 }}>
                  {fb.reinforcement}
                </p>
              )}
              {fb.deeper_insight && (
                <div style={insightBox}>
                  <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: "#7ec8e3", marginBottom: "0.3rem" }}>
                    Deeper Insight
                  </p>
                  <p style={{ margin: 0, fontSize: "0.8rem", lineHeight: 1.5 }}>
                    {fb.deeper_insight}
                  </p>
                </div>
              )}
              {fb.concept_connection && (
                <div style={{ ...insightBox, borderColor: "#c4a0ff" }}>
                  <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: "#c4a0ff", marginBottom: "0.3rem" }}>
                    Connection
                  </p>
                  <p style={{ margin: 0, fontSize: "0.8rem", lineHeight: 1.5 }}>
                    {fb.concept_connection}
                  </p>
                </div>
              )}
              {fb.socratic_followup && (
                <div style={{ ...insightBox, borderColor: "#f0dc4e" }}>
                  <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: "#f0dc4e", marginBottom: "0.3rem" }}>
                    Think Deeper
                  </p>
                  <p style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.5, fontStyle: "italic" }}>
                    {fb.socratic_followup}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* CORRECT with no AI feedback yet — show brief loading or skip */}
          {lastScore === "CORRECT" && !fb.reinforcement && !fb.deeper_insight && !fb.concept_connection && !fb.socratic_followup && (
            <div
              style={{
                background: "#334d33",
                border: "1px solid #88cc88",
                borderRadius: 6,
                padding: "1rem",
                marginBottom: "1rem",
              }}
            >
              <p style={{ margin: 0, fontSize: "0.85rem", fontWeight: 600, color: "#88cc88" }}>
                {feedbackLoading ? "Generating insight..." : "Correct!"}
              </p>
            </div>
          )}

          {/* AI Explanation for PARTIAL/INCORRECT answers */}
          {lastScore && lastScore !== "CORRECT" && (
            <div
              style={{
                background: "#334d33",
                border: "1px solid #88cc88",
                borderRadius: 6,
                padding: "1rem",
                marginBottom: "1rem",
              }}
            >
              <p style={{ margin: "0 0 0.75rem", fontSize: "0.85rem", fontWeight: 600, color: "#88cc88" }}>
                REVIEW (from your materials)
              </p>

              {/* AI-powered explanation */}
              {fb.explanation && (
                <div
                  style={{
                    background: "#334d33",
                    border: "1px solid #7ec8e3",
                    borderRadius: 4,
                    padding: "0.75rem",
                    marginBottom: "0.75rem",
                  }}
                >
                  <p style={{ margin: "0 0 0.5rem", fontSize: "0.75rem", fontWeight: 600, color: "#7ec8e3" }}>
                    Professor&apos;s Explanation
                  </p>
                  <p style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.6 }}>
                    {fb.explanation}
                  </p>
                  {fb.key_takeaway && (
                    <div
                      style={{
                        background: "#2d422d",
                        borderRadius: 4,
                        padding: "0.5rem 0.75rem",
                        marginTop: "0.5rem",
                      }}
                    >
                      <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: "#f0dc4e" }}>
                        Key Takeaway: {fb.key_takeaway}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {feedbackLoading && !fb.explanation && (
                <p style={{ fontSize: "0.8rem", color: "#a89a82", fontStyle: "italic" }} data-testid="feedback-loading">
                  Loading feedback...
                </p>
              )}

              {/* Raw excerpts from course materials */}
              {feedbackExcerpts.map((excerpt, i) => (
                <div
                  key={excerpt.chunk_id}
                  style={{
                    background: "#334d33",
                    border: "1px solid #4a6a4a",
                    borderRadius: 4,
                    padding: "0.75rem",
                    marginBottom: i < feedbackExcerpts.length - 1 ? "0.5rem" : 0,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.7rem", color: "#a89a82", marginBottom: "0.4rem" }}>
                    <span data-testid="excerpt-doc-title">{excerpt.doc_title}</span>
                    {excerpt.page_number && <span>p. {excerpt.page_number}</span>}
                  </div>
                  <p
                    style={{ margin: 0, fontSize: "0.8rem", lineHeight: 1.5 }}
                    dangerouslySetInnerHTML={{
                      __html: excerpt.snippet
                        .replace(/<<(.*?)>>/g, '<mark style="background:#7ec8e333;color:#7ec8e3">$1</mark>'),
                    }}
                  />
                </div>
              ))}

              {!feedbackLoading && feedbackExcerpts.length === 0 && !fb.explanation && (
                <p style={{ fontSize: "0.8rem", color: "#a89a82", fontStyle: "italic" }}>
                  No relevant excerpts found in your materials.
                </p>
              )}

              {/* Concept connection */}
              {fb.concept_connection && (
                <div style={{ ...insightBox, borderColor: "#c4a0ff", marginTop: "0.75rem" }}>
                  <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: "#c4a0ff", marginBottom: "0.3rem" }}>
                    Connection
                  </p>
                  <p style={{ margin: 0, fontSize: "0.8rem", lineHeight: 1.5 }}>
                    {fb.concept_connection}
                  </p>
                </div>
              )}

              {/* Mnemonic / memory aid */}
              {fb.mnemonic && (
                <div style={{ ...insightBox, borderColor: "#88cc88", marginTop: "0.5rem" }}>
                  <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: "#88cc88", marginBottom: "0.3rem" }}>
                    Memory Aid
                  </p>
                  <p style={{ margin: 0, fontSize: "0.8rem", lineHeight: 1.5 }}>
                    {fb.mnemonic}
                  </p>
                </div>
              )}

              {/* Mistake pattern advice */}
              {fb.pattern_advice && (
                <div style={{ ...insightBox, borderColor: "#e8a040", marginTop: "0.5rem" }}>
                  <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: "#e8a040", marginBottom: "0.3rem" }}>
                    Pattern Noticed
                  </p>
                  <p style={{ margin: 0, fontSize: "0.8rem", lineHeight: 1.5 }}>
                    {fb.pattern_advice}
                  </p>
                </div>
              )}

              {/* Socratic follow-up */}
              {fb.socratic_followup && (
                <div style={{ ...insightBox, borderColor: "#f0dc4e", marginTop: "0.5rem" }}>
                  <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: "#f0dc4e", marginBottom: "0.3rem" }}>
                    Think Deeper
                  </p>
                  <p style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.5, fontStyle: "italic" }}>
                    {fb.socratic_followup}
                  </p>
                </div>
              )}

              {/* Repair prompt for PARTIAL/INCORRECT */}
              {(correctionRule || variantQuestion) && (
                <div
                  style={{
                    background: "#4a3030",
                    border: "1px solid #e8888855",
                    borderRadius: 4,
                    padding: "0.75rem",
                    marginTop: "0.75rem",
                  }}
                >
                  <p style={{ margin: "0 0 0.5rem", fontSize: "0.75rem", fontWeight: 600, color: "#e88888" }}>
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
                  <p style={{ margin: "0.5rem 0 0", fontSize: "0.7rem", color: "#a89a82", fontStyle: "italic" }}>
                    Say the correct answer aloud once before moving on.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Self-explanation prompt (all scores, after feedback loads) */}
          {!feedbackLoading && (fb.explanation || fb.reinforcement || lastScore) && (
            <div
              style={{
                background: "#334d33",
                border: "1px solid #4a6a4a",
                borderRadius: 6,
                padding: "0.75rem 1rem",
                marginBottom: "0.75rem",
              }}
            >
              <p style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", fontWeight: 600, color: "#e8dcc8" }}>
                Now explain this in your own words (optional):
              </p>
              <textarea
                value={selfExplanation}
                onChange={(e) => setSelfExplanation(e.target.value)}
                placeholder="Restate the key concept as if teaching a friend..."
                rows={2}
                style={{ ...textareaStyle, marginBottom: 0 }}
              />
            </div>
          )}

          {/* Generation effect: create your own example (for correct answers) */}
          {lastScore === "CORRECT" && !feedbackLoading && (
            <div
              style={{
                background: "#334d33",
                border: "1px solid #4a6a4a",
                borderRadius: 6,
                padding: "0.75rem 1rem",
                marginBottom: "0.75rem",
              }}
            >
              <p style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", fontWeight: 600, color: "#e8dcc8" }}>
                Create your own example of this concept (optional):
              </p>
              <textarea
                value={generatedExample}
                onChange={(e) => setGeneratedExample(e.target.value)}
                placeholder="Think of a new scenario where this concept applies..."
                rows={2}
                style={{ ...textareaStyle, marginBottom: 0 }}
              />
            </div>
          )}

          <button
            onClick={() => {
              // If user typed self-explanation or example, submit update
              if (selfExplanation.trim() || generatedExample.trim()) {
                onSubmit({
                  prompt_index: currentIndex,
                  user_answer: answer || "(review update)",
                  self_score: lastScore || "CORRECT",
                  self_explanation: selfExplanation.trim() || undefined,
                  generated_example: generatedExample.trim() || undefined,
                  _meta_update: true, // Signal this is a metadata-only update
                });
              }
              setFeedbackExcerpts([]);
              setFeedbackLoading(false);
              setLastScore(null);
              setFb(emptyFeedback);
              setConfidence(3);
              setSelfExplanation("");
              setGeneratedExample("");
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

// --- Constants ---

const confidenceLabels = ["Guessing", "Unsure", "Somewhat", "Confident", "Very Sure"];
const confidenceColors = ["#e88888", "#e8a040", "#d8c840", "#88cc88", "#6aaa6a"];

// --- Styles ---

const insightBox: React.CSSProperties = {
  background: "#334d33",
  border: "1px solid #4a6a4a",
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
  background: "#7ec8e3",
  color: "#1f2e1f",
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
  background: "#334d33",
  color: "#e8dcc8",
  border: "1px solid #4a6a4a",
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
  background: "#334d33",
  color: "#e8dcc8",
  border: "1px solid #4a6a4a",
  borderRadius: 6,
  marginBottom: "0.75rem",
};

const fieldLabel: React.CSSProperties = {
  display: "block",
  fontSize: "0.75rem",
  color: "#a89a82",
  marginBottom: "0.25rem",
};
