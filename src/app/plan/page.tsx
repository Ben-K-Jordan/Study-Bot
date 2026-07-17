"use client";

import { useState, useEffect, useCallback } from "react";
import { MODE_LABELS } from "@/lib/client-utils";

interface PlanItem {
  id: string;
  day_index: number;
  start_time: string;
  end_time: string;
  status?: string;
  session_id: string;
  session_url: string;
  mode: string;
  topic_scope: string;
  planned_minutes: number;
  objectives?: { id: string; title: string }[];
}

interface PlanDetail {
  plan_id: string;
  ics_download_url: string;
  feed_url: string;
  webcal_url: string;
  course_name: string;
  exam_name: string;
  exam_date: string; // YYYY-MM-DD
  timezone: string;
  start_date: string;
  end_date: string;
  items: PlanItem[];
}

interface PlanSummary {
  plan_id: string;
  course_name: string;
  exam_name: string;
  exam_date: string;
  created_at: string;
}

// ---- Date helpers (all computed in the plan's timezone) ----

function ymdInTz(date: Date, tz?: string): string {
  const opts: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit" };
  try {
    return new Intl.DateTimeFormat("en-CA", { ...opts, timeZone: tz }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-CA", opts).format(date);
  }
}

function ymdToUtcMs(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Calendar days from today (in the plan tz) until a YYYY-MM-DD date. */
function daysUntil(ymd: string, tz?: string): number {
  return Math.round((ymdToUtcMs(ymd) - ymdToUtcMs(ymdInTz(new Date(), tz))) / 86400000);
}

/** "Wednesday, Jul 16" for an ISO instant, rendered in the plan tz. */
function formatDayLabel(iso: string, tz?: string): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: "long", month: "short", day: "numeric" };
  try {
    return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: tz }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("en-US", opts).format(new Date(iso));
  }
}

/** "Wednesday, Jul 23" for a YYYY-MM-DD calendar date (no tz math needed). */
function formatCalendarDate(ymd: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(ymdToUtcMs(ymd)));
}

function formatTime(iso: string, tz?: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: tz });
  } catch {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
}

/** Short per-session focus line: the item's own objectives, first 2 + "+N more". */
function focusLine(item: PlanItem): string {
  const titles = (item.objectives ?? []).map((o) => o.title).filter(Boolean);
  // Fall back to topic_scope, but never print the full comma-joined list
  const parts =
    titles.length > 0
      ? titles
      : item.topic_scope.split(",").map((s) => s.trim()).filter(Boolean);
  const shown = parts.slice(0, 2).join(", ");
  return parts.length > 2 ? `${shown} +${parts.length - 2} more` : shown;
}

function countdownText(plan: PlanDetail): string {
  const n = daysUntil(plan.exam_date, plan.timezone);
  if (n > 1) return `${n} days until ${plan.exam_name}`;
  if (n === 1) return `1 day until ${plan.exam_name}`;
  if (n === 0) return `${plan.exam_name} is today`;
  return `${plan.exam_name} was ${-n} ${-n === 1 ? "day" : "days"} ago`;
}

