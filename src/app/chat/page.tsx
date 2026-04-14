"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { getActiveCourse, setActiveCourse } from "@/lib/client-utils";
import { apiGet, apiPost, apiDelete, type CourseOption } from "@/lib/client-api";
import { titleStyle, subtitleStyle, selectStyle } from "@/lib/shared-styles";

// --- Types ---

interface Citation {
  chunk_id: string;
  reason: string;
  quote_snippet: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  meta?: { chunks_retrieved?: number; latency_ms?: number };
}

const CHAT_PAGE_SIZE = 50;

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [selectedCourse, setSelectedCourseRaw] = useState<string>(() => getActiveCourse());
  const setSelectedCourse = (v: string) => { setSelectedCourseRaw(v); setActiveCourse(v); };
  const [expandedCitation, setExpandedCitation] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load chat history from database when course changes
  useEffect(() => {
    if (!selectedCourse) return;
    let mounted = true;
    const params = new URLSearchParams({ courseKey: selectedCourse, limit: String(CHAT_PAGE_SIZE) });
    apiGet(`/api/chat/messages?${params.toString()}`)
      .then((data) => {
        if (!mounted) return;
        if (data.messages) {
          const msgs = data.messages.map((m: { id: string; role: string; content: string; citations?: Citation[] }) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
            citations: m.citations as Citation[] | undefined,
          }));
          setMessages(msgs);
          setHasMore(msgs.length >= CHAT_PAGE_SIZE);
        }
      })
      .catch(() => {
        if (mounted) setMessages([]);
      });
    return () => { mounted = false; };
  }, [selectedCourse]);

  const loadOlderMessages = useCallback(async () => {
    if (!selectedCourse || loadingMore || messages.length === 0) return;
    setLoadingMore(true);
    const oldest = messages[0];
    const params = new URLSearchParams({
      courseKey: selectedCourse,
      limit: String(CHAT_PAGE_SIZE),
      before: oldest.id,
    });
    try {
      const data = await apiGet(`/api/chat/messages?${params.toString()}`);
      if (data.messages && data.messages.length > 0) {
        const older = data.messages.map((m: { id: string; role: string; content: string; citations?: Citation[] }) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          citations: m.citations as Citation[] | undefined,
        }));
        setMessages((prev) => [...older, ...prev]);
        setHasMore(older.length >= CHAT_PAGE_SIZE);
      } else {
        setHasMore(false);
      }
    } catch {
      // Keep existing messages
    } finally {
      setLoadingMore(false);
    }
  }, [selectedCourse, loadingMore, messages]);

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
        } else if (!selectedCourse && options.length > 0) {
          setSelectedCourse(
            options[0].exam_name
              ? `${options[0].course_name}||${options[0].exam_name}`
              : options[0].course_name
          );
        }
      }
    }).catch(() => {});
    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(async () => {
    const question = input.trim();
    if (!question || !selectedCourse || loading) return;

    const [courseName, examName] = selectedCourse.split("||");

    // Optimistically add user message to UI
    const tempUserMsg: Message = {
      id: `temp-u-${Date.now()}`,
      role: "user",
      content: question,
    };

    setMessages((prev) => [...prev, tempUserMsg]);
    setInput("");
    setLoading(true);

    // Persist user message to database
    try {
      const { message: savedUserMsg } = await apiPost("/api/chat/messages", {
        courseKey: selectedCourse,
        role: "user",
        content: question,
      });
      // Replace temp message with server-assigned id
      setMessages((prev) =>
        prev.map((m) => (m.id === tempUserMsg.id ? { ...m, id: savedUserMsg.id } : m)),
      );
    } catch {
      // Keep the temp message in UI even if persistence fails
    }

    try {
      const response = await apiPost("/api/assistant/answer", {
        question,
        course_name: courseName,
        exam_name: examName || undefined,
        verbosity: "MEDIUM",
        top_k: 5,
      });

      const assistantContent = response.answer_markdown || "No response received.";
      const assistantCitations = response.citations || [];

      // Persist assistant message to database
      let assistantId = `temp-a-${Date.now()}`;
      try {
        const { message: savedAssistantMsg } = await apiPost("/api/chat/messages", {
          courseKey: selectedCourse,
          role: "assistant",
          content: assistantContent,
          citations: assistantCitations.length > 0 ? assistantCitations : undefined,
        });
        assistantId = savedAssistantMsg.id;
      } catch {
        // Keep temp id if persistence fails
      }

      const assistantMsg: Message = {
        id: assistantId,
        role: "assistant",
        content: assistantContent,
        citations: assistantCitations,
        meta: response.meta,
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: "assistant",
          content: err instanceof Error ? err.message : "Something went wrong. Please try again.",
          meta: { failed: true } as any,
        },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, selectedCourse, loading]);

  const clearChat = useCallback(async () => {
    if (!selectedCourse) return;
    if (!window.confirm("Clear all messages in this chat? This cannot be undone.")) return;
    setMessages([]);
    try {
      await apiDelete(`/api/chat/messages?courseKey=${encodeURIComponent(selectedCourse)}`);
    } catch {
      // UI already cleared
    }
  }, [selectedCourse]);

  const parsedCourse = selectedCourse.split("||");

  return (
    <div id="main-content" style={pageContainer}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <h1 style={titleStyle}>Source Chat</h1>
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              style={clearButton}
              type="button"
            >
              Clear chat
            </button>
          )}
        </div>
        <p style={{ ...subtitleStyle, margin: "0 0 0.75rem" }}>Ask questions about your course materials</p>

        {/* Course selector */}
        {courses.length > 0 ? (
          <select
            aria-label="Select course"
            value={selectedCourse}
            onChange={(e) => setSelectedCourse(e.target.value)}
            style={selectStyle}
          >
            {courses.map((c) => {
              const val = c.exam_name
                ? `${c.course_name}||${c.exam_name}`
                : c.course_name;
              const label = c.exam_name
                ? `${c.course_name} — ${c.exam_name} (${c.doc_count} doc${c.doc_count > 1 ? "s" : ""})`
                : `${c.course_name} (${c.doc_count} doc${c.doc_count > 1 ? "s" : ""})`;
              return (
                <option key={val} value={val}>
                  {label}
                </option>
              );
            })}
          </select>
        ) : (
          <p style={{ color: "var(--color-warning)", fontSize: "0.85rem", margin: 0 }}>
            No course documents uploaded yet.{" "}
            <Link href="/flashcards" style={{ color: "var(--color-primary)", textDecoration: "underline" }}>
              Upload materials on the Flashcards page
            </Link>{" "}
            to start chatting with your content.
          </p>
        )}
      </div>

      {/* Messages */}
      <div style={messagesContainer} role="log" aria-live="polite">
        {hasMore && (
          <div style={{ textAlign: "center", paddingBottom: "0.75rem" }}>
            <button
              type="button"
              onClick={loadOlderMessages}
              disabled={loadingMore}
              style={{
                fontSize: "0.75rem",
                fontFamily: "inherit",
                background: "var(--color-bg-card)",
                color: "var(--color-text-muted)",
                border: "1px solid var(--color-border-subtle)",
                borderRadius: 4,
                padding: "0.35rem 0.75rem",
                cursor: loadingMore ? "wait" : "pointer",
                opacity: loadingMore ? 0.6 : 1,
              }}
            >
              {loadingMore ? "Loading..." : "Load older messages"}
            </button>
          </div>
        )}
        {messages.length === 0 && (
          <div style={emptyState}>
            <p style={{ fontSize: "1.2rem", color: "var(--color-text-muted)", marginBottom: "0.5rem" }}>
              Ask anything about your {parsedCourse[0] || "course"} materials
            </p>
            <p style={{ fontSize: "0.85rem", color: "var(--color-text-dim)" }}>
              Your answers will be grounded in your uploaded documents with inline citations.
            </p>
            <p style={{ fontSize: "0.75rem", color: "var(--color-text-dim)", marginTop: "0.25rem" }}>
              Press <kbd style={kbdStyle}>Enter</kbd> to send, <kbd style={kbdStyle}>Shift+Enter</kbd> for new line
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} style={{ marginBottom: "1rem" }} role="article">
            {/* Message bubble */}
            <div
              style={
                msg.role === "user" ? userBubble : assistantBubble
              }
            >
              <div
                style={{
                  fontSize: "0.7rem",
                  color: msg.role === "user" ? "var(--color-primary)" : "var(--color-info)",
                  marginBottom: "0.3rem",
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                }}
              >
                {msg.role === "user" ? "YOU" : "STUDY BOT"}
              </div>
              <div style={{ fontSize: "0.9rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                {renderAnswerWithCitations(msg.content, msg.citations)}
              </div>
            </div>

            {/* Citations */}
            {msg.citations && msg.citations.length > 0 && (
              <div style={{ marginLeft: "0.5rem", marginTop: "0.4rem" }}>
                <div
                  style={{
                    fontSize: "0.7rem",
                    color: "var(--color-text-dim)",
                    marginBottom: "0.3rem",
                    letterSpacing: "0.05em",
                  }}
                >
                  SOURCES ({msg.citations.length})
                </div>
                {msg.citations.map((c, i) => (
                  <div key={c.chunk_id} style={{ marginBottom: "0.3rem" }}>
                    <button
                      type="button"
                      aria-expanded={expandedCitation === `${msg.id}-${i}`}
                      onClick={() =>
                        setExpandedCitation(
                          expandedCitation === `${msg.id}-${i}`
                            ? null
                            : `${msg.id}-${i}`
                        )
                      }
                      style={citationButton}
                    >
                      <span style={citationBadge}>{i + 1}</span>
                      <span style={{ flex: 1, textAlign: "left" }}>{c.reason}</span>
                      <span style={{ color: "var(--color-text-dim)", fontSize: "0.75rem" }}>
                        {expandedCitation === `${msg.id}-${i}` ? "▼" : "▶"}
                      </span>
                    </button>
                    {expandedCitation === `${msg.id}-${i}` && (
                      <div style={citationExpanded}>
                        <p style={{ margin: 0, fontSize: "0.8rem", lineHeight: 1.5, fontStyle: "italic" }}>
                          &ldquo;{c.quote_snippet}&rdquo;
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Meta info */}
            {msg.meta && !(msg.meta as any).failed && (
              <div style={{ fontSize: "0.65rem", color: "var(--color-text-dim)", marginTop: "0.25rem", marginLeft: "0.5rem" }}>
                {msg.meta.chunks_retrieved ?? 0} sources searched
                {msg.meta.latency_ms ? ` · ${(msg.meta.latency_ms / 1000).toFixed(1)}s` : ""}
              </div>
            )}

            {/* Retry button for failed messages */}
            {msg.role === "assistant" && (msg.meta as any)?.failed && (
              <button
                type="button"
                onClick={() => {
                  // Remove the error message and the user message before it, then resend
                  const idx = messages.findIndex((m) => m.id === msg.id);
                  const userMsg = idx > 0 ? messages[idx - 1] : null;
                  if (userMsg && userMsg.role === "user") {
                    setMessages((prev) => prev.filter((m) => m.id !== msg.id));
                    setInput(userMsg.content);
                  }
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.3rem",
                  marginTop: "0.4rem",
                  marginLeft: "0.5rem",
                  padding: "0.25rem 0.6rem",
                  fontSize: "0.75rem",
                  fontFamily: "inherit",
                  background: "var(--color-bg)",
                  color: "var(--color-warning)",
                  border: "1px solid var(--color-border-subtle)",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                Retry
              </button>
            )}
          </div>
        ))}

        {loading && (
          <div style={assistantBubble}>
            <div style={{ fontSize: "0.7rem", color: "var(--color-info)", marginBottom: "0.3rem", fontWeight: 600 }}>
              STUDY BOT
            </div>
            <div style={{ color: "var(--color-text-muted)", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
              Searching your materials
              <span style={dotAnimation}>
                <span className="dot1">.</span>
                <span className="dot2">.</span>
                <span className="dot3">.</span>
              </span>
            </div>
            <style>{`
              @keyframes blink { 0%,20% { opacity: 0.2; } 50% { opacity: 1; } 100% { opacity: 0.2; } }
              .dot1 { animation: blink 1.4s infinite 0s; }
              .dot2 { animation: blink 1.4s infinite 0.2s; }
              .dot3 { animation: blink 1.4s infinite 0.4s; }
            `}</style>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div style={inputContainer}>
        <textarea
          ref={inputRef}
          aria-label="Ask a question"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            courses.length === 0
              ? "Upload course materials first..."
              : "Ask a question about your materials..."
          }
          disabled={courses.length === 0 || loading}
          rows={2}
          style={inputStyle}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
        />
        <button
          onClick={sendMessage}
          disabled={!input.trim() || !selectedCourse || loading || courses.length === 0}
          aria-label="Send message"
          type="button"
          style={{
            ...sendButton,
            opacity: input.trim() && selectedCourse && !loading ? 1 : 0.4,
          }}
        >
          {loading ? "..." : "Ask"}
        </button>
      </div>
    </div>
  );
}

// --- Citation rendering ---

function renderAnswerWithCitations(
  text: string,
  citations?: Citation[]
): React.ReactNode {
  if (!citations || citations.length === 0) return text;

  // Replace [1], [2], etc. with styled citation badges
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((part, i) => {
    const match = part.match(/^\[(\d+)\]$/);
    if (match) {
      const num = parseInt(match[1], 10);
      return (
        <span
          key={i}
          style={inlineCitationBadge}
          title={citations[num - 1]?.reason || `Source ${num}`}
        >
          {num}
        </span>
      );
    }
    return part;
  });
}

// --- Styles ---

const pageContainer: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "calc(100vh - 52px)",
  maxWidth: 700,
  margin: "0 auto",
  padding: "0 1rem",
  fontFamily: "var(--font-body)",
  color: "var(--color-text)",
};

const headerStyle: React.CSSProperties = {
  padding: "1.25rem 0 1rem",
  borderBottom: "1px solid var(--color-border-subtle)",
  flexShrink: 0,
};

const messagesContainer: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "1rem 0",
};

const emptyState: React.CSSProperties = {
  textAlign: "center",
  padding: "3rem 1rem",
};

const userBubble: React.CSSProperties = {
  background: "#3d4d3d",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  padding: "0.75rem 1rem",
  marginLeft: "2rem",
};

const assistantBubble: React.CSSProperties = {
  background: "var(--color-bg-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  padding: "0.75rem 1rem",
  marginRight: "2rem",
};

const citationButton: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  width: "100%",
  padding: "0.4rem 0.6rem",
  fontSize: "0.75rem",
  fontFamily: "inherit",
  background: "var(--color-bg)",
  color: "var(--color-text-muted)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: 4,
  cursor: "pointer",
  textAlign: "left",
};

const citationBadge: React.CSSProperties = {
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

const inlineCitationBadge: React.CSSProperties = {
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
  cursor: "help",
};

const citationExpanded: React.CSSProperties = {
  background: "var(--color-bg)",
  border: "1px solid var(--color-border-subtle)",
  borderTop: "none",
  borderRadius: "0 0 4px 4px",
  padding: "0.5rem 0.6rem",
  color: "var(--color-text-secondary)",
};

const inputContainer: React.CSSProperties = {
  display: "flex",
  gap: "0.5rem",
  padding: "0.75rem 0",
  borderTop: "1px solid var(--color-border-subtle)",
  flexShrink: 0,
  position: "sticky",
  bottom: 0,
  background: "var(--color-bg)",
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "0.6rem 0.75rem",
  fontSize: "0.85rem",
  fontFamily: "inherit",
  background: "var(--color-bg-card)",
  color: "var(--color-text)",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  resize: "none",
};

const sendButton: React.CSSProperties = {
  padding: "0.5rem 1rem",
  fontSize: "0.85rem",
  fontFamily: "var(--font-display)",
  fontWeight: 700,
  background: "var(--color-primary)",
  color: "var(--color-bg-darkest)",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  alignSelf: "flex-end",
};

const clearButton: React.CSSProperties = {
  fontSize: "0.75rem",
  fontFamily: "inherit",
  color: "var(--color-text-dim)",
  background: "none",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: 4,
  padding: "0.25rem 0.6rem",
  cursor: "pointer",
};

const kbdStyle: React.CSSProperties = {
  display: "inline-block",
  fontSize: "0.65rem",
  fontFamily: "monospace",
  background: "var(--color-bg-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 3,
  padding: "0.05rem 0.35rem",
  color: "var(--color-text)",
};

const dotAnimation: React.CSSProperties = {
  fontSize: "1.2rem",
  letterSpacing: "0.1em",
  lineHeight: 1,
};
