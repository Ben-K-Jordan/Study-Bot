"use client";

import { useState, useRef, useCallback } from "react";

type Tab = "materials" | "practice" | "research";

function getUserId(): string {
  if (typeof window === "undefined") return "anonymous";
  let uid = localStorage.getItem("study_bot_user_id");
  if (!uid) {
    uid = "user_" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("study_bot_user_id", uid);
  }
  return uid;
}

async function apiFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { ...init?.headers, "X-User-Id": getUserId() },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export default function LibraryPage() {
  const [tab, setTab] = useState<Tab>("materials");

  return (
    <main style={mainStyle}>
      <h1 style={{ fontSize: "1.3rem", margin: "0 0 1rem" }}>Knowledge Library</h1>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
        {(["materials", "practice", "research"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              ...tabBtn,
              borderColor: tab === t ? "#4cc9f0" : "#333",
              color: tab === t ? "#4cc9f0" : "#888",
            }}
          >
            {t === "materials" ? "Course Materials" : t === "practice" ? "Practice Bank" : "Research Library"}
          </button>
        ))}
      </div>

      {tab === "materials" && <MaterialsTab />}
      {tab === "practice" && <PracticeTab />}
      {tab === "research" && <ResearchTab />}
    </main>
  );
}

// ---- Course Materials Tab ----

interface DocItem {
  document_id: string;
  title: string;
  status: string;
  chunk_count: number;
  original_filename: string;
  created_at: string;
}

