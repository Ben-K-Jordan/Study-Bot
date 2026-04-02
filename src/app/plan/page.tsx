"use client";

import { useState, useEffect, useCallback } from "react";
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
  gcal_link: string;
}

interface PlanResult {
  plan_id: string;
  ics_download_url: string;
  feed_url: string;
  webcal_url: string;
  items: PlanItem[];
}

interface PublishItemResult {
  plan_item_id: string;
  session_id: string;
  action: "CREATED" | "UPDATED" | "UNCHANGED" | "FAILED";
  event_id?: string;
  html_link?: string;
  error?: { code: string; message: string };
}

interface PublishResponse {
  plan_id: string;
  provider: string;
  calendar_id: string;
  status: "PUBLISHED" | "PARTIAL" | "FAILED";
  published_at: string;
  results: { created: number; updated: number; unchanged: number; failed: number };
  items: PublishItemResult[];
  warnings?: string[];
}

interface PublishStatus {
  publication: {
    status: string;
    calendar_id: string;
    published_at: string | null;
    last_synced_at: string | null;
    last_error: string | null;
  } | null;
  items: { plan_item_id: string; event_id: string; html_link: string | null }[];
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

  // Publish state
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<PublishResponse | null>(null);
  const [publishStatus, setPublishStatus] = useState<PublishStatus | null>(null);
  const [unpublishing, setUnpublishing] = useState(false);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);

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

  // Load publish status when plan result is available
  const loadPublishStatus = useCallback(async (planId: string) => {
    try {
      const res = await fetch(`/api/plans/${planId}/publish/google`, {
        headers: { "X-User-Id": getOrCreateUserId() },
      });
      if (res.ok) {
        const data = await res.json();
        setPublishStatus(data);
      }
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    if (result && googleConnected) {
      loadPublishStatus(result.plan_id);
    }
  }, [result, googleConnected, loadPublishStatus]);

  const updateAvailability = (index: number, field: "start" | "end", value: string) => {
    setAvailability((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handlePublish = async () => {
    if (!result) return;
    setPublishing(true);
    setError(null);
    setPublishResult(null);
    try {
      const res = await fetch(`/api/plans/${result.plan_id}/publish/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": getOrCreateUserId(),
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to publish");
        return;
      }
      setPublishResult(data);
      await loadPublishStatus(result.plan_id);
    } catch {
      setError("Network error");
    } finally {
      setPublishing(false);
    }
  };

  const handleUnpublish = async () => {
    if (!result) return;
    setUnpublishing(true);
    setError(null);
    try {
      const res = await fetch(`/api/plans/${result.plan_id}/unpublish/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": getOrCreateUserId(),
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to unpublish");
        return;
      }
      setPublishResult(null);
      setPublishStatus(null);
      setConfirmUnpublish(false);
    } catch {
      setError("Network error");
    } finally {
      setUnpublishing(false);
    }
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
      setPublishResult(null);
      setPublishStatus(null);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  const isPublished = publishStatus?.publication?.status === "PUBLISHED" || publishStatus?.publication?.status === "PARTIAL";

  // Build lookup of planItemId -> event link from status
  const eventLinkBySession = new Map<string, string>();
  if (publishStatus?.items) {
    for (const item of publishStatus.items) {
      if (item.html_link) {
        // We need to match by plan_item_id, but we don't have that in PlanItem
        // Use event_id as a marker
        eventLinkBySession.set(item.plan_item_id, item.html_link);
      }
    }
  }

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
          <fieldset style={{ border: "1px solid #333", padding: "1rem", marginBottom: "1rem" }}>
            <legend style={{ color: "#00ff88" }}>Course &amp; Exam</legend>
            <div style={{ marginBottom: "0.5rem" }}>
              <label>
                Course Name*{" "}
                <input type="text" value={courseName} onChange={(e) => setCourseName(e.target.value)} required style={inputStyle} />
              </label>
            </div>
            <div style={{ marginBottom: "0.5rem" }}>
              <label>
                Course ID{" "}
                <input type="text" value={courseId} onChange={(e) => setCourseId(e.target.value)} style={inputStyle} />
              </label>
            </div>
            <div style={{ marginBottom: "0.5rem" }}>
              <label>
                Exam Name*{" "}
                <input type="text" value={examName} onChange={(e) => setExamName(e.target.value)} required style={inputStyle} />
              </label>
            </div>
            <div style={{ marginBottom: "0.5rem" }}>
              <label>
                Exam ID{" "}
                <input type="text" value={examId} onChange={(e) => setExamId(e.target.value)} style={inputStyle} />
              </label>
            </div>
            <div style={{ marginBottom: "0.5rem" }}>
              <label>
                Exam Date*{" "}
                <input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} required style={inputStyle} />
              </label>
            </div>
          </fieldset>

          <fieldset style={{ border: "1px solid #333", padding: "1rem", marginBottom: "1rem" }}>
            <legend style={{ color: "#00ff88" }}>Objectives</legend>
            <p style={{ fontSize: "0.8rem", color: "#888", marginTop: 0 }}>One per line (minimum 3)</p>
            <textarea
              value={objectivesText}
              onChange={(e) => setObjectivesText(e.target.value)}
              rows={6}
              required
              style={{ ...inputStyle, width: "100%", resize: "vertical" }}
              placeholder={"Loops and invariants\nRecursion\nLinked lists\nStacks and queues\nBig-O analysis"}
            />
          </fieldset>

          <fieldset style={{ border: "1px solid #333", padding: "1rem", marginBottom: "1rem" }}>
            <legend style={{ color: "#00ff88" }}>Availability (7 days)</legend>
            {availability.map((day, i) => (
              <div key={i} style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.3rem" }}>
                <span style={{ width: 80, fontSize: "0.85rem" }}>Day {i}:</span>
                <input type="time" value={day.start} onChange={(e) => updateAvailability(i, "start", e.target.value)} style={{ ...inputStyle, width: 120 }} />
                <span>-</span>
                <input type="time" value={day.end} onChange={(e) => updateAvailability(i, "end", e.target.value)} style={{ ...inputStyle, width: 120 }} />
              </div>
            ))}
          </fieldset>

          <fieldset style={{ border: "1px solid #333", padding: "1rem", marginBottom: "1rem" }}>
            <legend style={{ color: "#00ff88" }}>Settings</legend>
            <div style={{ marginBottom: "0.5rem" }}>
              <label>
                Daily Study Cap (minutes){" "}
                <input type="number" value={dailyCap} onChange={(e) => setDailyCap(Number(e.target.value))} min={30} max={600} style={{ ...inputStyle, width: 80 }} />
              </label>
            </div>
            <div>
              <label>
                Break Protocol{" "}
                <select value={breakProtocol} onChange={(e) => setBreakProtocol(e.target.value)} style={inputStyle}>
                  <option value="25_5">25/5 (Pomodoro)</option>
                  <option value="50_10">50/10</option>
                  <option value="90_15">90/15</option>
                </select>
              </label>
            </div>
            <div style={{ marginTop: "0.75rem" }}>
              {googleConnected ? (
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <input type="checkbox" checked={useGoogleAvailability} onChange={(e) => setUseGoogleAvailability(e.target.checked)} />
                  Use Google Calendar availability
                </label>
              ) : (
                <div style={{ fontSize: "0.85rem", color: "#888" }}>
                  <a href="/settings/calendar" style={{ color: "#00ff88" }}>Connect Google Calendar</a>{" "}
                  to schedule around your existing events.
                </div>
              )}
            </div>
          </fieldset>

          {error && <ErrorBanner message={error} />}

          <button type="submit" disabled={loading} style={primaryBtnStyle(loading)}>
            {loading ? "Generating..." : "Generate Week Plan"}
          </button>
        </form>
      ) : (
        <div>
          {/* Header with plan ID and action buttons */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
            <div>
              <span style={{ color: "#888" }}>Plan ID: </span>
              <span style={{ color: "#00ff88" }}>{result.plan_id}</span>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <a href={result.webcal_url} style={actionBtnStyle}>Subscribe</a>
              <a href={result.ics_download_url} style={actionBtnStyle}>Download .ics</a>
              <button onClick={() => { setResult(null); setPublishResult(null); setPublishStatus(null); }} style={secondaryBtnStyle}>
                New Plan
              </button>
            </div>
          </div>

          {/* Google Calendar Section */}
          {googleConnected ? (
            <fieldset style={{ border: "1px solid #333", padding: "1rem", marginBottom: "1.5rem" }}>
              <legend style={{ color: "#4285f4" }}>Google Calendar</legend>

              {/* Status display */}
              {publishStatus?.publication && (
                <div style={{ marginBottom: "0.75rem", fontSize: "0.85rem" }}>
                  <StatusBadge status={publishStatus.publication.status} />
                  {publishStatus.publication.published_at && (
                    <span style={{ color: "#888", marginLeft: "0.5rem" }}>
                      Published to {publishStatus.publication.calendar_id} on{" "}
                      {new Date(publishStatus.publication.published_at).toLocaleString()}
                    </span>
                  )}
                  {publishStatus.publication.last_error && (
                    <div style={{ color: "#ff4444", marginTop: "0.25rem" }}>
                      Last error: {publishStatus.publication.last_error}
                    </div>
                  )}
                </div>
              )}

              {/* Publish result summary */}
              {publishResult && (
                <div style={{ background: "#111", padding: "0.75rem", marginBottom: "0.75rem", border: "1px solid #333" }}>
                  <div style={{ marginBottom: "0.5rem" }}>
                    <StatusBadge status={publishResult.status} />
                    <span style={{ color: "#888", marginLeft: "0.5rem", fontSize: "0.85rem" }}>
                      {publishResult.results.created} created, {publishResult.results.updated} updated, {publishResult.results.unchanged} unchanged
                      {publishResult.results.failed > 0 && <span style={{ color: "#ff4444" }}>, {publishResult.results.failed} failed</span>}
                    </span>
                  </div>
                  {publishResult.warnings && publishResult.warnings.length > 0 && (
                    <div style={{ fontSize: "0.8rem", color: "#ffaa00" }}>
                      {publishResult.warnings.map((w, i) => <div key={i}>{w}</div>)}
                    </div>
                  )}
                  {/* Per-item results table */}
                  <details style={{ marginTop: "0.5rem" }}>
                    <summary style={{ cursor: "pointer", fontSize: "0.85rem", color: "#aaa" }}>
                      Item details ({publishResult.items.length})
                    </summary>
                    <div style={{ marginTop: "0.5rem", maxHeight: 200, overflowY: "auto" }}>
                      {publishResult.items.map((item) => (
                        <div key={item.plan_item_id} style={{ display: "flex", gap: "0.5rem", fontSize: "0.8rem", padding: "0.2rem 0", borderBottom: "1px solid #222" }}>
                          <ActionBadge action={item.action} />
                          <span style={{ color: "#aaa" }}>{item.session_id.slice(0, 8)}...</span>
                          {item.html_link && (
                            <a href={item.html_link} target="_blank" rel="noopener noreferrer" style={{ color: "#4285f4" }}>
                              open
                            </a>
                          )}
                          {item.error && <span style={{ color: "#ff4444" }}>{item.error.message}</span>}
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              )}

              {/* Action buttons */}
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <button onClick={handlePublish} disabled={publishing} style={googleBtnStyle(publishing)}>
                  {publishing ? "Publishing..." : isPublished ? "Re-publish" : "Publish to Google Calendar"}
                </button>

                {isPublished && !confirmUnpublish && (
                  <button onClick={() => setConfirmUnpublish(true)} style={dangerBtnStyle(false)}>
                    Unpublish
                  </button>
                )}

                {confirmUnpublish && (
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <span style={{ color: "#ff4444", fontSize: "0.85rem" }}>Delete all events?</span>
                    <button onClick={handleUnpublish} disabled={unpublishing} style={dangerBtnStyle(unpublishing)}>
                      {unpublishing ? "..." : "Yes, unpublish"}
                    </button>
                    <button onClick={() => setConfirmUnpublish(false)} style={secondaryBtnStyle}>
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </fieldset>
          ) : (
            <div style={{ border: "1px solid #333", padding: "1rem", marginBottom: "1.5rem", fontSize: "0.85rem", color: "#888" }}>
              <a href="/settings/calendar" style={{ color: "#4285f4" }}>Connect Google Calendar</a>{" "}
              to publish study blocks directly to your calendar.
            </div>
          )}

          {error && <ErrorBanner message={error} />}

          {/* Day-by-day schedule */}
          {[0, 1, 2, 3, 4, 5, 6].map((dayIdx) => {
            const dayItems = grouped[dayIdx];
            if (!dayItems || dayItems.length === 0) return null;
            return (
              <div key={dayIdx} style={{ border: "1px solid #333", padding: "1rem", marginBottom: "1rem" }}>
                <h2 style={{ color: "#00ff88", fontSize: "1.1rem", marginTop: 0, marginBottom: "0.75rem" }}>
                  {DAY_LABELS[dayIdx]}
                </h2>
                {dayItems.map((item, i) => (
                  <div key={i} style={{ background: "#111", padding: "0.75rem", marginBottom: "0.5rem", borderLeft: "3px solid #00ff88" }}>
                    <div style={{ fontWeight: "bold", marginBottom: "0.3rem" }}>
                      {MODE_LABELS[item.mode] || item.mode}
                    </div>
                    <div style={{ fontSize: "0.85rem", color: "#aaa" }}>
                      {new Date(item.start_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      {" - "}
                      {new Date(item.end_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      {" "}({item.planned_minutes} min)
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "#888", marginTop: "0.25rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      Topics: {item.topic_scope}
                    </div>
                    <div style={{ display: "flex", gap: "1rem", marginTop: "0.3rem" }}>
                      <a href={item.session_url} target="_blank" rel="noopener noreferrer" style={{ color: "#00ff88", fontSize: "0.85rem" }}>
                        Open session
                      </a>
                      <a href={item.gcal_link} target="_blank" rel="noopener noreferrer" style={{ color: "#4285f4", fontSize: "0.85rem" }}>
                        + Google Cal
                      </a>
                    </div>
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

// ---- Sub-components ----

function ErrorBanner({ message }: { message: string }) {
  return (
    <div style={{ color: "#ff4444", padding: "0.5rem", marginBottom: "1rem", border: "1px solid #ff4444" }}>
      {message}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    PUBLISHED: "#00ff88",
    PARTIAL: "#ffaa00",
    FAILED: "#ff4444",
    UNPUBLISHED: "#888",
    NOT_PUBLISHED: "#888",
  };
  const color = colors[status] || "#888";
  return (
    <span style={{ color, fontWeight: "bold", fontSize: "0.85rem" }}>
      [{status}]
    </span>
  );
}

function ActionBadge({ action }: { action: string }) {
  const colors: Record<string, string> = {
    CREATED: "#00ff88",
    UPDATED: "#4285f4",
    UNCHANGED: "#888",
    FAILED: "#ff4444",
  };
  return (
    <span style={{ color: colors[action] || "#888", fontWeight: "bold", minWidth: 80, display: "inline-block" }}>
      {action}
    </span>
  );
}

// ---- Styles ----

const inputStyle: React.CSSProperties = {
  background: "#111",
  color: "#e0e0e0",
  border: "1px solid #333",
  padding: "0.4rem 0.6rem",
  fontFamily: "monospace",
  fontSize: "0.9rem",
};

const actionBtnStyle: React.CSSProperties = {
  background: "#00ff88",
  color: "#000",
  padding: "0.5rem 1rem",
  textDecoration: "none",
  fontFamily: "monospace",
  fontWeight: "bold",
};

const secondaryBtnStyle: React.CSSProperties = {
  background: "#333",
  color: "#e0e0e0",
  border: "1px solid #555",
  padding: "0.5rem 1rem",
  fontFamily: "monospace",
  cursor: "pointer",
};

function primaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    background: "#00ff88",
    color: "#000",
    border: "none",
    padding: "0.75rem 1.5rem",
    fontFamily: "monospace",
    fontWeight: "bold",
    fontSize: "1rem",
    cursor: disabled ? "wait" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}

function googleBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    background: "#4285f4",
    color: "#fff",
    border: "none",
    padding: "0.5rem 1rem",
    fontFamily: "monospace",
    fontWeight: "bold",
    cursor: disabled ? "wait" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}

function dangerBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    background: "#ff4444",
    color: "#fff",
    border: "none",
    padding: "0.5rem 1rem",
    fontFamily: "monospace",
    fontWeight: "bold",
    cursor: disabled ? "wait" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}
