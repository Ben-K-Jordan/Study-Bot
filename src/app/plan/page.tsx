"use client";

import { useState, useEffect, useCallback } from "react";
import { MODE_LABELS, getOrCreateUserId } from "@/lib/client-utils";

const DAY_LABELS = ["Day 0 (Today)", "Day 1", "Day 2", "Day 3", "Day 4", "Day 5", "Day 6"];

interface PlanItem {
  id: string;
  day_index: number;
  start_time: string;
  end_time: string;
  status: string;
  locked: boolean;
  completed_at: string | null;
  missed_at: string | null;
  original_start_at: string | null;
  original_end_at: string | null;
  session_id: string;
  session_url: string;
  mode: string;
  topic_scope: string;
  planned_minutes: number;
  calendar: { title: string; description: string };
  gcal_link: string;
}

interface ReflowChange {
  itemId: string;
  sessionId: string;
  action: "MOVED" | "DROPPED" | "KEPT";
  before: { dayIndex: number; startTime: string; endTime: string } | null;
  after: { dayIndex: number; startTime: string; endTime: string } | null;
}

interface ReflowPreview {
  plan_id: string;
  algorithm_version: string;
  changes: ReflowChange[];
  warnings: { itemId: string; code: string; message: string }[];
  summary: { total_items: number; moved: number; kept: number; dropped: number };
}

interface PlanResult {
  plan_id: string;
  ai_generated?: boolean;
  reasoning?: string | null;
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
  status: "OK" | "PARTIAL" | "FAILED";
  published_at: string;
  duration_ms: number;
  summary: { created: number; updated: number; unchanged: number; failed: number; total: number };
  item_results: PublishItemResult[];
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

  const [googleStatus, setGoogleStatus] = useState<string>("DISCONNECTED");
  const [googleError, setGoogleError] = useState<{ code: string; message: string } | null>(null);

  // Reflow state
  const [reflowPreview, setReflowPreview] = useState<ReflowPreview | null>(null);
  const [reflowLoading, setReflowLoading] = useState(false);
  const [reflowApplying, setReflowApplying] = useState(false);
  const [reflowResult, setReflowResult] = useState<{
    audit_id: string;
    summary: { moved: number; kept: number; dropped: number };
    calendar?: { status: string; summary?: { created: number; updated: number; unchanged: number; failed: number }; error?: string; duration_ms?: number } | null;
  } | null>(null);
  const [itemUpdating, setItemUpdating] = useState<string | null>(null);