export default function PlanPage() {
  const [courseName, setCourseName] = useState("");
  const [examName, setExamName] = useState("");
  const [examDate, setExamDate] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<{ id: string; name: string; status: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [useManualObjectives, setUseManualObjectives] = useState(false);
  const [objectivesText, setObjectivesText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Availability prefilled from saved settings (falls back to localStorage, then defaults)
  const [studyStart, setStudyStart] = useState("09:00");
  const [studyEnd, setStudyEnd] = useState("17:00");
  const [dailyCap, setDailyCap] = useState(180);

  // Persistent plan state — loaded from the API on every visit
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const [googleConnected, setGoogleConnected] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishDone, setPublishDone] = useState(false);
  const [deletingPlan, setDeletingPlan] = useState(false);
  const [reflowLoading, setReflowLoading] = useState(false);
  const [reflowPreview, setReflowPreview] = useState<{ moved: number; kept: number; dropped: number; total_items: number } | null>(null);

  useEffect(() => {
    async function checkGoogle() {
      try {
        const res = await fetch("/api/integrations/google/status", {
        });
        const data = await res.json();
        setGoogleConnected(data.connected ?? data.status === "CONNECTED");
      } catch {
        // Non-critical
      }
    }
    checkGoogle();
  }, []);

  // Prefill availability from saved study hours (backend first, localStorage fallback)
  useEffect(() => {
    async function loadPrefs() {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) throw new Error("fallback");
        const settings = await res.json();
        if (settings.studyStart) setStudyStart(settings.studyStart);
        if (settings.studyEnd) setStudyEnd(settings.studyEnd);
        if (settings.dailyCap) setDailyCap(settings.dailyCap);
      } catch {
        try {
          const raw = localStorage.getItem("study_bot_prefs");
          if (raw) {
            const prefs = JSON.parse(raw);
            if (prefs.studyStart) setStudyStart(prefs.studyStart);
            if (prefs.studyEnd) setStudyEnd(prefs.studyEnd);
            if (prefs.dailyCap) setDailyCap(prefs.dailyCap);
          }
        } catch { /* defaults */ }
      }
    }
    loadPrefs();
  }, []);

  const fetchPlanDetail = useCallback(async (planId: string): Promise<PlanDetail> => {
    const res = await fetch(`/api/plans/${planId}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load plan");
    return data as PlanDetail;
  }, []);

  // Load the user's plans and show the most recent one (or the preferred one)
  const refreshPlans = useCallback(async (preferPlanId?: string) => {
    const res = await fetch("/api/plans", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load plans");
    const list: PlanSummary[] = data.plans ?? [];
    setPlans(list);
    const target = (preferPlanId && list.find((p) => p.plan_id === preferPlanId)) || list[0];
    if (target) {
      const detail = await fetchPlanDetail(target.plan_id);
      setPlan(detail);
      setShowForm(false);
      setReflowPreview(null);
    } else {
      setPlan(null);
      setShowForm(true);
    }
  }, [fetchPlanDetail]);

  useEffect(() => {
    refreshPlans()
      .catch(() => setError("Failed to load your plans"))
      .finally(() => setInitialLoading(false));
  }, [refreshPlans]);

  const switchPlan = async (planId: string) => {
    setError(null);
    try {
      const detail = await fetchPlanDetail(planId);
      setPlan(detail);
      setPublishDone(false);
      setReflowPreview(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load plan");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (!courseName.trim()) {
      setError("Enter a course name before uploading");
      return;
    }

    setUploading(true);
    setError(null);

    for (const file of Array.from(files)) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("namespace", "COURSE");
      formData.append("course_name", courseName);
      if (examName.trim()) formData.append("exam_name", examName);

      try {
        const res = await fetch("/api/content/documents", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (res.ok) {
          const docId = data.document_id;
          setUploadedFiles((prev) => [
            ...prev,
            { id: docId, name: file.name, status: data.status || "PENDING" },
          ]);
          if (data.status !== "PROCESSED") {
            fetch(`/api/content/documents/${docId}/process`, {
              method: "POST",
            })
              .then((r) => r.json())
              .then((d) => {
                setUploadedFiles((prev) =>
                  prev.map((f) => (f.id === docId ? { ...f, status: d.status || "PROCESSED" } : f)),
                );
              })
              .catch(() => {
                setUploadedFiles((prev) =>
                  prev.map((f) => (f.id === docId ? { ...f, status: "FAILED" } : f)),
                );
              });
          }
        } else {
          setError(`Failed to upload ${file.name}: ${data.error}`);
        }
      } catch {
        setError(`Network error uploading ${file.name}`);
      }
    }

    setUploading(false);
    e.target.value = "";
  };

  const handlePublish = async () => {
    if (!plan) return;
    setPublishing(true);
    setError(null);
    try {
      const res = await fetch(`/api/plans/${plan.plan_id}/publish/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to publish");
        return;
      }
      setPublishDone(true);
    } catch {
      setError("Network error");
    } finally {
      setPublishing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const objectives = useManualObjectives
      ? objectivesText.split("\n").map((s) => s.trim()).filter(Boolean)
      : [];
    const document_ids = uploadedFiles.map((f) => f.id);

    if (objectives.length < 3 && document_ids.length === 0) {
      setError("Upload course content or list at least 3 objectives");
      setLoading(false);
      return;
    }

    // Replace (never stack) any existing plan for the same course
    const sameCourse = plans.filter(
      (p) => p.course_name.trim().toLowerCase() === courseName.trim().toLowerCase(),
    );
    if (sameCourse.length > 0) {
      const ok = window.confirm(
        `You already have a plan for ${sameCourse[0].course_name}. Creating a new one will replace it. Continue?`,
      );
      if (!ok) {
        setLoading(false);
        return;
      }
      for (const old of sameCourse) {
        try {
          const delRes = await fetch(`/api/plans/${old.plan_id}`, { method: "DELETE" });
          if (!delRes.ok && delRes.status !== 404) {
            const data = await delRes.json().catch(() => ({}));
            setError(data.error || "Failed to replace the existing plan");
            setLoading(false);
            return;
          }
        } catch {
          setError("Network error");
          setLoading(false);
          return;
        }
      }
    }

    const availability = Array.from({ length: 7 }, () => ({ start: studyStart, end: studyEnd }));

    try {
      const res = await fetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course_name: courseName,
          exam_name: examName,
          exam_date: examDate,
          objectives: objectives.length > 0 ? objectives : undefined,
          document_ids: document_ids.length > 0 ? document_ids : undefined,
          availability,
          daily_study_cap_minutes: dailyCap,
          break_protocol_default: "25_5",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create plan");
        return;
      }
      setPublishDone(false);
      // Reset the form for next time and switch to the persistent plan view
      setCourseName("");
      setExamName("");
      setExamDate("");
      setUploadedFiles([]);
      setObjectivesText("");
      setUseManualObjectives(false);
      await refreshPlans(data.plan_id);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePlan = async () => {
    if (!plan || deletingPlan) return;
    if (!window.confirm("Delete this study plan? This cannot be undone.")) return;
    setDeletingPlan(true);
    setError(null);
    try {
      const res = await fetch(`/api/plans/${plan.plan_id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to delete plan");
        return;
      }
      setPublishDone(false);
      await refreshPlans();
    } catch {
      setError("Network error");
    } finally {
      setDeletingPlan(false);
    }
  };

  // ---- Reflow: reschedule missed sessions (the recovery path a slipping
  // exam week actually needs; ~900 lines of tested logic behind one button)
  const previewReflow = async () => {
    if (!plan || reflowLoading) return;
    setReflowLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/plans/${plan.plan_id}/reflow/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "missed_sessions" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to preview reschedule");
      setReflowPreview(data.summary);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to preview reschedule");
    } finally {
      setReflowLoading(false);
    }
  };

  const applyReflow = async () => {
    if (!plan || reflowLoading) return;
    setReflowLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/plans/${plan.plan_id}/reflow/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "missed_sessions" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to apply reschedule");
      // Refresh the plan so the new times render
      const fresh = await fetchPlanDetail(plan.plan_id);
      setPlan(fresh);
      setReflowPreview(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to apply reschedule");
    } finally {
      setReflowLoading(false);
    }
  };

  // ---- Loading view ----
  if (initialLoading) {
    return (
      <div id="main-content" style={pageStyle}>
        <h1 style={headingStyle}>Your Plan</h1>
        <div style={{ color: "var(--color-text-muted)" }}>Loading your plan...</div>
      </div>
    );
  }

  // ---- Form view ----
  if (showForm || !plan) {
    return (
      <div id="main-content" style={pageStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "0.5rem" }}>
          <h1 style={headingStyle}>New Study Plan</h1>
          {plan && (
            <button type="button" onClick={() => { setShowForm(false); setError(null); }} style={btnStyle}>
              Back to your plan
            </button>
          )}
        </div>
        <form onSubmit={handleSubmit} style={{ maxWidth: 720 }}>
          <div style={formRowStyle}>
            <label style={labelStyle}>
              Course
              <input
                type="text"
                value={courseName}
                onChange={(e) => setCourseName(e.target.value)}
                required
                aria-required="true"
                placeholder="CS 101"
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Exam
              <input
                type="text"
                value={examName}
                onChange={(e) => setExamName(e.target.value)}
                required
                placeholder="Midterm 2"
                style={inputStyle}
              />
            </label>
          </div>
          <div style={formRowStyle}>
            <label style={labelStyle}>
              Exam date
              <input
                type="date"
                value={examDate}
                onChange={(e) => setExamDate(e.target.value)}
                required
                style={inputStyle}
              />
            </label>
          </div>
          <div style={{ ...formRowStyle, marginBottom: "1.5rem" }}>
            <label style={labelStyle}>
              Study from
              <input
                type="time"
                value={studyStart}
                onChange={(e) => setStudyStart(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Until
              <input
                type="time"
                value={studyEnd}
                onChange={(e) => setStudyEnd(e.target.value)}
                style={inputStyle}
              />
            </label>
          </div>

          {/* Content upload */}
          <div style={{ marginBottom: "1.5rem" }}>
            <div style={{ fontSize: "0.95rem", color: "var(--color-text-muted)", marginBottom: "0.5rem" }}>
              Upload your course materials and we&apos;ll build a plan around them.
            </div>
            <button
              type="button"
              style={dropZoneStyle(uploading)}
              onClick={() => !uploading && document.getElementById("file-input")?.click()}
              disabled={uploading}
            >
              <input
                id="file-input"
                type="file"
                multiple
                accept=".pdf,.txt,.md"
                onChange={handleFileUpload}
                aria-label="Upload course materials (PDF, text, or markdown)"
                style={{ display: "none" }}
                tabIndex={-1}
              />
              <span style={{ color: "var(--color-primary)" }}>
                {uploading ? "Uploading..." : "Click to upload files"}
              </span>
              <span style={{ color: "var(--color-text-dim)", fontSize: "0.9rem" }}>PDF, text, or markdown</span>
            </button>

            {uploadedFiles.length > 0 && (
              <div style={{ marginTop: "0.5rem" }}>
                {uploadedFiles.map((file) => (
                  <div key={file.id} style={fileRowStyle}>
                    <span>{file.name}</span>
                    <span role="status" style={{ color: file.status === "PROCESSED" ? "var(--color-success)" : "var(--color-warning)", fontSize: "0.85rem" }}>
                      {file.status}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: "0.75rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.95rem", color: "var(--color-text-dim)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={useManualObjectives}
                  onChange={(e) => setUseManualObjectives(e.target.checked)}
                />
                Or type objectives manually
              </label>
              {useManualObjectives && (
                <textarea
                  value={objectivesText}
                  onChange={(e) => setObjectivesText(e.target.value)}
                  rows={5}
                  style={{ ...inputStyle, width: "100%", resize: "vertical", marginTop: "0.5rem" }}
                  placeholder={"Loops and invariants\nRecursion\nLinked lists\nStacks and queues\nBig-O analysis"}
                />
              )}
            </div>
          </div>

          {error && <div style={errorStyle} role="alert" aria-live="polite">{error}</div>}

          <button type="submit" disabled={loading} style={primaryBtnStyle(loading)}>
            {loading ? "Generating plan..." : "Generate Plan"}
          </button>
        </form>
      </div>
    );
  }

  // ---- Plan view (persistent) ----
  const tz = plan.timezone;
  const todayYmd = ymdInTz(new Date(), tz);
  const grouped = plan.items.reduce<Record<number, PlanItem[]>>((acc, item) => {
    (acc[item.day_index] = acc[item.day_index] || []).push(item);
    return acc;
  }, {});
  const dayIndexes = Object.keys(grouped).map(Number).sort((a, b) => a - b);
  const otherPlans = plans.filter((p) => p.plan_id !== plan.plan_id);

  return (
    <div id="main-content" style={pageStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <div>
          <h1 style={{ ...headingStyle, margin: 0 }}>Your Plan</h1>
          <div style={{ color: "var(--color-text-secondary)", fontSize: "0.95rem", marginTop: "0.35rem" }}>
            {plan.course_name} · {countdownText(plan)}
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {googleConnected && !publishDone && (
            <button onClick={handlePublish} disabled={publishing} style={googleBtnStyle(publishing)}>
              {publishing ? "Publishing..." : "Add to Google Calendar"}
            </button>
          )}
          {publishDone && (
            <span style={{ color: "var(--color-success)", fontSize: "0.95rem", padding: "0.5rem" }}>Added to calendar</span>
          )}
          <a href={plan.ics_download_url} style={btnStyle}>Download .ics</a>
          {!reflowPreview ? (
            <button onClick={previewReflow} disabled={reflowLoading} style={btnStyle}>
              {reflowLoading ? "Checking..." : "Reschedule missed sessions"}
            </button>
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", fontSize: "0.9rem" }}>
              <span style={{ color: "var(--color-text-secondary)" }}>
                {reflowPreview.moved} moved · {reflowPreview.kept} kept · {reflowPreview.dropped} dropped
              </span>
              <button onClick={applyReflow} disabled={reflowLoading} style={btnStyle}>
                {reflowLoading ? "Applying..." : "Apply"}
              </button>
              <button onClick={() => setReflowPreview(null)} disabled={reflowLoading} style={btnStyle}>
                Cancel
              </button>
            </span>
          )}
          <button onClick={() => { setShowForm(true); setError(null); }} style={btnStyle}>
            Create a new plan
          </button>
          <button
            onClick={handleDeletePlan}
            disabled={deletingPlan}
            style={{ ...btnStyle, color: "var(--color-error)", borderColor: "var(--color-error)" }}
          >
            {deletingPlan ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>

      <div style={{ fontSize: "0.95rem", color: "var(--color-text-muted)", marginBottom: "1rem" }}>
        {plan.items.length} sessions for {plan.exam_name}
      </div>

      {error && <div style={errorStyle} role="alert" aria-live="polite">{error}</div>}

      {dayIndexes.map((dayIdx) => {
        const dayItems = grouped[dayIdx];
        const isToday = ymdInTz(new Date(dayItems[0].start_time), tz) === todayYmd;
        return (
          <div key={dayIdx} style={{ marginBottom: "1.25rem" }}>
            <h2 style={dayHeadingStyle}>
              {formatDayLabel(dayItems[0].start_time, tz)}
              {isToday && <span style={{ color: "var(--color-primary)" }}> · Today</span>}
            </h2>
            <div style={cardGridStyle}>
            {dayItems.map((item) => (
              <a
                key={item.id || item.session_id}
                href={item.session_url}
                target="_blank"
                rel="noopener noreferrer"
                style={dayItems.length === 1 ? { ...sessionCardStyle, gridColumn: "1 / -1" } : sessionCardStyle}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.25rem" }}>
                  <span style={{ fontWeight: "bold", color: "var(--color-text)" }}>
                    {MODE_LABELS[item.mode] || item.mode}
                    {item.status === "DONE" && (
                      <span style={{ fontWeight: "normal", fontSize: "0.8rem", color: "var(--color-success)" }}> · done</span>
                    )}
                    {item.status === "MISSED" && (
                      <span style={{ fontWeight: "normal", fontSize: "0.8rem", color: "var(--color-warning)" }}> · missed</span>
                    )}
                  </span>
                  <span style={{ fontSize: "0.9rem", color: "var(--color-text-dim)" }}>
                    {formatTime(item.start_time, tz)}
                    {" - "}
                    {formatTime(item.end_time, tz)}
                  </span>
                </div>
                <div style={{ fontSize: "0.9rem", color: "var(--color-text-muted)", marginTop: "0.2rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {focusLine(item)}
                </div>
              </a>
            ))}
            </div>
          </div>
        );
      })}

      <div style={{ marginBottom: "1.25rem" }}>
        <h2 style={dayHeadingStyle}>{formatCalendarDate(plan.exam_date)}</h2>
        <div style={examRowStyle}>
          {plan.exam_name} — exam day
        </div>
      </div>

      {otherPlans.length > 0 && (
        <div style={{ marginTop: "2rem" }}>
          <h2 style={dayHeadingStyle}>Other plans</h2>
          <div style={cardGridStyle}>
            {otherPlans.map((p) => (
              <button key={p.plan_id} onClick={() => switchPlan(p.plan_id)} style={otherPlanRowStyle}>
                <span>{p.course_name} · {p.exam_name}</span>
                <span style={{ color: "var(--color-text-dim)", fontSize: "0.85rem" }}>{formatCalendarDate(p.exam_date)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Styles ----

const pageStyle: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  minHeight: "100vh",
  padding: "1.5rem clamp(1.5rem, 4vw, 2rem)",
  maxWidth: 1100,
  margin: "0 auto",
};

const headingStyle: React.CSSProperties = {
  color: "var(--color-primary)",
  fontSize: "1.5rem",
  margin: "0 0 1.5rem",
  fontWeight: 700,
  fontFamily: "var(--font-display)",
};

const dayHeadingStyle: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "0.85rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  margin: "0 0 0.5rem",
  fontFamily: "var(--font-display)",
};

// Responsive grid for peer cards (sessions within a day, other plans)
const cardGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  gap: 16,
};

// Two-column form row on desktop, collapses to one column on narrow screens
const formRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: "1rem",
  marginBottom: "1.25rem",
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.3rem",
  fontSize: "0.95rem",
  color: "var(--color-text-secondary)",
};

const inputStyle: React.CSSProperties = {
  background: "var(--color-bg-input)",
  color: "var(--color-text)",
  border: "1px solid var(--color-border)",
  padding: "0.5rem 0.75rem",
  fontFamily: "inherit",
  fontSize: "1rem",
  borderRadius: "var(--radius-sm)",
};

function dropZoneStyle(busy: boolean): React.CSSProperties {
  return {
    background: "transparent",
    fontFamily: "inherit",
    width: "100%",
    border: "2px dashed var(--color-border)",
    borderRadius: "var(--radius)",
    padding: "1.25rem",
    textAlign: "center",
    cursor: busy ? "wait" : "pointer",
    opacity: busy ? 0.6 : 1,
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
  };
}

const fileRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  padding: "0.35rem 0.5rem",
  background: "var(--color-bg-card)",
  border: "1px solid var(--color-border)",
  fontSize: "0.95rem",
  marginBottom: "0.2rem",
  borderRadius: "3px",
};

const errorStyle: React.CSSProperties = {
  color: "var(--color-error)",
  background: "var(--color-bg-error-tint)",
  padding: "0.5rem 0.75rem",
  marginBottom: "1rem",
  border: "1px solid var(--color-error)",
  borderRadius: "var(--radius-sm)",
  fontSize: "0.95rem",
};

function primaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    background: "var(--color-primary)",
    color: "var(--color-bg-darkest)",
    border: "none",
    padding: "0.75rem 1.5rem",
    fontFamily: "inherit",
    fontWeight: "bold",
    fontSize: "1.05rem",
    cursor: disabled ? "wait" : "pointer",
    opacity: disabled ? 0.6 : 1,
    borderRadius: "var(--radius)",
    width: "100%",
  };
}

const btnStyle: React.CSSProperties = {
  background: "var(--color-bg-card)",
  color: "var(--color-text-secondary)",
  border: "1px solid var(--color-border)",
  padding: "0.7rem 1.25rem",
  fontFamily: "inherit",
  fontSize: "0.95rem",
  fontWeight: 600,
  cursor: "pointer",
  textDecoration: "none",
  borderRadius: "var(--radius)",
};

function googleBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    background: "var(--color-info)",
    color: "var(--color-bg-darkest)",
    border: "none",
    padding: "0.7rem 1.25rem",
    fontFamily: "inherit",
    fontWeight: "bold",
    fontSize: "0.95rem",
    cursor: disabled ? "wait" : "pointer",
    opacity: disabled ? 0.6 : 1,
    borderRadius: "var(--radius)",
  };
}

const sessionCardStyle: React.CSSProperties = {
  display: "block",
  background: "var(--color-bg-card)",
  padding: "1.25rem 1.5rem",
  minWidth: 0,
  border: "1px solid var(--color-border-subtle)",
  borderLeft: "3px solid var(--color-primary)",
  textDecoration: "none",
  borderRadius: "var(--radius-sm)",
};

const examRowStyle: React.CSSProperties = {
  background: "var(--color-bg-card)",
  padding: "1.25rem 1.5rem",
  border: "1px solid var(--color-border-subtle)",
  borderLeft: "3px solid var(--color-warning)",
  borderRadius: "var(--radius-sm)",
  fontWeight: 600,
  color: "var(--color-text)",
};

const otherPlanRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "0.5rem",
  width: "100%",
  textAlign: "left",
  background: "var(--color-bg-card)",
  color: "var(--color-text-secondary)",
  padding: "1.25rem 1.5rem",
  minWidth: 0,
  border: "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius-sm)",
  fontFamily: "inherit",
  fontSize: "0.95rem",
  cursor: "pointer",
};
