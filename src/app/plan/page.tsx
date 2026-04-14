"use client";

import { useState, useEffect } from "react";
import { MODE_LABELS, getOrCreateUserId } from "@/lib/client-utils";

const DAY_LABELS = ["Day 0 (Today)", "Day 1", "Day 2", "Day 3", "Day 4", "Day 5", "Day 6"];

interface PlanItem {
  id: string;
  day_index: number;
  start_time: string;
  end_time: string;
  session_id: string;
  session_url: string;
  mode: string;
  topic_scope: string;
  planned_minutes: number;
}

interface PlanResult {
  plan_id: string;
  ics_download_url: string;
  feed_url: string;
  webcal_url: string;
  items: PlanItem[];
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
  const [result, setResult] = useState<PlanResult | null>(null);

  const [googleConnected, setGoogleConnected] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishDone, setPublishDone] = useState(false);
  const [deletingPlan, setDeletingPlan] = useState(false);

  useEffect(() => {
    async function checkGoogle() {
      try {
        const res = await fetch("/api/integrations/google/status", {
          headers: { "X-User-Id": getOrCreateUserId() },
        });
        const data = await res.json();
        setGoogleConnected(data.connected ?? data.status === "CONNECTED");
      } catch {
        // Non-critical
      }
    }
    checkGoogle();
  }, []);

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
          headers: { "X-User-Id": getOrCreateUserId() },
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
              headers: { "X-User-Id": getOrCreateUserId() },
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
    if (!result) return;
    setPublishing(true);
    setError(null);
    try {
      const res = await fetch(`/api/plans/${result.plan_id}/publish/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-User-Id": getOrCreateUserId() },
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

    // Read saved preferences — try backend first, fall back to localStorage
    let studyStart = "09:00";
    let studyEnd = "17:00";
    let dailyCap = 180;
    try {
      const settingsRes = await fetch("/api/settings", {
        headers: { "X-User-Id": getOrCreateUserId() },
      });
      if (settingsRes.ok) {
        const settings = await settingsRes.json();
        if (settings.studyStart) studyStart = settings.studyStart;
        if (settings.studyEnd) studyEnd = settings.studyEnd;
        if (settings.dailyCap) dailyCap = settings.dailyCap;
      } else {
        throw new Error("fallback");
      }
    } catch {
      // Fall back to localStorage
      try {
        const raw = localStorage.getItem("study_bot_prefs");
        if (raw) {
          const prefs = JSON.parse(raw);
          if (prefs.studyStart) studyStart = prefs.studyStart;
          if (prefs.studyEnd) studyEnd = prefs.studyEnd;
          if (prefs.dailyCap) dailyCap = prefs.dailyCap;
        }
      } catch { /* defaults */ }
    }
    const availability = Array.from({ length: 7 }, () => ({ start: studyStart, end: studyEnd }));

    try {
      const res = await fetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-User-Id": getOrCreateUserId() },
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
      setResult(data);
      setPublishDone(false);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePlan = async () => {
    if (!result || deletingPlan) return;
    setDeletingPlan(true);
    setError(null);
    try {
      const res = await fetch(`/api/plans/${result.plan_id}`, {
        method: "DELETE",
        headers: { "X-User-Id": getOrCreateUserId() },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to delete plan");
        return;
      }
      setResult(null);
      setPublishDone(false);
    } catch {
      setError("Network error");
    } finally {
      setDeletingPlan(false);
    }
  };

  const grouped = result
    ? result.items.reduce<Record<number, PlanItem[]>>((acc, item) => {
        (acc[item.day_index] = acc[item.day_index] || []).push(item);
        return acc;
      }, {})
    : {};

  // ---- Form view ----
  if (!result) {
    return (
      <div style={pageStyle}>
        <h1 style={headingStyle}>New Study Plan</h1>
        <form onSubmit={handleSubmit} style={{ maxWidth: 500 }}>
          <div style={{ marginBottom: "1.25rem" }}>
            <label style={labelStyle}>
              Course
              <input
                type="text"
                value={courseName}
                onChange={(e) => setCourseName(e.target.value)}
                required
                placeholder="CS 101"
                style={inputStyle}
              />
            </label>
          </div>
          <div style={{ marginBottom: "1.25rem" }}>
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
          <div style={{ marginBottom: "1.5rem" }}>
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

          {/* Content upload */}
          <div style={{ marginBottom: "1.5rem" }}>
            <div style={{ fontSize: "0.95rem", color: "#a89a82", marginBottom: "0.5rem" }}>
              Upload your course materials and we&apos;ll build a plan around them.
            </div>
            <div
              style={dropZoneStyle(uploading)}
              onClick={() => !uploading && document.getElementById("file-input")?.click()}
            >
              <input
                id="file-input"
                type="file"
                multiple
                accept=".pdf,.txt,.md"
                onChange={handleFileUpload}
                style={{ display: "none" }}
              />
              <span style={{ color: "#f0dc4e" }}>
                {uploading ? "Uploading..." : "Click to upload files"}
              </span>
              <span style={{ color: "#7a7060", fontSize: "0.9rem" }}>PDF, text, or markdown</span>
            </div>

            {uploadedFiles.length > 0 && (
              <div style={{ marginTop: "0.5rem" }}>
                {uploadedFiles.map((file) => (
                  <div key={file.id} style={fileRowStyle}>
                    <span>{file.name}</span>
                    <span style={{ color: file.status === "PROCESSED" ? "#88cc88" : "#e8a040", fontSize: "0.85rem" }}>
                      {file.status}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: "0.75rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.95rem", color: "#7a7060", cursor: "pointer" }}>
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

          {error && <div style={errorStyle}>{error}</div>}

          <button type="submit" disabled={loading} style={primaryBtnStyle(loading)}>
            {loading ? "Generating plan..." : "Generate Plan"}
          </button>
        </form>
      </div>
    );
  }

  // ---- Result view ----
  return (
    <div style={pageStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <h1 style={headingStyle}>Your Plan</h1>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {googleConnected && !publishDone && (
            <button onClick={handlePublish} disabled={publishing} style={googleBtnStyle(publishing)}>
              {publishing ? "Publishing..." : "Add to Google Calendar"}
            </button>
          )}
          {publishDone && (
            <span style={{ color: "#88cc88", fontSize: "0.95rem", padding: "0.5rem" }}>Added to calendar</span>
          )}
          <a href={result.ics_download_url} style={btnStyle}>Download .ics</a>
          <button onClick={() => { setResult(null); setPublishDone(false); }} style={btnStyle}>
            New Plan
          </button>
          <button
            onClick={handleDeletePlan}
            disabled={deletingPlan}
            style={{ ...btnStyle, color: "#e88888", borderColor: "#e8888844" }}
          >
            {deletingPlan ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>

      <div style={{ fontSize: "0.95rem", color: "#a89a82", marginBottom: "1rem" }}>
        {result.items.length} sessions across 7 days
      </div>

      {error && <div style={errorStyle}>{error}</div>}

      {[0, 1, 2, 3, 4, 5, 6].map((dayIdx) => {
        const dayItems = grouped[dayIdx];
        if (!dayItems || dayItems.length === 0) return null;
        return (
          <div key={dayIdx} style={{ marginBottom: "1.25rem" }}>
            <h2 style={{ color: "#f0dc4e", fontSize: "1.3rem", margin: "0 0 0.5rem", fontFamily: "var(--font-display)" }}>
              {DAY_LABELS[dayIdx]}
            </h2>
            {dayItems.map((item) => (
              <a
                key={item.id || item.session_id}
                href={item.session_url}
                target="_blank"
                rel="noopener noreferrer"
                style={sessionCardStyle}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: "bold", color: "#e8dcc8" }}>
                    {MODE_LABELS[item.mode] || item.mode}
                  </span>
                  <span style={{ fontSize: "0.9rem", color: "#7a7060" }}>
                    {new Date(item.start_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    {" - "}
                    {new Date(item.end_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <div style={{ fontSize: "0.9rem", color: "#a89a82", marginTop: "0.2rem" }}>
                  {item.topic_scope}
                </div>
              </a>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ---- Styles ----

const pageStyle: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  background: "#2a3d2a",
  color: "#e8dcc8",
  minHeight: "100vh",
  padding: "2rem",
  maxWidth: 700,
  margin: "0 auto",
};

const headingStyle: React.CSSProperties = {
  color: "#f0dc4e",
  fontSize: "2rem",
  margin: "0 0 1.5rem",
  fontWeight: 700,
  fontFamily: "var(--font-display)",
};

const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.3rem",
  fontSize: "0.95rem",
  color: "#c8bca8",
};

const inputStyle: React.CSSProperties = {
  background: "#2d422d",
  color: "#e8dcc8",
  border: "1px solid #4a6a4a",
  padding: "0.5rem 0.75rem",
  fontFamily: "inherit",
  fontSize: "1rem",
  borderRadius: "4px",
};

function dropZoneStyle(busy: boolean): React.CSSProperties {
  return {
    border: "2px dashed #4a6a4a",
    borderRadius: "6px",
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
  background: "#334d33",
  border: "1px solid #4a6a4a",
  fontSize: "0.95rem",
  marginBottom: "0.2rem",
  borderRadius: "3px",
};

const errorStyle: React.CSSProperties = {
  color: "#e88888",
  padding: "0.5rem",
  marginBottom: "1rem",
  border: "1px solid #e88888",
  borderRadius: "4px",
  fontSize: "0.95rem",
};

function primaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    background: "#f0dc4e",
    color: "#1f2e1f",
    border: "none",
    padding: "0.75rem 1.5rem",
    fontFamily: "inherit",
    fontWeight: "bold",
    fontSize: "1.05rem",
    cursor: disabled ? "wait" : "pointer",
    opacity: disabled ? 0.6 : 1,
    borderRadius: 6,
    width: "100%",
  };
}

const btnStyle: React.CSSProperties = {
  background: "#334d33",
  color: "#c8bca8",
  border: "1px solid #4a6a4a",
  padding: "0.4rem 0.75rem",
  fontFamily: "inherit",
  fontSize: "0.85rem",
  cursor: "pointer",
  textDecoration: "none",
  borderRadius: 6,
};

function googleBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    background: "#7ec8e3",
    color: "#1f2e1f",
    border: "none",
    padding: "0.4rem 0.75rem",
    fontFamily: "inherit",
    fontWeight: "bold",
    fontSize: "0.85rem",
    cursor: disabled ? "wait" : "pointer",
    opacity: disabled ? 0.6 : 1,
    borderRadius: 6,
  };
}

const sessionCardStyle: React.CSSProperties = {
  display: "block",
  background: "#334d33",
  padding: "0.65rem 0.75rem",
  marginBottom: "0.4rem",
  borderLeft: "3px solid #f0dc4e",
  textDecoration: "none",
  borderRadius: 4,
};