  // Check if Google Calendar is connected
  useEffect(() => {
    async function checkGoogle() {
      try {
        const res = await fetch("/api/integrations/google/status", {
          headers: { "X-User-Id": getOrCreateUserId() },
        });
        const data = await res.json();
        setGoogleConnected(data.connected ?? data.status === "CONNECTED");
        setGoogleStatus(data.status || "DISCONNECTED");
        setGoogleError(data.last_error || null);
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
        if (data.error === "GOOGLE_RECONNECT_REQUIRED") {
          setError("Google Calendar token expired. Please reconnect in Settings.");
          setGoogleStatus("ERROR");
        } else {
          setError(data.error || "Failed to publish");
        }
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

  // ---- Item status handlers ----
  const handleItemStatus = async (itemId: string, status: string, locked?: boolean) => {
    if (!result) return;
    setItemUpdating(itemId);
    try {
      const body: Record<string, unknown> = { status };
      if (locked !== undefined) body.locked = locked;
      const res = await fetch(`/api/plans/${result.plan_id}/items/${itemId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-User-Id": getOrCreateUserId() },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        // Update local state
        setResult((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            items: prev.items.map((item) =>
              item.id === itemId
                ? { ...item, status: data.status, locked: data.locked, completed_at: data.completed_at, missed_at: data.missed_at }
                : item,
            ),
          };
        });
      } else {
        const data = await res.json();
        setError(data.error || "Failed to update item");
      }
    } catch {
      setError("Network error updating item");
    } finally {
      setItemUpdating(null);
    }
  };

  const handleToggleLock = async (item: PlanItem) => {
    await handleItemStatus(item.id, item.status, !item.locked);
  };

  // ---- Reflow handlers ----
  const handleReflowPreview = async () => {
    if (!result) return;
    setReflowLoading(true);
    setReflowPreview(null);
    setError(null);
    try {
      const res = await fetch(`/api/plans/${result.plan_id}/reflow/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-User-Id": getOrCreateUserId() },
        body: JSON.stringify({ reason: "MANUAL" }),
      });
      const data = await res.json();
      if (res.ok) {
        setReflowPreview(data);
      } else {
        setError(data.error || "Failed to compute reflow");
      }
    } catch {
      setError("Network error");
    } finally {
      setReflowLoading(false);
    }
  };

  const handleReflowApply = async () => {
    if (!result) return;
    setReflowApplying(true);
    setError(null);
    setReflowResult(null);
    try {
      const res = await fetch(`/api/plans/${result.plan_id}/reflow/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-User-Id": getOrCreateUserId() },
        body: JSON.stringify({
          reason: "MANUAL",
          calendar_update: isPublished ? "REPUBLISH" : "NONE",
        }),
      });
      const data = await res.json();
      if (res.ok && data.applied) {
        // Reload the plan to get updated times
        const planRes = await fetch(`/api/plans/${result.plan_id}`, {
          headers: { "X-User-Id": getOrCreateUserId() },
        });
        if (planRes.ok) {
          const planData = await planRes.json();
          setResult({ ...result, items: planData.items });
        }
        setReflowPreview(null);
        setReflowResult({
          audit_id: data.audit_id,
          summary: data.summary,
          calendar: data.calendar,
        });
        // Refresh publish status if calendar was updated
        if (data.calendar && googleConnected) {
          await loadPublishStatus(result.plan_id);
        }
      } else {
        setError(data.error || data.message || "No changes applied");
      }
    } catch {
      setError("Network error");
    } finally {
      setReflowApplying(false);
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

          {/* AI reasoning section */}
          <div style={{ border: "1px solid #333", padding: "1rem", marginBottom: "1.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: result.reasoning ? "0.75rem" : 0 }}>
              <span style={{
                fontSize: "0.75rem",
                fontWeight: "bold",
                padding: "0.2rem 0.5rem",
                border: `1px solid ${result.ai_generated ? "#aa88ff" : "#888"}`,
                color: result.ai_generated ? "#aa88ff" : "#888",
              }}>
                {result.ai_generated ? "Research-Informed Plan" : "Deterministic Plan"}
              </span>
              <span style={{ fontSize: "0.8rem", color: "#888" }}>
                {result.ai_generated
                  ? "Schedule was optimized using AI research on learning science and spaced repetition."
                  : "Schedule was generated using a fixed algorithm."}
              </span>
            </div>
            {result.reasoning && (
              <details>
                <summary style={{ cursor: "pointer", fontSize: "0.85rem", color: "#aa88ff" }}>
                  View AI reasoning
                </summary>
                <div style={{
                  marginTop: "0.5rem",
                  padding: "0.75rem",
                  background: "#111",
                  border: "1px solid #333",
                  fontSize: "0.85rem",
                  color: "#ccc",
                  whiteSpace: "pre-wrap",
                  lineHeight: "1.5",
                }}>
                  {result.reasoning}
                </div>
              </details>
            )}
          </div>

          {/* Google Calendar Section */}
          {googleConnected || googleStatus === "ERROR" ? (
            <fieldset style={{ border: "1px solid #333", padding: "1rem", marginBottom: "1.5rem" }}>
              <legend style={{ color: "#4285f4" }}>Google Calendar</legend>

              {/* Reconnect banner */}
              {(googleStatus === "ERROR" || googleError) && (
                <div style={{ color: "#ff4444", border: "1px solid #ff4444", padding: "0.5rem", marginBottom: "0.75rem", fontSize: "0.85rem" }}>
                  <strong>Reconnect required</strong>
                  {googleError && <span> — {googleError.message}</span>}
                  <div style={{ marginTop: "0.4rem" }}>
                    <a href="/settings/calendar" style={{ color: "#4285f4", fontWeight: "bold" }}>Go to Settings to reconnect</a>
                  </div>
                </div>
              )}

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
                      {publishResult.summary.created} created, {publishResult.summary.updated} updated, {publishResult.summary.unchanged} unchanged
                      {publishResult.summary.failed > 0 && <span style={{ color: "#ff4444" }}>, {publishResult.summary.failed} failed</span>}
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
                      Item details ({publishResult.item_results.length})
                    </summary>
                    <div style={{ marginTop: "0.5rem", maxHeight: 200, overflowY: "auto" }}>
                      {publishResult.item_results.map((item) => (
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

          {/* Reflow section */}
          <fieldset style={{ border: "1px solid #333", padding: "1rem", marginBottom: "1.5rem" }}>
            <legend style={{ color: "#00ff88" }}>Reschedule (Reflow)</legend>
            <p style={{ fontSize: "0.8rem", color: "#888", marginTop: 0 }}>
              Mark items as Done/Missed/Skipped, then preview and apply a reflow to reschedule remaining sessions.
            </p>

            {/* Reflow apply result banner */}
            {reflowResult && (
              <div data-testid="reflow-result" style={{ background: "#0a1a0a", border: "1px solid #00ff88", padding: "0.75rem", marginBottom: "0.75rem", fontSize: "0.85rem" }}>
                <div style={{ color: "#00ff88", fontWeight: "bold", marginBottom: "0.4rem" }}>
                  Reflow applied
                </div>
                <div style={{ color: "#aaa" }}>
                  {reflowResult.summary.moved} moved, {reflowResult.summary.kept} kept
                  {reflowResult.summary.dropped > 0 && <span style={{ color: "#ff4444" }}>, {reflowResult.summary.dropped} dropped</span>}
                </div>
                {reflowResult.audit_id && (
                  <div style={{ color: "#666", fontSize: "0.78rem", marginTop: "0.25rem" }}>
                    Audit: {reflowResult.audit_id.slice(0, 8)}...
                  </div>
                )}
                {reflowResult.calendar && (
                  <div data-testid="reflow-calendar-result" style={{ marginTop: "0.4rem", padding: "0.4rem", background: "#111", border: "1px solid #333" }}>
                    {reflowResult.calendar.error ? (
                      <div style={{ color: "#ff4444" }}>
                        Calendar update failed: {reflowResult.calendar.error}
                        <button onClick={handlePublish} style={{ ...smallBtnStyle("#4285f4"), marginLeft: "0.5rem" }}>
                          Retry publish
                        </button>
                      </div>
                    ) : reflowResult.calendar.status === "PARTIAL" ? (
                      <div>
                        <span style={{ color: "#ffaa00" }}>Calendar partially updated</span>
                        {reflowResult.calendar.summary && (
                          <span style={{ color: "#888" }}>
                            {" "}— {reflowResult.calendar.summary.updated} updated, {reflowResult.calendar.summary.failed} failed
                          </span>
                        )}
                        <button onClick={handlePublish} style={{ ...smallBtnStyle("#4285f4"), marginLeft: "0.5rem" }}>
                          Retry publish
                        </button>
                      </div>
                    ) : (
                      <div style={{ color: "#00ff88" }}>
                        Calendar updated
                        {reflowResult.calendar.summary && (
                          <span style={{ color: "#888" }}>
                            {" "}— {reflowResult.calendar.summary.created} created, {reflowResult.calendar.summary.updated} updated, {reflowResult.calendar.summary.unchanged} unchanged
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <button onClick={() => setReflowResult(null)} style={{ ...smallBtnStyle("#555"), marginTop: "0.4rem" }}>
                  Dismiss
                </button>
              </div>
            )}

            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              <button data-testid="preview-reflow-btn" onClick={handleReflowPreview} disabled={reflowLoading} style={secondaryBtnStyle}>
                {reflowLoading ? "Computing..." : "Preview Reflow"}
              </button>
              {reflowPreview && reflowPreview.summary.moved > 0 && (
                <button data-testid="apply-reflow-btn" onClick={handleReflowApply} disabled={reflowApplying} style={primaryBtnStyle(reflowApplying)}>
                  {reflowApplying ? "Applying..." : `Apply Reflow (${reflowPreview.summary.moved} moves)`}
                </button>
              )}
              {reflowPreview && (
                <button onClick={() => setReflowPreview(null)} style={secondaryBtnStyle}>
                  Dismiss
                </button>
              )}
            </div>

            {reflowPreview && (
              <div data-testid="reflow-preview" style={{ marginTop: "0.75rem", background: "#111", padding: "0.75rem", border: "1px solid #333" }}>
                <div style={{ fontSize: "0.85rem", marginBottom: "0.5rem" }}>
                  <span style={{ color: "#00ff88" }}>{reflowPreview.summary.moved} moved</span>
                  {", "}
                  <span style={{ color: "#888" }}>{reflowPreview.summary.kept} kept</span>
                  {reflowPreview.summary.dropped > 0 && (
                    <span style={{ color: "#ff4444" }}>, {reflowPreview.summary.dropped} dropped</span>
                  )}
                </div>

                {/* Warnings */}
                {reflowPreview.warnings.length > 0 && (
                  <div style={{ fontSize: "0.8rem", color: "#ffaa00", marginBottom: "0.5rem" }}>
                    {reflowPreview.warnings.map((w, i) => <div key={i}>{w.message}</div>)}
                  </div>
                )}

                {/* Moved items grouped by target day */}
                {(() => {
                  const moved = reflowPreview.changes.filter((c) => c.action === "MOVED");
                  if (moved.length === 0) return null;
                  const byDay = moved.reduce<Record<number, typeof moved>>((acc, c) => {
                    const day = c.after?.dayIndex ?? -1;
                    (acc[day] = acc[day] || []).push(c);
                    return acc;
                  }, {});
                  return (
                    <div style={{ marginBottom: "0.5rem" }}>
                      <div style={{ fontSize: "0.8rem", color: "#4285f4", fontWeight: "bold", marginBottom: "0.25rem" }}>Moved items:</div>
                      {Object.entries(byDay).sort(([a], [b]) => Number(a) - Number(b)).map(([day, changes]) => (
                        <div key={day} style={{ marginBottom: "0.3rem" }}>
                          <div style={{ fontSize: "0.78rem", color: "#888", fontWeight: "bold" }}>→ Day {day}</div>
                          {changes.map((c, i) => (
                            <div key={i} style={{ fontSize: "0.78rem", padding: "0.1rem 0 0.1rem 0.75rem", color: "#aaa" }}>
                              {c.sessionId.slice(0, 8)}...{" "}
                              <span style={{ color: "#666" }}>
                                from Day {c.before?.dayIndex} {c.before && new Date(c.before.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                {" → "}
                                {c.after && new Date(c.after.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Dropped items with reasons */}
                {(() => {
                  const dropped = reflowPreview.changes.filter((c) => c.action === "DROPPED");
                  if (dropped.length === 0) return null;
                  return (
                    <div style={{ marginBottom: "0.5rem" }}>
                      <div style={{ fontSize: "0.8rem", color: "#ff4444", fontWeight: "bold", marginBottom: "0.25rem" }}>Dropped items:</div>
                      {dropped.map((c, i) => {
                        const warning = reflowPreview.warnings.find((w) => w.itemId === c.itemId);
                        return (
                          <div key={i} style={{ fontSize: "0.78rem", padding: "0.1rem 0 0.1rem 0.75rem", color: "#ff8888" }}>
                            {c.sessionId.slice(0, 8)}...
                            {warning && <span style={{ color: "#888" }}> — {warning.message}</span>}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* Full change details */}
                <details>
                  <summary style={{ cursor: "pointer", fontSize: "0.8rem", color: "#aaa" }}>All changes ({reflowPreview.changes.length})</summary>
                  <div style={{ marginTop: "0.25rem", maxHeight: 200, overflowY: "auto" }}>
                    {reflowPreview.changes.map((c, i) => (
                      <div key={i} style={{ fontSize: "0.78rem", padding: "0.15rem 0", borderBottom: "1px solid #222", display: "flex", gap: "0.5rem" }}>
                        <ReflowActionBadge action={c.action} />
                        <span style={{ color: "#aaa" }}>{c.sessionId.slice(0, 8)}</span>
                        {c.action === "MOVED" && c.before && c.after && (
                          <span style={{ color: "#888" }}>
                            Day {c.before.dayIndex} {new Date(c.before.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            {" → "}
                            Day {c.after.dayIndex} {new Date(c.after.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            )}
          </fieldset>

          {/* Day-by-day schedule */}
          {[0, 1, 2, 3, 4, 5, 6].map((dayIdx) => {
            const dayItems = grouped[dayIdx];
            if (!dayItems || dayItems.length === 0) return null;
            return (
              <div key={dayIdx} style={{ border: "1px solid #333", padding: "1rem", marginBottom: "1rem" }}>
                <h2 style={{ color: "#00ff88", fontSize: "1.1rem", marginTop: 0, marginBottom: "0.75rem" }}>
                  {DAY_LABELS[dayIdx]}
                </h2>
                {dayItems.map((item) => {
                  const borderColor = itemBorderColor(item.status);
                  const isUpdating = itemUpdating === item.id;
                  return (
                    <div key={item.id || item.session_id} style={{ background: "#111", padding: "0.75rem", marginBottom: "0.5rem", borderLeft: `3px solid ${borderColor}`, opacity: item.status === "SKIPPED" ? 0.5 : 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.3rem" }}>
                        <div style={{ fontWeight: "bold" }}>
                          {MODE_LABELS[item.mode] || item.mode}
                        </div>
                        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                          <ItemStatusBadge status={item.status} />
                          {item.locked && <span style={{ color: "#ffaa00", fontSize: "0.75rem" }}>[LOCKED]</span>}
                        </div>
                      </div>
                      <div style={{ fontSize: "0.85rem", color: "#aaa" }}>
                        {new Date(item.start_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        {" - "}
                        {new Date(item.end_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        {" "}({item.planned_minutes} min)
                        {item.original_start_at && (
                          <span style={{ color: "#666", marginLeft: "0.5rem" }}>
                            (was {new Date(item.original_start_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: "0.8rem", color: "#888", marginTop: "0.25rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        Topics: {item.topic_scope}
                      </div>
                      <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
                        <a href={item.session_url} target="_blank" rel="noopener noreferrer" style={{ color: "#00ff88", fontSize: "0.85rem" }}>
                          Open session
                        </a>
                        <a href={item.gcal_link} target="_blank" rel="noopener noreferrer" style={{ color: "#4285f4", fontSize: "0.85rem" }}>
                          + Google Cal
                        </a>
                        {(item.status === "SCHEDULED" || item.status === "RESCHEDULED") && (
                          <>
                            <button disabled={isUpdating} onClick={() => handleItemStatus(item.id, "DONE")} style={smallBtnStyle("#00ff88")}>
                              Done
                            </button>
                            <button disabled={isUpdating} onClick={() => handleItemStatus(item.id, "MISSED")} style={smallBtnStyle("#ff4444")}>
                              Missed
                            </button>
                            <button disabled={isUpdating} onClick={() => handleItemStatus(item.id, "SKIPPED")} style={smallBtnStyle("#888")}>
                              Skip
                            </button>
                          </>
                        )}
                        {item.id && (item.status === "SCHEDULED" || item.status === "RESCHEDULED") && (
                          <button disabled={isUpdating} onClick={() => handleToggleLock(item)} style={smallBtnStyle(item.locked ? "#ffaa00" : "#555")}>
                            {item.locked ? "Unlock" : "Lock"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
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

function ItemStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    SCHEDULED: "#4285f4",
    IN_PROGRESS: "#ffaa00",
    DONE: "#00ff88",
    MISSED: "#ff4444",
    SKIPPED: "#888",
    RESCHEDULED: "#aa88ff",
  };
  return (
    <span style={{ color: colors[status] || "#888", fontSize: "0.75rem", fontWeight: "bold" }}>
      [{status}]
    </span>
  );
}

function ReflowActionBadge({ action }: { action: string }) {
  const colors: Record<string, string> = {
    MOVED: "#4285f4",
    DROPPED: "#ff4444",
    KEPT: "#888",
  };
  return (
    <span style={{ color: colors[action] || "#888", fontWeight: "bold", minWidth: 60, display: "inline-block", fontSize: "0.78rem" }}>
      {action}
    </span>
  );
}

function itemBorderColor(status: string): string {
  const colors: Record<string, string> = {
    SCHEDULED: "#00ff88",
    IN_PROGRESS: "#ffaa00",
    DONE: "#00ff88",
    MISSED: "#ff4444",
    SKIPPED: "#555",
    RESCHEDULED: "#aa88ff",
  };
  return colors[status] || "#00ff88";
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

function smallBtnStyle(color: string): React.CSSProperties {
  return {
    background: "transparent",
    color,
    border: `1px solid ${color}`,
    padding: "0.2rem 0.5rem",
    fontFamily: "monospace",
    fontSize: "0.75rem",
    cursor: "pointer",
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
