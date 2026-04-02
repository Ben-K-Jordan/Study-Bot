"use client";

import { useState, useEffect } from "react";
import { MODE_LABELS, getOrCreateUserId } from "@/lib/client-utils";

const DAY_LABELS = ["Day 0 (Today)", "Day 1", "Day 2", "Day 3", "Day 4", "Day 5", "Day 6"];

interface PlanItem {
  day_index: number;
  start_time: string;
  end_time: string;
  session_id: string;
  session_url: string;
  mode: string;
  topic_scope: string;
  planned_minutes: number;
  calendar: { title: string; description: string };
}

interface PlanResult {
  plan_id: string;
  items: PlanItem[];
}

const defaultAvailability = Array.from({ length: 7 }, () => ({
  start: "09:00",
  end: "17:00",
}));

export default function PlanPage() {
  const [courseName, setCourseName] = useState("");
  const [courseId, setCourseId] = useState("");
  const [examName, setExamName] = useState("");
  const [examId, setExamId] = useState("");
  const [examDate, setExamDate] = useState("");
  const [objectivesText, setObjectivesText] = useState("");
  const [availability, setAvailability] = useState(defaultAvailability);
  const [dailyCap, setDailyCap] = useState(180);
  const [breakProtocol, setBreakProtocol] = useState("50_10");
  const [useGoogleAvailability, setUseGoogleAvailability] = useState(false);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PlanResult | null>(null);

  // Check if Google Calendar is connected
  useEffect(() => {
    async function checkGoogle() {
      try {
        const res = await fetch("/api/integrations/google/status", {
          headers: { "X-User-Id": getOrCreateUserId() },
        });
        const data = await res.json();
        setGoogleConnected(data.connected);
      } catch {
        // Non-critical
      }
    }
    checkGoogle();
  }, []);

  const updateAvailability = (
    index: number,
    field: "start" | "end",
    value: string,
  ) => {
    setAvailability((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const objectives = objectivesText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      const res = await fetch("/api/plans", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": getOrCreateUserId(),
        },
        body: JSON.stringify({
          course_name: courseName,
          course_id: courseId || undefined,
          exam_name: examName,
          exam_id: examId || undefined,
          exam_date: examDate,
          objectives,
          availability,
          daily_study_cap_minutes: dailyCap,
          break_protocol_default: breakProtocol,
          use_google_availability: useGoogleAvailability || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create plan");
        return;
      }
      setResult(data);
    } catch (err) {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  const grouped = result
    ? result.items.reduce<Record<number, PlanItem[]>>((acc, item) => {
        (acc[item.day_index] = acc[item.day_index] || []).push(item);
        return acc;
      }, {})
    : {};

  return (
    <div
      style={{
        fontFamily: "monospace",
        background: "#0a0a0a",
        color: "#e0e0e0",
        minHeight: "100vh",
        padding: "2rem",
      }}
    >
      <h1 style={{ color: "#00ff88", fontSize: "1.5rem", marginBottom: "1.5rem" }}>
        Week Planner
      </h1>

      {!result ? (
        <form onSubmit={handleSubmit} style={{ maxWidth: 600 }}>
          <fieldset
            style={{
              border: "1px solid #333",
              padding: "1rem",
              marginBottom: "1rem",
            }}
          >
            <legend style={{ color: "#00ff88" }}>Course &amp; Exam</legend>
            <div style={{ marginBottom: "0.5rem" }}>
              <label>
                Course Name*{" "}
                <input
                  type="text"
                  value={courseName}
                  onChange={(e) => setCourseName(e.target.value)}
                  required
                  style={inputStyle}
                />
              </label>
            </div>
            <div style={{ marginBottom: "0.5rem" }}>
              <label>
                Course ID{" "}
                <input
                  type="text"
                  value={courseId}
                  onChange={(e) => setCourseId(e.target.value)}
                  style={inputStyle}
                />
              </label>
            </div>
            <div style={{ marginBottom: "0.5rem" }}>
              <label>
                Exam Name*{" "}
                <input
                  type="text"
                  value={examName}
                  onChange={(e) => setExamName(e.target.value)}
                  required
                  style={inputStyle}
                />
              </label>
            </div>
            <div style={{ marginBottom: "0.5rem" }}>
              <label>
                Exam ID{" "}
                <input
                  type="text"
                  value={examId}
                  onChange={(e) => setExamId(e.target.value)}
                  style={inputStyle}
                />
              </label>
            </div>
            <div style={{ marginBottom: "0.5rem" }}>
              <label>
                Exam Date*{" "}
                <input
                  type="date"
                  value={examDate}
                  onChange={(e) => setExamDate(e.target.value)}
                  required
                  style={inputStyle}
                />
              </label>
            </div>
          </fieldset>

          <fieldset
            style={{
              border: "1px solid #333",
              padding: "1rem",
              marginBottom: "1rem",
            }}
          >
            <legend style={{ color: "#00ff88" }}>Objectives</legend>
            <p style={{ fontSize: "0.8rem", color: "#888", marginTop: 0 }}>
              One per line (minimum 3)
            </p>
            <textarea
              value={objectivesText}
              onChange={(e) => setObjectivesText(e.target.value)}
              rows={6}
              required
              style={{ ...inputStyle, width: "100%", resize: "vertical" }}
              placeholder={"Loops and invariants\nRecursion\nLinked lists\nStacks and queues\nBig-O analysis"}
            />
          </fieldset>

          <fieldset
            style={{
              border: "1px solid #333",
              padding: "1rem",
              marginBottom: "1rem",
            }}
          >
            <legend style={{ color: "#00ff88" }}>Availability (7 days)</legend>
            {availability.map((day, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  alignItems: "center",
                  marginBottom: "0.3rem",
                }}
              >
                <span style={{ width: 80, fontSize: "0.85rem" }}>
                  Day {i}:
                </span>
                <input
                  type="time"
                  value={day.start}
                  onChange={(e) => updateAvailability(i, "start", e.target.value)}
                  style={{ ...inputStyle, width: 120 }}
                />
                <span>–</span>
                <input
                  type="time"
                  value={day.end}
                  onChange={(e) => updateAvailability(i, "end", e.target.value)}
                  style={{ ...inputStyle, width: 120 }}
                />
              </div>
            ))}
          </fieldset>

          <fieldset
            style={{
              border: "1px solid #333",
              padding: "1rem",
              marginBottom: "1rem",
            }}
          >
            <legend style={{ color: "#00ff88" }}>Settings</legend>
            <div style={{ marginBottom: "0.5rem" }}>
              <label>
                Daily Study Cap (minutes){" "}
                <input
                  type="number"
                  value={dailyCap}
                  onChange={(e) => setDailyCap(Number(e.target.value))}
                  min={30}
                  max={600}
                  style={{ ...inputStyle, width: 80 }}
                />
              </label>
            </div>
            <div>
              <label>
                Break Protocol{" "}
                <select
                  value={breakProtocol}
                  onChange={(e) => setBreakProtocol(e.target.value)}
                  style={inputStyle}
                >
                  <option value="25_5">25/5 (Pomodoro)</option>
                  <option value="50_10">50/10</option>
                  <option value="90_15">90/15</option>
                </select>
              </label>
            </div>
            <div style={{ marginTop: "0.75rem" }}>
              {googleConnected ? (
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <input
                    type="checkbox"
                    checked={useGoogleAvailability}
                    onChange={(e) => setUseGoogleAvailability(e.target.checked)}
                  />
                  Use Google Calendar availability
                </label>
              ) : (
                <div style={{ fontSize: "0.85rem", color: "#888" }}>
                  <a href="/settings/calendar" style={{ color: "#00ff88" }}>
                    Connect Google Calendar
                  </a>{" "}
                  to schedule around your existing events.
                </div>
              )}
            </div>
          </fieldset>

          {error && (
            <div
              style={{
                color: "#ff4444",
                padding: "0.5rem",
                marginBottom: "1rem",
                border: "1px solid #ff4444",
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              background: "#00ff88",
              color: "#000",
              border: "none",
              padding: "0.75rem 1.5rem",
              fontFamily: "monospace",
              fontWeight: "bold",
              fontSize: "1rem",
              cursor: loading ? "wait" : "pointer",
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? "Generating..." : "Generate Week Plan"}
          </button>
        </form>
      ) : (
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "1.5rem",
            }}
          >
            <div>
              <span style={{ color: "#888" }}>Plan ID: </span>
              <span style={{ color: "#00ff88" }}>{result.plan_id}</span>
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <a
                href={`/api/plans/${result.plan_id}/ics`}
                style={{
                  background: "#00ff88",
                  color: "#000",
                  padding: "0.5rem 1rem",
                  textDecoration: "none",
                  fontFamily: "monospace",
                  fontWeight: "bold",
                }}
              >
                Download .ics
              </a>
              <button
                onClick={() => setResult(null)}
                style={{
                  background: "#333",
                  color: "#e0e0e0",
                  border: "1px solid #555",
                  padding: "0.5rem 1rem",
                  fontFamily: "monospace",
                  cursor: "pointer",
                }}
              >
                New Plan
              </button>
            </div>
          </div>

          {[0, 1, 2, 3, 4, 5, 6].map((dayIdx) => {
            const dayItems = grouped[dayIdx];
            if (!dayItems || dayItems.length === 0) return null;
            return (
              <div
                key={dayIdx}
                style={{
                  border: "1px solid #333",
                  padding: "1rem",
                  marginBottom: "1rem",
                }}
              >
                <h2
                  style={{
                    color: "#00ff88",
                    fontSize: "1.1rem",
                    marginTop: 0,
                    marginBottom: "0.75rem",
                  }}
                >
                  {DAY_LABELS[dayIdx]}
                </h2>
                {dayItems.map((item, i) => (
                  <div
                    key={i}
                    style={{
                      background: "#111",
                      padding: "0.75rem",
                      marginBottom: "0.5rem",
                      borderLeft: "3px solid #00ff88",
                    }}
                  >
                    <div style={{ fontWeight: "bold", marginBottom: "0.3rem" }}>
                      {MODE_LABELS[item.mode] || item.mode}
                    </div>
                    <div style={{ fontSize: "0.85rem", color: "#aaa" }}>
                      {new Date(item.start_time).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      –{" "}
                      {new Date(item.end_time).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      ({item.planned_minutes} min)
                    </div>
                    <div
                      style={{
                        fontSize: "0.8rem",
                        color: "#888",
                        marginTop: "0.25rem",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Topics: {item.topic_scope}
                    </div>
                    <a
                      href={item.session_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: "#00ff88",
                        fontSize: "0.85rem",
                        marginTop: "0.3rem",
                        display: "inline-block",
                      }}
                    >
                      Open session →
                    </a>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "#111",
  color: "#e0e0e0",
  border: "1px solid #333",
  padding: "0.4rem 0.6rem",
  fontFamily: "monospace",
  fontSize: "0.9rem",
};
