"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { getOrCreateUserId } from "@/lib/client-utils";

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

interface CourseOption {
  course_name: string;
  exam_name?: string;
  doc_count: number;
}

// --- API helpers ---

let msgCounter = 0;

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

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = sessionStorage.getItem("chat_messages");
      return saved ? (JSON.parse(saved) as Message[]) : [];
    } catch { return []; }
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return sessionStorage.getItem("chat_selected_course") || "";
  });
  const [expandedCitation, setExpandedCitation] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Persist messages to sessionStorage
  useEffect(() => {
    try { sessionStorage.setItem("chat_messages", JSON.stringify(messages)); } catch {}
  }, [messages]);

  // Persist selected course
  useEffect(() => {
    try { if (selectedCourse) sessionStorage.setItem("chat_selected_course", selectedCourse); } catch {}
  }, [selectedCourse]);

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
        if (!selectedCourse && options.length > 0) {
          setSelectedCourse(
            options[0].exam_name
              ? `${options[0].course_name}||${options[0].exam_name}`
              : options[0].course_name
          );
        }
      }
    }).catch(() => {});
    return () => { mounted = false; };
  }, [selectedCourse]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(async () => {
    const question = input.trim();
    if (!question || !selectedCourse || loading) return;

    const [courseName, examName] = selectedCourse.split("||");

    const userMsg: Message = {
      id: `u-${++msgCounter}`,
      role: "user",
      content: question,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const response = await apiPost("/api/assistant/answer", {
        question,
        course_name: courseName,
        exam_name: examName || undefined,
        verbosity: "MEDIUM",
        top_k: 5,
      });

      const assistantMsg: Message = {
        id: `a-${++msgCounter}`,
        role: "assistant",
        content: response.answer_markdown || "No response received.",
        citations: response.citations || [],
        meta: response.meta,
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${++msgCounter}`,
          role: "assistant",
          content: err instanceof Error ? err.message : "Something went wrong. Please try again.",
        },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, selectedCourse, loading]);

  const parsedCourse = selectedCourse.split("||");

  return (
    <div style={pageContainer}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <h1 style={titleStyle}>Source Chat</h1>
          {messages.length > 0 && (
            <button
              onClick={() => { setMessages([]); sessionStorage.removeItem("chat_messages"); }}
              style={clearButton}
            >
              Clear chat
            </button>
          )}
        </div>
        <p style={subtitleStyle}>Ask questions about your course materials</p>

        {/* Course selector */}
        {courses.length > 0 ? (
          <select
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
          <p style={{ color: "#e8a040", fontSize: "0.85rem", margin: 0 }}>
            No course documents uploaded yet.{" "}
            <Link href="/" style={{ color: "#f0dc4e", textDecoration: "underline" }}>
              Upload materials on the Dashboard
            </Link>
          </p>
        )}
      </div>

      {/* Messages */}
      <div style={messagesContainer}>
        {messages.length === 0 && (
          <div style={emptyState}>
            <p style={{ fontSize: "1.2rem", color: "#a89a82", marginBottom: "0.5rem" }}>
              Ask anything about your {parsedCourse[0] || "course"} materials
            </p>
            <p style={{ fontSize: "0.85rem", color: "#7a7060" }}>
              Your answers will be grounded in your uploaded documents with inline citations.
            </p>
            <p style={{ fontSize: "0.75rem", color: "#7a7060", marginTop: "0.25rem" }}>
              Press <kbd style={kbdStyle}>Enter</kbd> to send, <kbd style={kbdStyle}>Shift+Enter</kbd> for new line
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} style={{ marginBottom: "1rem" }}>
            {/* Message bubble */}
            <div
              style={
                msg.role === "user" ? userBubble : assistantBubble
              }
            >
              <div
                style={{
                  fontSize: "0.7rem",
                  color: msg.role === "user" ? "#f0dc4e" : "#7ec8e3",
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
                    color: "#7a7060",
                    marginBottom: "0.3rem",
                    letterSpacing: "0.05em",
                  }}
                >
                  SOURCES ({msg.citations.length})
                </div>
                {msg.citations.map((c, i) => (
                  <div key={c.chunk_id} style={{ marginBottom: "0.3rem" }}>
                    <button
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
                      <span style={{ color: "#7a7060", fontSize: "0.75rem" }}>
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
            {msg.meta && (
              <div style={{ fontSize: "0.65rem", color: "#7a7060", marginTop: "0.25rem", marginLeft: "0.5rem" }}>
                {msg.meta.chunks_retrieved ?? 0} sources searched
                {msg.meta.latency_ms ? ` · ${(msg.meta.latency_ms / 1000).toFixed(1)}s` : ""}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div style={assistantBubble}>
            <div style={{ fontSize: "0.7rem", color: "#7ec8e3", marginBottom: "0.3rem", fontWeight: 600 }}>
              STUDY BOT
            </div>
            <div style={{ color: "#a89a82", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
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
  maxWidth: 720,
  margin: "0 auto",
  padding: "0 1rem",
  fontFamily: "var(--font-body), 'Patrick Hand', cursive",
  color: "#e8dcc8",
};

const headerStyle: React.CSSProperties = {
  padding: "1.25rem 0 1rem",
  borderBottom: "1px solid #3a5a3a",
  flexShrink: 0,
};

const titleStyle: React.CSSProperties = {
  fontSize: "1.6rem",
  margin: "0 0 0.25rem",
  fontFamily: "var(--font-display), 'Caveat', cursive",
  color: "#f0dc4e",
};

const subtitleStyle: React.CSSProperties = {
  color: "#a89a82",
  margin: "0 0 0.75rem",
  fontSize: "0.9rem",
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
  border: "1px solid #4a6a4a",
  borderRadius: 6,
  padding: "0.75rem 1rem",
  marginLeft: "2rem",
};

const assistantBubble: React.CSSProperties = {
  background: "#334d33",
  border: "1px solid #4a6a4a",
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
  background: "#2d3d2d",
  color: "#a89a82",
  border: "1px solid #3a5a3a",
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
  background: "#7ec8e3",
  color: "#1f2e1f",
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
  background: "#7ec8e3",
  color: "#1f2e1f",
  fontSize: "0.6rem",
  fontWeight: 700,
  marginLeft: 2,
  marginRight: 2,
  verticalAlign: "super",
  cursor: "help",
};

const citationExpanded: React.CSSProperties = {
  background: "#2d3d2d",
  border: "1px solid #3a5a3a",
  borderTop: "none",
  borderRadius: "0 0 4px 4px",
  padding: "0.5rem 0.6rem",
  color: "#c8bca8",
};

const inputContainer: React.CSSProperties = {
  display: "flex",
  gap: "0.5rem",
  padding: "0.75rem 0",
  borderTop: "1px solid #3a5a3a",
  flexShrink: 0,
  position: "sticky",
  bottom: 0,
  background: "#2a3d2a",
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "0.6rem 0.75rem",
  fontSize: "0.85rem",
  fontFamily: "inherit",
  background: "#334d33",
  color: "#e8dcc8",
  border: "1px solid #4a6a4a",
  borderRadius: 6,
  resize: "none",
};

const sendButton: React.CSSProperties = {
  padding: "0.6rem 1.25rem",
  fontSize: "0.9rem",
  fontFamily: "var(--font-display), 'Caveat', cursive",
  fontWeight: 700,
  background: "#f0dc4e",
  color: "#1f2e1f",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  alignSelf: "flex-end",
};

const clearButton: React.CSSProperties = {
  fontSize: "0.75rem",
  fontFamily: "inherit",
  color: "#7a7060",
  background: "none",
  border: "1px solid #3a5a3a",
  borderRadius: 4,
  padding: "0.25rem 0.6rem",
  cursor: "pointer",
};

const kbdStyle: React.CSSProperties = {
  display: "inline-block",
  fontSize: "0.65rem",
  fontFamily: "monospace",
  background: "#334d33",
  border: "1px solid #4a6a4a",
  borderRadius: 3,
  padding: "0.05rem 0.35rem",
  color: "#e8dcc8",
};

const dotAnimation: React.CSSProperties = {
  fontSize: "1.2rem",
  letterSpacing: "0.1em",
  lineHeight: 1,
};
