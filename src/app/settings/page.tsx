"use client";

import { useState, useEffect } from "react";
import { getOrCreateUserId } from "@/lib/client-utils";

const DEFAULTS = {
  studyStart: "09:00",
  studyEnd: "17:00",
  dailyCap: 180,
};

function loadPrefs(): typeof DEFAULTS {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem("study_bot_prefs");
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

function savePrefs(prefs: typeof DEFAULTS) {
  localStorage.setItem("study_bot_prefs", JSON.stringify(prefs));
}

export default function SettingsPage() {
  const [studyStart, setStudyStart] = useState(DEFAULTS.studyStart);
  const [studyEnd, setStudyEnd] = useState(DEFAULTS.studyEnd);
  const [dailyCap, setDailyCap] = useState(DEFAULTS.dailyCap);
  const [saved, setSaved] = useState(false);

  const [googleStatus, setGoogleStatus] = useState<"loading" | "connected" | "disconnected">("loading");

  useEffect(() => {
    const prefs = loadPrefs();
    setStudyStart(prefs.studyStart);
    setStudyEnd(prefs.studyEnd);
    setDailyCap(prefs.dailyCap);
  }, []);

  useEffect(() => {
    async function checkGoogle() {
      try {
        const res = await fetch("/api/integrations/google/status", {
          headers: { "X-User-Id": getOrCreateUserId() },
        });
        const data = await res.json();
        setGoogleStatus(data.connected || data.status === "CONNECTED" ? "connected" : "disconnected");
      } catch {
        setGoogleStatus("disconnected");
      }
    }
    checkGoogle();
  }, []);

  const handleSave = () => {
    savePrefs({ studyStart, studyEnd, dailyCap });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleGoogleConnect = () => {
    window.location.href = `/api/integrations/google/connect?user_id=${getOrCreateUserId()}`;
  };

  return (
    <div style={pageStyle}>
      <h1 style={headingStyle}>Settings</h1>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={sectionStyle}>Study hours</h2>
        <p style={hintStyle}>Sessions will be scheduled between these times.</p>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <input type="time" value={studyStart} onChange={(e) => setStudyStart(e.target.value)} style={timeInputStyle} />
          <span style={{ color: "#a89a82" }}>to</span>
          <input type="time" value={studyEnd} onChange={(e) => setStudyEnd(e.target.value)} style={timeInputStyle} />
        </div>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={sectionStyle}>Daily study cap</h2>
        <p style={hintStyle}>Maximum study time per day.</p>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <input
            type="range"
            min={30}
            max={480}
            step={15}
            value={dailyCap}
            onChange={(e) => setDailyCap(Number(e.target.value))}
            style={{ flex: 1, accentColor: "#f0dc4e" }}
          />
          <span style={{ color: "#f0dc4e", fontWeight: "bold", minWidth: "4rem", textAlign: "right" }}>
            {Math.floor(dailyCap / 60)}h{dailyCap % 60 > 0 ? ` ${dailyCap % 60}m` : ""}
          </span>
        </div>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={sectionStyle}>Google Calendar</h2>
        {googleStatus === "loading" ? (
          <p style={hintStyle}>Checking connection...</p>
        ) : googleStatus === "connected" ? (
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span style={{ color: "#88cc88", fontSize: "0.95rem" }}>Connected</span>
            <span style={{ color: "#7a7060", fontSize: "0.9rem" }}>Plans can be published to your calendar.</span>
          </div>
        ) : (
          <div>
            <p style={hintStyle}>Connect to publish study sessions to your calendar and auto-detect busy times.</p>
            <button onClick={handleGoogleConnect} style={connectBtnStyle}>
              Connect Google Calendar
            </button>
          </div>
        )}
      </section>

      <button onClick={handleSave} style={saveBtnStyle}>
        {saved ? "Saved" : "Save Preferences"}
      </button>
    </div>
  );
}

// ---- Styles ----

const pageStyle: React.CSSProperties = {
  fontFamily: "var(--font-body), 'Patrick Hand', cursive",
  background: "#2a3d2a",
  color: "#e8dcc8",
  minHeight: "100vh",
  padding: "2rem",
  maxWidth: 600,
  margin: "0 auto",
};

const headingStyle: React.CSSProperties = {
  color: "#f0dc4e",
  fontSize: "2rem",
  margin: "0 0 1.5rem",
  fontWeight: 700,
  fontFamily: "var(--font-display), 'Caveat', cursive",
};

const sectionStyle: React.CSSProperties = {
  color: "#e8dcc8",
  fontSize: "1.2rem",
  margin: "0 0 0.25rem",
  fontWeight: 600,
  fontFamily: "var(--font-display), 'Caveat', cursive",
};

const hintStyle: React.CSSProperties = {
  color: "#7a7060",
  fontSize: "0.9rem",
  margin: "0 0 0.75rem",
};

const timeInputStyle: React.CSSProperties = {
  background: "#2d422d",
  color: "#e8dcc8",
  border: "1px solid #4a6a4a",
  padding: "0.35rem 0.5rem",
  fontFamily: "inherit",
  fontSize: "0.95rem",
  borderRadius: "4px",
};

const saveBtnStyle: React.CSSProperties = {
  background: "#f0dc4e",
  color: "#1f2e1f",
  border: "none",
  padding: "0.6rem 1.5rem",
  fontFamily: "inherit",
  fontWeight: "bold",
  fontSize: "1.05rem",
  cursor: "pointer",
  borderRadius: "4px",
};

const connectBtnStyle: React.CSSProperties = {
  background: "#7ec8e3",
  color: "#1f2e1f",
  border: "none",
  padding: "0.5rem 1rem",
  fontFamily: "inherit",
  fontWeight: "bold",
  fontSize: "0.95rem",
  cursor: "pointer",
  borderRadius: "4px",
};