function MaterialsTab() {
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ chunk_id: string; doc_title: string; page_number: number | null; snippet: string; rank_score: number }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [courseName, setCourseName] = useState("");

  const loadDocs = useCallback(async () => {
    setLoading(true);
    try {
      const url = courseName
        ? `/api/content/documents?namespace=COURSE&course_name=${encodeURIComponent(courseName)}`
        : `/api/content/documents?namespace=COURSE`;
      const data = await apiFetch(url);
      setDocs(data.documents);
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Failed to load");
    }
    setLoading(false);
  }, [courseName]);

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file || !courseName) {
      setMsg("Select a file and enter course name");
      return;
    }
    setLoading(true);
    setMsg("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("namespace", "COURSE");
      form.append("course_name", courseName);

      const res = await fetch("/api/content/documents", {
        method: "POST",
        headers: { "X-User-Id": getUserId() },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");

      setMsg(data.deduped ? "File already uploaded (deduped)" : "Uploaded! Now process it.");
      await loadDocs();
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Upload failed");
    }
    setLoading(false);
  };

  const handleProcess = async (docId: string) => {
    setLoading(true);
    try {
      await apiFetch(`/api/content/documents/${docId}/process`, { method: "POST" });
      setMsg("Processed!");
      await loadDocs();
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Process failed");
    }
    setLoading(false);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    try {
      const data = await apiFetch("/api/content/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: searchQuery, namespace: "COURSE", course_name: courseName || undefined }),
      });
      setSearchResults(data.results);
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Search failed");
    }
    setLoading(false);
  };

  return (
    <div>
      {msg && <div style={msgStyle}>{msg}</div>}

      <div style={{ marginBottom: "1rem" }}>
        <label style={labelStyle}>Course Name</label>
        <input value={courseName} onChange={(e) => setCourseName(e.target.value)} style={inputStyle} placeholder="e.g., CS 2110" />
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", alignItems: "end" }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Upload Document (PDF / Text)</label>
          <input ref={fileRef} type="file" accept=".pdf,.txt,.md" style={inputStyle} />
        </div>
        <button onClick={handleUpload} disabled={loading} style={btnStyle}>Upload</button>
      </div>

      <button onClick={loadDocs} disabled={loading} style={{ ...btnStyle, marginBottom: "1rem" }}>
        {loading ? "Loading..." : "Load Documents"}
      </button>

      {docs.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "1.5rem", fontSize: "0.8rem" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #333" }}>
              <th style={thStyle}>Title</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Chunks</th>
              <th style={thStyle}>Action</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.document_id} style={{ borderBottom: "1px solid #222" }}>
                <td style={tdStyle}>{d.title}</td>
                <td style={tdStyle}>{d.status}</td>
                <td style={tdStyle}>{d.chunk_count}</td>
                <td style={tdStyle}>
                  {d.status === "UPLOADED" && (
                    <button onClick={() => handleProcess(d.document_id)} style={smallBtn}>Process</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ marginBottom: "1rem" }}>
        <label style={labelStyle}>Search Course Materials</label>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ ...inputStyle, flex: 1 }}
            placeholder="Search query..."
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
          <button onClick={handleSearch} disabled={loading} style={btnStyle}>Search</button>
        </div>
      </div>

      {searchResults.length > 0 && (
        <div>
          <p style={labelStyle}>Results ({searchResults.length})</p>
          {searchResults.map((r) => (
            <div key={r.chunk_id} style={cardStyle}>
              <div style={{ fontSize: "0.7rem", color: "#888", marginBottom: "0.3rem" }}>
                {r.doc_title} {r.page_number ? `| p.${r.page_number}` : ""} | score: {r.rank_score.toFixed(3)}
              </div>
              <p style={{ margin: 0, fontSize: "0.8rem" }}>{r.snippet}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Practice Bank Tab ----

function PracticeTab() {
  const [sets, setSets] = useState<{ practice_set_id: string; title: string; course_name: string; question_count: number }[]>([]);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newCourse, setNewCourse] = useState("");
  const [importSetId, setImportSetId] = useState("");
  const [importJson, setImportJson] = useState("");

  const loadSets = async () => {
    setLoading(true);
    try {
      const data = await apiFetch("/api/practice-sets");
      setSets(data.practice_sets);
    } catch (e: unknown) { setMsg(String(e)); }
    setLoading(false);
  };

  const createSet = async () => {
    if (!newTitle || !newCourse) { setMsg("Title and course required"); return; }
    setLoading(true);
    try {
      await apiFetch("/api/practice-sets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle, course_name: newCourse }),
      });
      setMsg("Created!");
      setNewTitle("");
      await loadSets();
    } catch (e: unknown) { setMsg(String(e)); }
    setLoading(false);
  };

  const importQuestions = async () => {
    if (!importSetId || !importJson) return;
    setLoading(true);
    try {
      const questions = JSON.parse(importJson);
      await apiFetch(`/api/practice-sets/${importSetId}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions }),
      });
      setMsg("Imported!");
      await loadSets();
    } catch (e: unknown) { setMsg(String(e)); }
    setLoading(false);
  };

  return (
    <div>
      {msg && <div style={msgStyle}>{msg}</div>}

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <input value={newCourse} onChange={(e) => setNewCourse(e.target.value)} style={inputStyle} placeholder="Course name" />
        <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} style={inputStyle} placeholder="Set title" />
        <button onClick={createSet} disabled={loading} style={btnStyle}>Create Set</button>
      </div>

      <button onClick={loadSets} disabled={loading} style={{ ...btnStyle, marginBottom: "1rem" }}>Load Sets</button>

      {sets.map((s) => (
        <div key={s.practice_set_id} style={cardStyle}>
          <strong>{s.title}</strong> ({s.course_name}) — {s.question_count} questions
        </div>
      ))}

      <div style={{ marginTop: "1rem" }}>
        <label style={labelStyle}>Import Questions (JSON)</label>
        <input value={importSetId} onChange={(e) => setImportSetId(e.target.value)} style={inputStyle} placeholder="Practice Set ID" />
        <textarea value={importJson} onChange={(e) => setImportJson(e.target.value)} style={{ ...inputStyle, height: 80 }} placeholder='[{"kind":"SHORT_ANSWER","prompt_text":"..."}]' />
        <button onClick={importQuestions} disabled={loading} style={btnStyle}>Import</button>
      </div>
    </div>
  );
}

// ---- Research Library Tab ----

function ResearchTab() {
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [paperTitle, setPaperTitle] = useState("");
  const [docId, setDocId] = useState("");
  const [cards, setCards] = useState<{ card_id: string; paper_title: string; claim: string; strength: string }[]>([]);

  const uploadResearchDoc = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) { setMsg("Select a file"); return; }
    setLoading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("namespace", "RESEARCH");
      const res = await fetch("/api/content/documents", {
        method: "POST",
        headers: { "X-User-Id": getUserId() },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDocId(data.document_id);
      // Auto-process
      await apiFetch(`/api/content/documents/${data.document_id}/process`, { method: "POST" });
      setMsg(`Uploaded & processed: ${data.document_id}`);
    } catch (e: unknown) { setMsg(String(e)); }
    setLoading(false);
  };

  const createPaper = async () => {
    if (!paperTitle || !docId) { setMsg("Title and document ID required"); return; }
    setLoading(true);
    try {
      const data = await apiFetch("/api/evidence/papers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: paperTitle, document_id: docId }),
      });
      setMsg(`Paper created: ${data.paper_id}`);
    } catch (e: unknown) { setMsg(String(e)); }
    setLoading(false);
  };

  const loadCards = async () => {
    setLoading(true);
    try {
      const data = await apiFetch("/api/evidence/cards");
      setCards(data.cards);
    } catch (e: unknown) { setMsg(String(e)); }
    setLoading(false);
  };

  return (
    <div>
      {msg && <div style={msgStyle}>{msg}</div>}

      <div style={{ marginBottom: "1rem" }}>
        <label style={labelStyle}>Upload Research Paper (PDF)</label>
        <input ref={fileRef} type="file" accept=".pdf,.txt" style={inputStyle} />
        <button onClick={uploadResearchDoc} disabled={loading} style={btnStyle}>Upload & Process</button>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <input value={docId} onChange={(e) => setDocId(e.target.value)} style={inputStyle} placeholder="Document ID" />
        <input value={paperTitle} onChange={(e) => setPaperTitle(e.target.value)} style={inputStyle} placeholder="Paper title" />
        <button onClick={createPaper} disabled={loading} style={btnStyle}>Create Paper</button>
      </div>

      <button onClick={loadCards} disabled={loading} style={{ ...btnStyle, marginBottom: "1rem" }}>Load Evidence Cards</button>

      {cards.map((c) => (
        <div key={c.card_id} style={cardStyle}>
          <div style={{ fontSize: "0.7rem", color: "#888" }}>{c.paper_title} | {c.strength}</div>
          <p style={{ margin: "0.3rem 0 0", fontSize: "0.85rem" }}>{c.claim}</p>
        </div>
      ))}
    </div>
  );
}

// ---- Shared Styles ----

const mainStyle: React.CSSProperties = {
  maxWidth: 800,
  margin: "0 auto",
  padding: "1.5rem 1rem",
  fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
  color: "#e0e0e0",
  backgroundColor: "#1a1a2e",
  minHeight: "100vh",
};

const tabBtn: React.CSSProperties = {
  padding: "0.5rem 1rem",
  fontSize: "0.8rem",
  fontFamily: "inherit",
  background: "transparent",
  color: "#888",
  border: "1px solid #333",
  borderRadius: 4,
  cursor: "pointer",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.7rem",
  color: "#aaa",
  marginBottom: "0.25rem",
};

const inputStyle: React.CSSProperties = {
  padding: "0.5rem",
  fontSize: "0.8rem",
  fontFamily: "inherit",
  background: "#16213e",
  color: "#e0e0e0",
  border: "1px solid #333",
  borderRadius: 4,
  width: "100%",
  boxSizing: "border-box",
  marginBottom: "0.5rem",
};

const btnStyle: React.CSSProperties = {
  padding: "0.5rem 1rem",
  fontSize: "0.8rem",
  fontFamily: "inherit",
  fontWeight: 600,
  background: "#4cc9f0",
  color: "#1a1a2e",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const smallBtn: React.CSSProperties = {
  ...btnStyle,
  padding: "0.3rem 0.6rem",
  fontSize: "0.7rem",
};

const msgStyle: React.CSSProperties = {
  background: "#333",
  padding: "0.5rem",
  borderRadius: 4,
  marginBottom: "0.75rem",
  fontSize: "0.8rem",
};

const cardStyle: React.CSSProperties = {
  background: "#16213e",
  border: "1px solid #333",
  borderRadius: 4,
  padding: "0.75rem",
  marginBottom: "0.5rem",
  fontSize: "0.85rem",
};

const thStyle: React.CSSProperties = { textAlign: "left", padding: "0.4rem", color: "#aaa" };
const tdStyle: React.CSSProperties = { padding: "0.4rem" };
