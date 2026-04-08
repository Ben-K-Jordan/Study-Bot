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
  ai_generated?: boolean;
  reasoning?: string | null;
  ics_download_url: string;
  feed_url: string;
  webcal_url: string;
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
  const [uploadedFiles, setUploadedFiles] = useState<{ id: string; name: string; status: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [useManualObjectives, setUseManualObjectives] = useState(false);
  const [availability, setAvailability] = useState(defaultAvailability);
  const [dailyCap, setDailyCap] = useState(180);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PlanResult | null>(null);

  // Google Calendar
  const [googleConnected, setGoogleConnected] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishDone, setPublishDone] = useState(false);

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

  const updateAvailability = (index: number, field: "start" | "end", value: string) => {
    setAvailability((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (!courseName.trim()) {
      setError("Please enter a course name before uploading files");
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

          // Trigger processing (chunking + embedding) unless already processed (deduped)
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
    // Reset the input so the same file can be re-selected
    e.target.value = "";
  };

  const removeUploadedFile = (docId: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f.id !== docId));
  };

  const handlePublish = async () => {
    if (!result) return;
    setPublishing(true);
    setError(null);
    try {
      const res = await fetch(`/api/plans/${result.plan_id}/publish/google`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": getOrCreateUserId(),
        },
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
      setError("Upload course content or switch to manual objectives (minimum 3)");
      setLoading(false);
      return;
    }

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
            <legend style={{ color: "#00ff88" }}>Course Content</legend>
            <p style={{ fontSize: "0.8rem", color: "#888", marginTop: 0 }}>
              Upload slides, practice questions, or notes. The AI will analyze your content and decide what to cover each day.
            </p>

            {/* File upload area */}
            <div
              style={{
                border: "2px dashed #333",
                padding: "1.5rem",
                textAlign: "center",
                marginBottom: "0.75rem",
                cursor: uploading ? "wait" : "pointer",
                opacity: uploading ? 0.6 : 1,
              }}
              onClick={() => !uploading && document.getElementById("file-upload-input")?.click()}
            >
              <input
                id="file-upload-input"
                type="file"
                multiple
                accept=".pdf,.txt,.md"
                onChange={handleFileUpload}
                style={{ display: "none" }}
              />
              <div style={{ color: "#00ff88", fontSize: "1.1rem", marginBottom: "0.3rem" }}>
                {uploading ? "Uploading..." : "Click to upload files"}
              </div>
              <div style={{ color: "#666", fontSize: "0.8rem" }}>
                PDF, text, or markdown files
              </div>
            </div>

            {/* Uploaded files list */}
            {uploadedFiles.length > 0 && (
              <div style={{ marginBottom: "0.75rem" }}>
                {uploadedFiles.map((file) => (
                  <div
                    key={file.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "0.4rem 0.6rem",
                      background: "#111",
                      border: "1px solid #333",
                      marginBottom: "0.25rem",
                      fontSize: "0.85rem",
                    }}
                  >
                    <span style={{ color: "#e0e0e0" }}>{file.name}</span>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <span style={{ color: file.status === "PROCESSED" ? "#00ff88" : "#ffaa00", fontSize: "0.75rem" }}>
                        {file.status}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeUploadedFile(file.id)}
                        style={{ background: "none", border: "none", color: "#ff4444", cursor: "pointer", fontFamily: "monospace", fontSize: "0.85rem" }}
                      >
                        x
                      </button>
                    </div>
                  </div>
                ))}
                <div style={{ fontSize: "0.78rem", color: "#888", marginTop: "0.3rem" }}>
                  {uploadedFiles.length} file{uploadedFiles.length !== 1 ? "s" : ""} uploaded — AI will extract objectives automatically
                </div>
              </div>
            )}

            {/* Manual objectives toggle */}
            <div style={{ borderTop: "1px solid #222", paddingTop: "0.75rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", color: "#888", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={useManualObjectives}
                  onChange={(e) => setUseManualObjectives(e.target.checked)}
                />
                Set objectives manually instead
              </label>
              {useManualObjectives && (
                <div style={{ marginTop: "0.5rem" }}>
                  <p style={{ fontSize: "0.8rem", color: "#888", marginTop: 0 }}>One per line (minimum 3)</p>
                  <textarea
                    value={objectivesText}
                    onChange={(e) => setObjectivesText(e.target.value)}
                    rows={6}
                    style={{ ...inputStyle, width: "100%", resize: "vertical" }}
                    placeholder={"Loops and invariants\nRecursion\nLinked lists\nStacks and queues\nBig-O analysis"}
                  />
                </div>
              )}
            </div>
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
            <div style={{ fontSize: "0.8rem", color: "#888" }}>
              25-minute study blocks with 5-minute breaks (Pomodoro)
            </div>
          </fieldset>

          {error && <ErrorBanner message={error} />}

          <button type="submit" disabled={loading} style={primaryBtnStyle(loading)}>
            {loading ? "Generating..." : "Generate Week Plan"}
          </button>
        </form>
      ) : (
        <div>
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "0.5rem" }}>
            <div style={{ fontSize: "0.85rem", color: "#888" }}>
              {result.items.length} sessions across 7 days
            </div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {googleConnected && !publishDone && (
                <button onClick={handlePublish} disabled={publishing} style={googleBtnStyle(publishing)}>
                  {publishing ? "Publishing..." : "Add to Google Calendar"}
                </button>
              )}
              {publishDone && (
                <span style={{ color: "#00ff88", fontSize: "0.85rem", padding: "0.5rem" }}>Added to calendar</span>
              )}
              <a href={result.ics_download_url} style={secondaryBtnStyle}>Download .ics</a>
              <button onClick={() => { setResult(null); setPublishDone(false); }} style={secondaryBtnStyle}>
                New Plan
              </button>
            </div>
          </div>

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
                {dayItems.map((item) => (
                  <div key={item.id || item.session_id} style={{ background: "#111", padding: "0.75rem", marginBottom: "0.5rem", borderLeft: "3px solid #00ff88" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.3rem" }}>
                      <div style={{ fontWeight: "bold" }}>
                        {MODE_LABELS[item.mode] || item.mode}
                      </div>
                      <span style={{ fontSize: "0.85rem", color: "#888" }}>
                        {new Date(item.start_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        {" - "}
                        {new Date(item.end_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        {" "}({item.planned_minutes} min)
                      </span>
                    </div>
                    <div style={{ fontSize: "0.8rem", color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.topic_scope}
                    </div>
                    <div style={{ marginTop: "0.4rem" }}>
                      <a href={item.session_url} target="_blank" rel="noopener noreferrer" style={{ color: "#00ff88", fontSize: "0.85rem" }}>
                        Open session
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

// ---- Styles ----

const inputStyle: React.CSSProperties = {
  background: "#111",
  color: "#e0e0e0",
  border: "1px solid #333",
  padding: "0.4rem 0.6rem",
  fontFamily: "monospace",
  fontSize: "0.9rem",
};

const secondaryBtnStyle: React.CSSProperties = {
  background: "#333",
  color: "#e0e0e0",
  border: "1px solid #555",
  padding: "0.5rem 1rem",
  fontFamily: "monospace",
  cursor: "pointer",
  textDecoration: "none",
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
