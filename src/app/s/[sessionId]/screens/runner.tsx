"use client";

import { useState, useRef, useEffect } from "react";
import type { RunData, SessionData, FeedbackExcerpt, FeedbackResult, AttemptSubmitResult, McqResult, AnswerReveal } from "../session-runner";
import { pollFeedback, patchAttemptMeta, fetchReveal } from "../session-runner";

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
  onSubmit: (attempt: Record<string, unknown>) => Promise<AttemptSubmitResult | null>;
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
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
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
  const [socraticAnswer, setSocraticAnswer] = useState("");
  const [highlightedCitation, setHighlightedCitation] = useState<number | null>(null);
  const [mcqResult, setMcqResult] = useState<McqResult | null>(null);
  // Pre-answer confidence for MCQ (hypercorrection: Butterfield & Metcalfe).
  // Optional 1-tap: Guessing=1 / Unsure=3 / Sure=5. Never fabricated.
  const [mcqConfidence, setMcqConfidence] = useState<number | null>(null);
  // Model answer / key points revealed after committing an answer — the
  // standard the student self-scores against.
  const [reveal, setReveal] = useState<AnswerReveal | null>(null);
  const [revealLoading, setRevealLoading] = useState(false);
  const startTimeRef = useRef(Date.now());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const excerptRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Use current_prompt from run data (Phase 2: no full prompt array needed)
  const currentPrompt = run.current_prompt;
  const currentIndex = run.current_index;
  const total = run.prompt_count || run.prompts?.length || 0;

  // Identity of the prompt the current UI state belongs to. Used to reset
  // per-prompt state exactly once per prompt without racing the review phase
  // (the parent advances current_index at submit time, BEFORE the user has
  // seen the review panel).
  const promptKey = `${run.phase}:${currentIndex}`;
  const uiPromptKeyRef = useRef(promptKey);

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

  // Pretest items are diagnostic (Richland 2009): being wrong is expected
  // and useful — no error logging, separate metrics, gentler framing.
  const isPretest = currentPrompt?.meta?.pack === "PRE_TEST";
  // Repair prompts already carry their correction rule server-side.
  const isRepair =
    currentPrompt?.source_type === "VARIANT_REPAIR" ||
    currentPrompt?.source_type === "ERROR_LOG";
  const isMcq = currentPrompt?.format === "MCQ" && Array.isArray(currentPrompt.choices);

  // Deferred feedback — generation starts server-side the moment the attempt
  // lands; poll until it's ready (PENDING means another worker owns it).
  useEffect(() => {
    const shouldFetch =
      run.last_attempt_id &&
      !feedbackLoading &&
      feedbackExcerpts.length === 0 &&
      !fb.explanation &&
      !fb.reinforcement &&
      uiPhase === "review";

    if (!shouldFetch) return;

    let mounted = true;
    setFeedbackLoading(true);
    pollFeedback(run.last_attempt_id!, () => !mounted)
      .then((result: FeedbackResult | null) => {
        if (!mounted || !result) return;
        if (result.status === "OK") {
          if (result.excerpts.length > 0) setFeedbackExcerpts(result.excerpts);
          setFb(result);
        }
      })
      .catch(() => {
        // Feedback failure is non-fatal
      })
      .finally(() => { if (mounted) setFeedbackLoading(false); });
    return () => { mounted = false; };
  }, [run.last_attempt_id, uiPhase, feedbackLoading, feedbackExcerpts.length, fb.explanation, fb.reinforcement]);

  // Answer standard reveal: once the student commits an answer (scoring
  // phase), fetch the model answer + key points so self-scoring happens
  // against an explicit standard, not a feeling. Not for MCQ (server grades)
  // and never during the EXAM phase (delayed feedback is the point there).
  useEffect(() => {
    if (uiPhase !== "scoring" || isExamPhase || isMcq) return;
    if (reveal !== null || revealLoading) return;
    let mounted = true;
    setRevealLoading(true);
    fetchReveal(run.run_id, currentIndex)
      .then((r) => { if (mounted) setReveal(r); })
      .catch(() => { if (mounted) setReveal({ model_answer: null, key_points: null }); })
      .finally(() => { if (mounted) setRevealLoading(false); });
    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiPhase, isExamPhase, currentIndex, run.run_id]);

  const resetForPrompt = (key: string) => {
    uiPromptKeyRef.current = key;
    setUIPhase(isReviewPhase ? "scoring" : "answering");
    setAnswer("");
    setSelectedChoice(null);
    setScore(null);
    setCorrectionRule("");
    setVariantQuestion("");
    setErrorType("MISCONCEPTION");
    setFeedbackExcerpts([]);
    setFeedbackLoading(false);
    setLastScore(null);
    setMcqResult(null);
    setFb(emptyFeedback);
    setConfidence(3);
    setSelfExplanation("");
    setGeneratedExample("");
    setSocraticAnswer("");
    setMcqConfidence(null);
    setReveal(null);
    setRevealLoading(false);
    setHighlightedCitation(null);
    excerptRefs.current.clear();
    startTimeRef.current = Date.now();
    if (!isReviewPhase) {
      textareaRef.current?.focus();
    }
  };

  // Reset state when the prompt changes UNDERNEATH the UI (exam answering,
  // phase transitions, resume). While the review panel is up, the parent has
  // already advanced current_index — the reset is deferred to "Next Prompt"
  // (goNext), so the review content can never be wiped by this effect.
  useEffect(() => {
    if (promptKey === uiPromptKeyRef.current) return;
    if (uiPhase === "review") return;
    resetForPrompt(promptKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptKey, uiPhase]);

  // Draft preservation: a break can interrupt at submit time (the server
  // rejects the attempt and this screen unmounts) — keep the free-recall
  // draft in sessionStorage so it survives the break and reloads.
  const draftKey = `draft:${run.run_id}:${promptKey}`;
  useEffect(() => {
    if (isReviewPhase) return;
    try {
      const saved = sessionStorage.getItem(draftKey);
      if (saved) setAnswer((prev) => prev || saved);
    } catch { /* storage unavailable */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, isReviewPhase]);
  useEffect(() => {
    if (isReviewPhase) return;
    try {
      if (answer) sessionStorage.setItem(draftKey, answer);
      else sessionStorage.removeItem(draftKey);
    } catch { /* storage unavailable */ }
  }, [answer, draftKey, isReviewPhase]);

  const clearDraft = () => {
    try { sessionStorage.removeItem(draftKey); } catch { /* noop */ }
  };

  // Keyboard-first loop (deliberate practice = maximum feedback cycles per
  // hour): a stable document listener delegates to the latest handler via a
  // ref, so hooks stay above the early return.
  const keyHandlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const listener = (e: KeyboardEvent) => keyHandlerRef.current(e);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  if (!currentPrompt) {
    keyHandlerRef.current = () => {};
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
    try {
      await onSubmit({
        prompt_index: currentIndex,
        kind: "ANSWER",
        user_answer: answer,
        time_to_answer_seconds: elapsed,
        confidence_rating: confidence,
      });
      clearDraft();
    } catch {
      // Not recorded — the parent shows the error banner; stay on this prompt.
    } finally {
      setSubmitting(false);
    }
  };

  const handleMcqSelect = async (choiceIndex: number) => {
    if (submitting) return;
    setSelectedChoice(choiceIndex);
    setSubmitting(true);

    const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000);
    const choiceLabel = String.fromCharCode(65 + choiceIndex); // A, B, C, D
    const choiceText = currentPrompt?.choices?.[choiceIndex] ?? "";
    const userAnswer = `[${choiceLabel}] ${choiceText}`;

    try {
      if (isExamPhase) {
        // DELAYED scoring: record the choice only. Correctness is revealed
        // in the REVIEW phase, never mid-exam.
        await onSubmit({
          prompt_index: currentIndex,
          kind: "ANSWER",
          user_answer: userAnswer,
          time_to_answer_seconds: elapsed,
          mcq_choice_index: choiceIndex,
          // Only sent when the student actually rated it (never fabricated)
          ...(mcqConfidence != null ? { confidence_rating: mcqConfidence } : {}),
        });
        return;
      }

      // Immediate modes: the server grades the choice (the client never has
      // the answer key) and returns the outcome.
      const res = await onSubmit({
        prompt_index: currentIndex,
        user_answer: userAnswer,
        time_to_answer_seconds: elapsed,
        mcq_choice_index: choiceIndex,
        // Hypercorrection input — only sent when the student actually rated
        // their confidence (a fabricated default would corrupt calibration).
        ...(mcqConfidence != null ? { confidence_rating: mcqConfidence } : {}),
      });
      if (!res) return; // break intercepted the submit — nothing recorded

      setAnswer(userAnswer);
      const result = res.mcq_result ?? null;
      setMcqResult(result);
      setLastScore(result ? (result.is_correct ? "CORRECT" : "INCORRECT") : "CORRECT");
      setUIPhase("review");
    } catch {
      // Not recorded — stay on the choices so the user can retry.
      setSelectedChoice(null);
    } finally {
      setSubmitting(false);
    }
  };

  const handleScore = (s: string) => {
    if (submitting) return;
    setScore(s);
    // Pretest misses aren't errors (nothing studied yet) and repair prompts
    // already know their correction — neither collects an error log.
    if (s === "CORRECT" || isPretest || isRepair) {
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

    const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000);
    const attempt: Record<string, unknown> = {
      prompt_index: currentIndex,
      user_answer: answer,
      self_score: s,
      time_to_answer_seconds: elapsed,
      confidence_rating: confidence,
    };
    if (isPretest) attempt.is_pretest = true;
    if (isRepair) attempt.is_repair = true;

    if (selfExplanation.trim()) attempt.self_explanation = selfExplanation.trim();
    if (generatedExample.trim()) attempt.generated_example = generatedExample.trim();

    if (s !== "CORRECT" && !isPretest && !isRepair && correctionRule.trim()) {
      attempt.error_log = {
        error_type: errorType,
        correction_rule: correctionRule.trim(),
        variant_question: variantQuestion.trim() || undefined,
      };
    }

    try {
      const res = await onSubmit(attempt);
      if (!res) return; // break intercepted — nothing recorded
      clearDraft();
      setLastScore(s);
      // Show review phase for all scores (CORRECT gets reinforcement, others get explanation)
      setUIPhase("review");
    } catch {
      // Not recorded — stay in the current phase so nothing is lost.
    } finally {
      setSubmitting(false);
    }
  };

  const doReviewScore = async (finalScore?: string, autoErrorLog?: { error_type: string; correction_rule: string }) => {
    const s = finalScore || score;
    if (!s) return;
    setSubmitting(true);

    const attempt: Record<string, unknown> = {
      prompt_index: currentIndex,
      kind: "SCORE",
      self_score: s,
    };

    if (s !== "CORRECT") {
      if (autoErrorLog) {
        attempt.error_log = autoErrorLog;
      } else if (correctionRule.trim()) {
        attempt.error_log = {
          error_type: errorType,
          correction_rule: correctionRule.trim(),
          variant_question: variantQuestion.trim() || undefined,
        };
      }
    }

    try {
      const res = await onSubmit(attempt);
      if (!res) return; // break intercepted — nothing recorded
      setLastScore(s);
      // Show review phase for all scores
      setUIPhase("review");
    } catch {
      // Not recorded — stay in the current phase.
    } finally {
      setSubmitting(false);
    }
  };

  // EXAM_SIM REVIEW of an MCQ: the answer key is now available
  // (currentPrompt.correctIndex is only served in REVIEW), so derive the
  // score objectively from the recorded choice instead of blind self-scoring.
  const savedChoiceMatch = savedAnswer.match(/^\[([A-D])\]/);
  const savedChoiceIndex = savedChoiceMatch
    ? savedChoiceMatch[1].charCodeAt(0) - 65
    : null;
  const reviewMcqScorable =
    isReviewPhase &&
    isMcq &&
    currentPrompt?.correctIndex != null &&
    savedChoiceIndex != null;
  const reviewMcqCorrect =
    reviewMcqScorable && savedChoiceIndex === currentPrompt!.correctIndex;

  const confirmReviewMcqScore = () => {
    if (!reviewMcqScorable || submitting) return;
    const correctChoice = currentPrompt?.choices?.[currentPrompt.correctIndex!] ?? "";
    if (reviewMcqCorrect) {
      doReviewScore("CORRECT");
    } else {
      doReviewScore("INCORRECT", {
        error_type: "MISCONCEPTION",
        correction_rule: `The correct answer is "${correctChoice}".`,
      });
    }
  };

  const goNext = () => {
    // Persist review-panel metacognition against the attempt it belongs to.
    // Never POST a new attempt here — the run has already advanced, and a
    // fake attempt would silently answer the NEXT (unseen) prompt.
    if ((selfExplanation.trim() || generatedExample.trim() || socraticAnswer.trim()) && run.last_attempt_id) {
      patchAttemptMeta(run.last_attempt_id, {
        self_explanation: selfExplanation.trim() || undefined,
        generated_example: generatedExample.trim() || undefined,
        socratic_answer: socraticAnswer.trim() || undefined,
      }).catch(() => { /* non-fatal — reflection is best-effort */ });
    }
    resetForPrompt(promptKey);
  };

  // Latest-render keyboard handler (the stable listener delegates here).
  // Number/letter keys never fire while typing in an input.
  keyHandlerRef.current = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    const isTyping =
      tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT" || !!target?.isContentEditable;
    if (isTyping || e.metaKey || e.ctrlKey || e.altKey || submitting) return;

    if (uiPhase === "answering" && isMcq && currentPrompt.choices) {
      let idx = -1;
      if (/^[1-4]$/.test(e.key)) idx = parseInt(e.key, 10) - 1;
      else if (/^[a-dA-D]$/.test(e.key)) idx = e.key.toLowerCase().charCodeAt(0) - 97;
      if (idx >= 0 && idx < currentPrompt.choices.length) {
        e.preventDefault();
        handleMcqSelect(idx);
        return;
      }
      if (e.key === "g" || e.key === "G") { setMcqConfidence(1); return; }
      if (e.key === "u" || e.key === "U") { setMcqConfidence(3); return; }
      if (e.key === "s" || e.key === "S") { setMcqConfidence(5); return; }
      return;
    }

    if (uiPhase === "scoring") {
      if (reviewMcqScorable) {
        if (e.key === "Enter") { e.preventDefault(); confirmReviewMcqScore(); }
        return;
      }
      if (e.key === "1") { e.preventDefault(); handleScore("CORRECT"); return; }
      if (e.key === "2") { e.preventDefault(); handleScore("PARTIAL"); return; }
      if (e.key === "3") { e.preventDefault(); handleScore("INCORRECT"); return; }
      return;
    }

    if (uiPhase === "review" && e.key === "Enter") {
      e.preventDefault();
      goNext();
    }
  };

  return (
    <div>
      {/* Single quiet status line — everything the student doesn't need to
          think about lives here in low contrast (Sweller: extraneous UI load
          competes with learning). */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "0.5rem",
          fontSize: "0.72rem",
          color: "var(--color-text-muted)",
        }}
      >
        <span>
          {session.course_name} · {session.mode_label}
          {isExamPhase && <span style={{ color: "var(--color-review)" }}> · EXAM — feedback after all answers</span>}
          {isReviewPhase && <span style={{ color: "var(--color-info)" }}> · REVIEW — score your answers</span>}
        </span>
        <span>
          {run.metrics.correct_count}✓ {run.metrics.partial_count}~ {run.metrics.incorrect_count}✗
        </span>
      </div>

      {/* Progress bar */}
      <div
        style={{
          height: 3,
          background: "var(--color-border-subtle)",
          borderRadius: 2,
          marginBottom: "1.25rem",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${progressPct}%`,
            background: "var(--color-info)",
            transition: "width 0.3s ease",
          }}
        />
      </div>

      {/* Prompt — the question is the biggest thing on screen */}
      <div
        style={{
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius)",
          boxShadow: "var(--shadow-card)",
          padding: "1.25rem",
          marginBottom: "1.25rem",
        }}
      >
        <div
          style={{
            fontSize: "0.68rem",
            color: "var(--color-info)",
            marginBottom: "0.5rem",
            letterSpacing: "0.08em",
          }}
        >
          {progressLabel}
        </div>
        {isPretest && (
          <div style={{ fontSize: "0.75rem", color: "var(--color-warning)", marginBottom: "0.5rem" }}>
            DIAGNOSTIC — answer from what you already know. Being wrong here is
            expected and useful: it primes you to learn this next.
          </div>
        )}
        <p style={{ margin: 0, fontSize: "1.1rem", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
          {currentPrompt.text}
        </p>
      </div>

      {/* REVIEW: show saved answer read-only */}
      {isReviewPhase && savedAnswer && (
        <div
          style={{
            background: "var(--color-bg-card)",
            borderRadius: "var(--radius)",
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

      {/* MCQ answering phase */}
      {uiPhase === "answering" && !isReviewPhase && isMcq && currentPrompt.choices && (
        <div style={{ marginBottom: "1rem" }}>
          {/* Optional 1-tap pre-answer confidence (hypercorrection input).
              Never fabricated: nothing is sent unless the student rates it. */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.6rem" }}>
            <span style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>How sure are you?</span>
            {([["Guessing", 1, "G"], ["Unsure", 3, "U"], ["Sure", 5, "S"]] as const).map(([lbl, val, key]) => (
              <button
                key={val}
                onClick={() => setMcqConfidence(mcqConfidence === val ? null : val)}
                style={{
                  padding: "0.2rem 0.55rem",
                  fontSize: "0.72rem",
                  fontFamily: "inherit",
                  background: mcqConfidence === val ? "var(--color-bg-selected)" : "transparent",
                  color: mcqConfidence === val ? "var(--color-info)" : "var(--color-text-muted)",
                  border: `1px solid ${mcqConfidence === val ? "var(--color-info)" : "var(--color-border)"}`,
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                }}
              >
                {lbl} <span style={{ opacity: 0.6 }}>{key}</span>
              </button>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {currentPrompt.choices.map((choice: string, idx: number) => {
              const label = String.fromCharCode(65 + idx);
              const isSelected = selectedChoice === idx;
              return (
                <button
                  key={idx}
                  onClick={() => handleMcqSelect(idx)}
                  disabled={submitting}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "0.75rem",
                    padding: "0.85rem 1rem",
                    background: isSelected ? "var(--color-bg-selected)" : "var(--color-bg-card)",
                    border: `2px solid ${isSelected ? "var(--color-primary)" : "var(--color-border)"}`,
                    borderRadius: "var(--radius-lg)",
                    color: "var(--color-text)",
                    fontSize: "0.9rem",
                    lineHeight: 1.5,
                    cursor: submitting ? "wait" : "pointer",
                    textAlign: "left",
                    fontFamily: "inherit",
                    opacity: submitting ? 0.6 : 1,
                    transition: "border-color 0.15s, background 0.15s",
                  }}
                >
                  <span style={{
                    fontWeight: 700,
                    color: "var(--color-info)",
                    minWidth: "1.5rem",
                    fontSize: "0.95rem",
                  }}>{label}.</span>
                  <span style={{ flex: 1 }}>{choice}</span>
                  <span style={{ fontSize: "0.7rem", color: "var(--color-text-dim)", alignSelf: "center" }}>{idx + 1}</span>
                </button>
              );
            })}
          </div>
          <p style={{ margin: "0.5rem 0 0", fontSize: "0.68rem", color: "var(--color-text-dim)" }}>
            Keys 1–4 or A–D to answer
          </p>
        </div>
      )}

      {/* Free-recall answering phase */}
      {uiPhase === "answering" && !isReviewPhase && !isMcq && (
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
                background: "var(--color-bg-card)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius)",
                padding: "0.75rem 1rem",
                marginBottom: "0.75rem",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
                <span style={{ fontSize: "0.8rem", color: "var(--color-text-secondary)" }}>How confident are you?</span>
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
                      background: confidence === level ? confidenceTints[level - 1] : "var(--color-bg-card)",
                      color: confidence === level ? confidenceColors[level - 1] : "var(--color-text-faint)",
                      border: `1px solid ${confidence === level ? confidenceColors[level - 1] : "var(--color-border)"}`,
                      borderRadius: "var(--radius-sm)",
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
            <span style={{ fontSize: "0.7rem", color: "var(--color-text-faint)" }}>Ctrl+Enter to submit</span>
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
                background: "var(--color-bg-card)",
                borderRadius: "var(--radius)",
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

          {/* Answer standard: self-scoring against an explicit model answer,
              not a feeling (calibration). Stacked directly under the user's
              answer — spatial contiguity. */}
          {!isMcq && !isExamPhase && revealLoading && (
            <p style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", fontStyle: "italic", marginBottom: "0.75rem" }}>
              Loading model answer...
            </p>
          )}
          {!isMcq && reveal?.model_answer && (
            <div
              style={{
                background: "var(--color-bg-info-tint)",
                border: "1px solid var(--color-info)",
                borderRadius: "var(--radius)",
                padding: "1rem",
                marginBottom: "1rem",
              }}
              data-testid="model-answer"
            >
              <p style={{ margin: "0 0 0.5rem", fontSize: "0.72rem", fontWeight: 600, color: "var(--color-info)", letterSpacing: "0.05em" }}>
                MODEL ANSWER — compare before you score
              </p>
              <p style={{ margin: 0, fontSize: "0.9rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                {reveal.model_answer}
              </p>
              {reveal.key_points && reveal.key_points.length > 0 && (
                <ul style={{ margin: "0.6rem 0 0", paddingLeft: "1.1rem", fontSize: "0.82rem", lineHeight: 1.6, color: "var(--color-text-secondary)" }}>
                  {reveal.key_points.map((kp, i) => (
                    <li key={i}>{kp}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {reviewMcqScorable ? (
            <div>
              {/* Objective MCQ review: show the key, derive the score */}
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1rem" }}>
                {currentPrompt.choices!.map((choice: string, idx: number) => {
                  const label = String.fromCharCode(65 + idx);
                  const isCorrectChoice = idx === currentPrompt.correctIndex;
                  const isPicked = idx === savedChoiceIndex;
                  return (
                    <div
                      key={idx}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "0.75rem",
                        padding: "0.85rem 1rem",
                        background: isCorrectChoice ? "var(--color-bg-done)" : isPicked ? "var(--color-bg-error-tint)" : "var(--color-bg-card)",
                        border: `2px solid ${isCorrectChoice ? "var(--color-success)" : isPicked ? "var(--color-error)" : "var(--color-border)"}`,
                        borderRadius: "var(--radius-lg)",
                        color: "var(--color-text)",
                        fontSize: "0.9rem",
                        lineHeight: 1.5,
                      }}
                    >
                      <span style={{ fontWeight: 700, color: isCorrectChoice ? "var(--color-success)" : "var(--color-info)", minWidth: "1.5rem", fontSize: "0.95rem" }}>{label}.</span>
                      <span style={{ flex: 1 }}>{choice}</span>
                      {isCorrectChoice && <span style={{ color: "var(--color-success)", fontWeight: 700 }}>✓</span>}
                      {isPicked && !isCorrectChoice && <span style={{ color: "var(--color-error)", fontWeight: 700 }}>your pick</span>}
                    </div>
                  );
                })}
              </div>
              <p style={{ fontSize: "0.85rem", color: reviewMcqCorrect ? "var(--color-success)" : "var(--color-error)", marginBottom: "0.75rem", fontWeight: 600 }}>
                {reviewMcqCorrect ? "✓ You picked the correct answer." : "✗ You picked a different answer."}
              </p>
              <button
                onClick={confirmReviewMcqScore}
                disabled={submitting}
                style={{ ...primaryBtn, opacity: submitting ? 0.4 : 1 }}
              >
                {submitting ? "Saving..." : "Confirm & Continue"}
              </button>
            </div>
          ) : (
            <div>
              <p style={{ fontSize: "0.85rem", color: "var(--color-text-secondary)", marginBottom: "0.75rem" }}>
                {isPretest
                  ? "How close were you? (Diagnostic only — this doesn't count against you.)"
                  : reveal?.model_answer
                    ? "Score yourself against the model answer."
                    : "How did you do? Be honest."}
              </p>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button onClick={() => handleScore("CORRECT")} disabled={submitting} style={scoreBtn("var(--color-success)", submitting)}>
                  ✓ Correct <span style={{ opacity: 0.5, fontWeight: 400 }}>1</span>
                </button>
                <button onClick={() => handleScore("PARTIAL")} disabled={submitting} style={scoreBtn("var(--color-warning)", submitting)}>
                  ~ Partial <span style={{ opacity: 0.5, fontWeight: 400 }}>2</span>
                </button>
                <button onClick={() => handleScore("INCORRECT")} disabled={submitting} style={scoreBtn("var(--color-error)", submitting)}>
                  ✗ Incorrect <span style={{ opacity: 0.5, fontWeight: 400 }}>3</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error logging phase */}
      {uiPhase === "error_log" && (
        <div>
          <div
            style={{
              background: score === "INCORRECT" ? "var(--color-bg-error-tint)" : "var(--color-bg-warning-tint)",
              border: `1px solid ${score === "INCORRECT" ? "var(--color-error)" : "var(--color-warning)"}`,
              borderRadius: "var(--radius)",
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
              Correction rule <span style={{ color: "var(--color-error)" }}>*</span>
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
          {/* Hypercorrection callout (Butterfield & Metcalfe 2001): a
              high-confidence miss is the single most correctable moment —
              direct full attention to the correction. */}
          {lastScore === "INCORRECT" && (mcqResult ? (mcqConfidence ?? 0) >= 4 : confidence >= 4) && (
            <div
              style={{
                background: "var(--color-bg-review-tint)",
                border: "1px solid var(--color-review)",
                borderRadius: "var(--radius)",
                padding: "0.75rem 1rem",
                marginBottom: "1rem",
              }}
              data-testid="hypercorrection-badge"
            >
              <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--color-review)", fontWeight: 600 }}>
                High-confidence miss
              </p>
              <p style={{ margin: "0.3rem 0 0", fontSize: "0.8rem", lineHeight: 1.5, color: "var(--color-text-secondary)" }}>
                You were sure about this one. Read the correction closely —
                confidently-held errors, once corrected, are the ones that stick best.
                This will come back for review.
              </p>
            </div>
          )}

          {/* Pretest framing: a wrong diagnostic answer is priming, not failure */}
          {isPretest && (
            <div
              style={{
                background: "var(--color-bg-warning-tint)",
                border: "1px solid var(--color-warning)",
                borderRadius: "var(--radius)",
                padding: "0.75rem 1rem",
                marginBottom: "1rem",
              }}
            >
              <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--color-warning)", fontWeight: 600 }}>
                Diagnostic complete
              </p>
              <p style={{ margin: "0.3rem 0 0", fontSize: "0.8rem", lineHeight: 1.5, color: "var(--color-text)" }}>
                You haven&apos;t studied this yet — attempting it first primes your
                brain to encode the real material better. It&apos;s coming up in this course.
              </p>
            </div>
          )}

          {/* Server-graded MCQ outcome: correct answer + why the pick was tempting */}
          {mcqResult && (
            <div
              style={{
                background: mcqResult.is_correct ? "var(--color-bg-done)" : "var(--color-bg-error-tint)",
                border: `1px solid ${mcqResult.is_correct ? "var(--color-success)" : "var(--color-error)"}`,
                borderRadius: "var(--radius)",
                padding: "1rem",
                marginBottom: "1rem",
              }}
              data-testid="mcq-result"
            >
              <p style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", fontWeight: 600, color: mcqResult.is_correct ? "var(--color-success)" : "var(--color-error)" }}>
                {mcqResult.is_correct
                  ? `✓ Correct — ${String.fromCharCode(65 + mcqResult.correct_index)}`
                  : `✗ Incorrect — the answer is ${String.fromCharCode(65 + mcqResult.correct_index)}`}
              </p>
              <p style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.5 }}>
                <strong>{mcqResult.correct_choice}</strong>
              </p>
              {!mcqResult.is_correct && mcqResult.rationale && (
                <p style={{ margin: "0.5rem 0 0", fontSize: "0.8rem", lineHeight: 1.5, color: "var(--color-text-secondary)" }}>
                  Why your pick was tempting: {mcqResult.rationale}
                </p>
              )}
            </div>
          )}

          {/* AI Reinforcement for CORRECT answers */}
          {lastScore === "CORRECT" && (fb.reinforcement || fb.deeper_insight || fb.concept_connection || fb.socratic_followup) && (
            <div
              style={{
                background: "var(--color-bg-card)",
                border: "1px solid var(--color-success)",
                borderRadius: "var(--radius)",
                padding: "1rem",
                marginBottom: "1rem",
              }}
            >
              <p style={{ margin: "0 0 0.75rem", fontSize: "0.85rem", fontWeight: 600, color: "var(--color-success)" }}>
                Nice work!
              </p>
              {fb.reinforcement && (
                <p style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", lineHeight: 1.6 }}>
                  {fb.reinforcement}
                </p>
              )}
              {fb.deeper_insight && (
                <div style={insightBox}>
                  <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: "var(--color-info)", marginBottom: "0.3rem" }}>
                    Deeper Insight
                  </p>
                  <p style={{ margin: 0, fontSize: "0.8rem", lineHeight: 1.5 }}>
                    {fb.deeper_insight}
                  </p>
                </div>
              )}
              {fb.concept_connection && (
                <div style={{ ...insightBox, borderColor: "var(--color-review)" }}>
                  <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: "var(--color-review)", marginBottom: "0.3rem" }}>
                    Connection
                  </p>
                  <p style={{ margin: 0, fontSize: "0.8rem", lineHeight: 1.5 }}>
                    {fb.concept_connection}
                  </p>
                </div>
              )}
              {fb.socratic_followup && (
                <div style={{ ...insightBox, borderColor: "var(--color-primary)" }}>
                  <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: "var(--color-primary)", marginBottom: "0.3rem" }}>
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
                background: "var(--color-bg-card)",
                border: "1px solid var(--color-success)",
                borderRadius: "var(--radius)",
                padding: "1rem",
                marginBottom: "1rem",
              }}
            >
              <p style={{ margin: 0, fontSize: "0.85rem", fontWeight: 600, color: "var(--color-success)" }}>
                {feedbackLoading ? "Generating insight..." : "Correct!"}
              </p>
            </div>
          )}

          {/* AI Explanation for PARTIAL/INCORRECT answers */}
          {lastScore && lastScore !== "CORRECT" && (
            <div
              style={{
                background: "var(--color-bg-card)",
                border: "1px solid var(--color-success)",
                borderRadius: "var(--radius)",
                padding: "1rem",
                marginBottom: "1rem",
              }}
            >
              <p style={{ margin: "0 0 0.75rem", fontSize: "0.85rem", fontWeight: 600, color: "var(--color-success)" }}>
                REVIEW (from your materials)
              </p>

              {/* AI-powered explanation with inline citations */}
              {fb.explanation && (
                <div
                  style={{
                    background: "var(--color-bg-card)",
                    border: "1px solid var(--color-info)",
                    borderRadius: "var(--radius-sm)",
                    padding: "0.75rem",
                    marginBottom: "0.75rem",
                  }}
                >
                  <p style={{ margin: "0 0 0.5rem", fontSize: "0.75rem", fontWeight: 600, color: "var(--color-info)" }}>
                    Professor&apos;s Explanation
                  </p>
                  <div style={{ margin: 0, fontSize: "0.85rem", lineHeight: 1.6 }}>
                    {renderExplanationWithCitations(fb.explanation, feedbackExcerpts, (idx) => {
                      setHighlightedCitation(idx === highlightedCitation ? null : idx);
                      const el = excerptRefs.current.get(idx);
                      if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
                    })}
                  </div>
                  {fb.key_takeaway && (
                    <div
                      style={{
                        background: "var(--color-bg-input)",
                        borderRadius: "var(--radius-sm)",
                        padding: "0.5rem 0.75rem",
                        marginTop: "0.5rem",
                      }}
                    >
                      <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: "var(--color-primary)" }}>
                        Key Takeaway: {fb.key_takeaway}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {feedbackLoading && !fb.explanation && (
                <p style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", fontStyle: "italic" }} data-testid="feedback-loading">
                  Loading feedback...
                </p>
              )}

              {/* Numbered excerpt cards from course materials */}
              {feedbackExcerpts.map((excerpt, i) => {
                const isHighlighted = highlightedCitation === i;
                return (
                  <div
                    key={excerpt.chunk_id}
                    ref={(el) => { if (el) excerptRefs.current.set(i, el); else excerptRefs.current.delete(i); }}
                    style={{
                      background: isHighlighted ? "var(--color-bg-selected)" : "var(--color-bg-card)",
                      border: isHighlighted ? "1px solid var(--color-info)" : "1px solid var(--color-border)",
                      borderRadius: "var(--radius-sm)",
                      padding: "0.75rem",
                      marginBottom: i < feedbackExcerpts.length - 1 ? "0.5rem" : 0,
                      transition: "border-color 0.2s, background 0.2s",
                      cursor: "pointer",
                    }}
                    onClick={() => setHighlightedCitation(isHighlighted ? null : i)}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.7rem", color: "var(--color-text-muted)", marginBottom: "0.4rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        <span style={citationNumberBadge}>{i + 1}</span>
                        <span data-testid="excerpt-doc-title">{excerpt.doc_title}</span>
                      </div>
                      {excerpt.page_number && <span>p. {excerpt.page_number}</span>}
                    </div>
                    <p
                      style={{ margin: 0, fontSize: "0.8rem", lineHeight: 1.5 }}
                      dangerouslySetInnerHTML={{
                        __html: escapeHtml(excerpt.snippet)
                          .replace(/&lt;&lt;(.*?)&gt;&gt;/g, '<mark style="background:rgba(110,168,254,0.22);color:var(--color-primary)">$1</mark>'),
                      }}
                    />
                  </div>
                );
              })}

              {!feedbackLoading && feedbackExcerpts.length === 0 && !fb.explanation && (
                <p style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", fontStyle: "italic" }}>
                  No relevant excerpts found in your materials.
                </p>
              )}

              {/* Concept connection */}
              {fb.concept_connection && (
                <div style={{ ...insightBox, borderColor: "var(--color-review)", marginTop: "0.75rem" }}>
                  <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: "var(--color-review)", marginBottom: "0.3rem" }}>
                    Connection
                  </p>
                  <p style={{ margin: 0, fontSize: "0.8rem", lineHeight: 1.5 }}>
                    {fb.concept_connection}
                  </p>
                </div>
              )}

              {/* Mnemonic / memory aid */}
              {fb.mnemonic && (
                <div style={{ ...insightBox, borderColor: "var(--color-success)", marginTop: "0.5rem" }}>
                  <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: "var(--color-success)", marginBottom: "0.3rem" }}>
                    Memory Aid
                  </p>
                  <p style={{ margin: 0, fontSize: "0.8rem", lineHeight: 1.5 }}>
                    {fb.mnemonic}
                  </p>
                </div>
              )}

              {/* Mistake pattern advice */}
              {fb.pattern_advice && (
                <div style={{ ...insightBox, borderColor: "var(--color-warning)", marginTop: "0.5rem" }}>
                  <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: "var(--color-warning)", marginBottom: "0.3rem" }}>
                    Pattern Noticed
                  </p>
                  <p style={{ margin: 0, fontSize: "0.8rem", lineHeight: 1.5 }}>
                    {fb.pattern_advice}
                  </p>
                </div>
              )}

              {/* Socratic follow-up */}
              {fb.socratic_followup && (
                <div style={{ ...insightBox, borderColor: "var(--color-primary)", marginTop: "0.5rem" }}>
                  <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: "var(--color-primary)", marginBottom: "0.3rem" }}>
                    Think Deeper
                  </p>
                  <p style={{ margin: "0 0 0.5rem", fontSize: "0.85rem", lineHeight: 1.5, fontStyle: "italic" }}>
                    {fb.socratic_followup}
                  </p>
                  {/* Close the loop: an unanswered Socratic question is decoration.
                      Saved with the attempt on Next Prompt. */}
                  <input
                    type="text"
                    value={socraticAnswer}
                    onChange={(e) => setSocraticAnswer(e.target.value)}
                    placeholder="Your one-line answer (optional)..."
                    style={{
                      width: "100%",
                      padding: "0.5rem 0.6rem",
                      fontSize: "0.82rem",
                      fontFamily: "inherit",
                      background: "var(--color-bg-input)",
                      color: "var(--color-text)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius-sm)",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              )}

              {/* Repair prompt for PARTIAL/INCORRECT */}
              {(correctionRule || variantQuestion) && (
                <div
                  style={{
                    background: "var(--color-bg-error-tint)",
                    border: "1px solid var(--color-error)",
                    borderRadius: "var(--radius-sm)",
                    padding: "0.75rem",
                    marginTop: "0.75rem",
                  }}
                >
                  <p style={{ margin: "0 0 0.5rem", fontSize: "0.75rem", fontWeight: 600, color: "var(--color-error)" }}>
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
                  <p style={{ margin: "0.5rem 0 0", fontSize: "0.7rem", color: "var(--color-text-muted)", fontStyle: "italic" }}>
                    Say the correct answer aloud once before moving on.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Self-explanation prompt (all scores) — available WHILE feedback
              generates: writing the reflection converts wait time into
              germane processing instead of dead time. */}
          {lastScore && (
            <div
              style={{
                background: "var(--color-bg-card)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius)",
                padding: "0.75rem 1rem",
                marginBottom: "0.75rem",
              }}
            >
              <p style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", fontWeight: 600, color: "var(--color-text)" }}>
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
          {lastScore === "CORRECT" && (
            <div
              style={{
                background: "var(--color-bg-card)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius)",
                padding: "0.75rem 1rem",
                marginBottom: "0.75rem",
              }}
            >
              <p style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", fontWeight: 600, color: "var(--color-text)" }}>
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

          <button onClick={goNext} style={primaryBtn}>
            Next Prompt <span style={{ opacity: 0.55, fontWeight: 400 }}>↵</span>
          </button>
        </div>
      )}
    </div>
  );
}

// --- Helpers ---

/** Escape HTML entities to prevent XSS when using dangerouslySetInnerHTML */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// --- Constants ---

const confidenceLabels = ["Guessing", "Unsure", "Somewhat", "Confident", "Very Sure"];
const confidenceColors = ["var(--color-error)", "var(--color-warning)", "var(--color-primary)", "var(--color-success)", "var(--color-success)"];
// Tinted backgrounds paired with confidenceColors (replaces old hex+alpha concat)
const confidenceTints = ["var(--color-bg-error-tint)", "var(--color-bg-warning-tint)", "var(--color-bg-selected)", "var(--color-bg-success-tint)", "var(--color-bg-success-tint)"];

// --- Styles ---

const insightBox: React.CSSProperties = {
  background: "var(--color-bg-card)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  padding: "0.75rem",
  marginTop: "0.5rem",
};

const primaryBtn: React.CSSProperties = {
  width: "100%",
  padding: "0.75rem",
  fontSize: "0.9rem",
  fontFamily: "inherit",
  fontWeight: 600,
  // Primary actions use the accent everywhere (preflight/end-screen parity)
  background: "var(--color-primary)",
  color: "var(--color-bg-darkest)",
  border: "none",
  borderRadius: "var(--radius)",
  cursor: "pointer",
};

const scoreBtn = (color: string, disabled = false): React.CSSProperties => ({
  flex: 1,
  padding: "0.75rem",
  fontSize: "0.85rem",
  fontFamily: "inherit",
  fontWeight: 600,
  background: "transparent",
  color,
  border: `2px solid ${color}`,
  borderRadius: "var(--radius)",
  cursor: disabled ? "wait" : "pointer",
  opacity: disabled ? 0.5 : 1,
});

const textareaStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.75rem",
  fontSize: "0.85rem",
  fontFamily: "inherit",
  background: "var(--color-bg-card)",
  color: "var(--color-text)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius)",
  resize: "vertical",
  marginBottom: "0.5rem",
  boxSizing: "border-box",
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem",
  fontSize: "0.85rem",
  fontFamily: "inherit",
  background: "var(--color-bg-card)",
  color: "var(--color-text)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius)",
  marginBottom: "0.75rem",
};

const citationNumberBadge: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 18,
  height: 18,
  borderRadius: "50%",
  background: "var(--color-info)",
  color: "var(--color-bg-darkest)",
  fontSize: "0.65rem",
  fontWeight: 700,
  flexShrink: 0,
};

const inlineCitationStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 16,
  height: 16,
  borderRadius: "50%",
  background: "var(--color-info)",
  color: "var(--color-bg-darkest)",
  fontSize: "0.6rem",
  fontWeight: 700,
  marginLeft: 2,
  marginRight: 2,
  verticalAlign: "super",
  cursor: "pointer",
};

/**
 * Parse explanation text and insert numbered citation badges.
 * Matches patterns like [1], [2], etc. and creates clickable badges.
 * Also matches references to excerpt numbers in natural language patterns.
 */
function renderExplanationWithCitations(
  text: string,
  excerpts: FeedbackExcerpt[],
  onCitationClick: (index: number) => void,
): React.ReactNode {
  if (!text || excerpts.length === 0) return text || "";

  // Split on [N] patterns
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((part, i) => {
    const match = part.match(/^\[(\d+)\]$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num >= 1 && num <= excerpts.length) {
        return (
          <span
            key={i}
            role="button"
            tabIndex={0}
            style={inlineCitationStyle}
            title={`Source: ${excerpts[num - 1].doc_title}${excerpts[num - 1].page_number ? ` p.${excerpts[num - 1].page_number}` : ""}`}
            onClick={() => onCitationClick(num - 1)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onCitationClick(num - 1); } }}
          >
            {num}
          </span>
        );
      }
    }
    return part;
  });
}

const fieldLabel: React.CSSProperties = {
  display: "block",
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  marginBottom: "0.25rem",
};
