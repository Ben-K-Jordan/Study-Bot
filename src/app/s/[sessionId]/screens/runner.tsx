"use client";

import { useState, useRef, useEffect } from "react";
import type { RunData, SessionData } from "../session-runner";

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
  onSubmit: (attempt: {
    prompt_index: number;
    user_answer: string;
    self_score: string;
    time_to_answer_seconds?: number;
    error_log?: {
      error_type: string;
      correction_rule: string;
      variant_question?: string;
    };
  }) => void;
  onComplete: () => void;
}

type Phase = "answering" | "scoring" | "error_log";

export function RunnerScreen({ run, session, onSubmit, onComplete }: Props) {
  const [phase, setPhase] = useState<Phase>("answering");
  const [answer, setAnswer] = useState("");
  const [score, setScore] = useState<string | null>(null);
  const [errorType, setErrorType] = useState("MISCONCEPTION");
  const [correctionRule, setCorrectionRule] = useState("");
  const [variantQuestion, setVariantQuestion] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const startTimeRef = useRef(Date.now());
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const prompts = run.prompts;
  const currentIndex = run.current_index;
  const currentPrompt = prompts[currentIndex];
  const total = prompts.length;
  const progress = total > 0 ? (currentIndex / total) * 100 : 0;

  // Reset state when prompt changes
  useEffect(() => {
    setPhase("answering");
    setAnswer("");
    setScore(null);
    setCorrectionRule("");
    setVariantQuestion("");
    setErrorType("MISCONCEPTION");
    startTimeRef.current = Date.now();
    textareaRef.current?.focus();
  }, [currentIndex]);

  if (!currentPrompt) {
    // All prompts completed
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
    setPhase("scoring");
  };

  const handleScore = (s: string) => {
    setScore(s);
    if (s === "CORRECT") {
      doSubmit(s);
    } else {
      setPhase("error_log");
    }
  };

  const doSubmit = async (finalScore?: string) => {
    const s = finalScore || score;
    if (!s) return;
    setSubmitting(true);

    const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000);
    const attempt: Parameters<typeof onSubmit>[0] = {
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
            width: `${progress}%`,
            background: "#4cc9f0",
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
          PROMPT {currentIndex + 1} / {total}
        </div>
        <p style={{ margin: 0, fontSize: "1rem", lineHeight: 1.5 }}>
          {currentPrompt.text}
        </p>
      </div>

      {/* Answering phase */}
      {phase === "answering" && (
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
              disabled={!answer.trim()}
              style={{
                ...primaryBtn,
                width: "auto",
                padding: "0.6rem 1.5rem",
                opacity: answer.trim() ? 1 : 0.4,
              }}
            >
              Submit Answer
            </button>
          </div>
        </div>
      )}

      {/* Scoring phase */}
      {phase === "scoring" && (
        <div>
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
      {phase === "error_log" && (
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
            onClick={() => doSubmit()}
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
    </div>
  );
}

// --- Styles ---

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
