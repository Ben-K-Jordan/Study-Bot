"use client";

import { useState, useEffect } from "react";
import { getOrCreateUserId } from "@/lib/client-utils";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

interface Availability {
  start: string;
  end: string;
  enabled: boolean;
}

const DEFAULTS: { availability: Availability[]; dailyCap: number } = {
  availability: DAY_NAMES.map((_, i) => ({
    start: "09:00",
    end: "17:00",
    enabled: true, // All days on by default
  })),
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
  const [availability, setAvailability] = useState<Availability[]>(DEFAULTS.availability);
  const [dailyCap, setDailyCap] = useState(DEFAULTS.dailyCap);
  const [saved, setSaved] = useState(false);

  // Google Calendar
  const [googleStatus, setGoogleStatus] = useState<"loading" | "connected" | "disconnected">("loading");

  useEffect(() => {
    const prefs = loadPrefs();
    setAvailability(prefs.availability);
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
    savePrefs({ availability, dailyCap });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const updateDay = (i: number, field: keyof Availability, value: string | boolean) => {
    setAvailability((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: value };
      return next;
    });
  };

  const handleGoogleConnect = () => {
    window.location.href = `/api/integrations/google/connect?user_id=${getOrCreateUserId()}`;
  };

  return (
    <div style={pageStyle}>
      <h1 style={headingStyle}>Settings</h1>

      {/* Study Time Preferences */}
      <section style={{ marginBottom: "2rem" }}>
        <h2 style={sectionStyle}>Study availability</h2>
        <p style={hintStyle}>When are you free to study each day?</p>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {availability.map((day, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.75rem", opacity: day.enabled ? 1 : 0.4 }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", width: 130, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={day.enabled}
                  onChange={(e) => updateDay(i, "enabled", e.target.checked)}
                />
                <span style={{ fontSize: "0.85rem" }}>{DAY_NAMES[i]}</span>
              </label>
              <input
                type="time"
                value={day.start}
                onChange={(e) => updateDay(i, "start", e.target.value)}
                disabled={!day.enabled}
                style={timeInputStyle}
              />
              <span style={{ color: "#555" }}>to</span>
              <input
                type="time"
                value={day.end}
                onChange={(e) => updateDay(i, "end", e.target.value)}
                disabled={!day.enabled}
                style={timeInputStyle}
              />
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={sectionStyle}>Daily study cap</h2>
        <p style={hintStyle}>Maximum minutes of study per day.</p>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <input
            type="range"
            min={30}
            max={480}
            step={15}
            value={dailyCap}
            onChange={(e) => setDailyCap(Number(e.target.value))}
            style={{ flex: 1, accentColor: "#00ff88" }}
          />
          <span style={{ color: "#00ff88", fontWeight: "bold", minWidth: "4rem", textAlign: "right" }}>
            {Math.floor(dailyCap / 60)}h {dailyCap % 60 > 0 ? `${dailyCap % 60}m` : ""}
          </span>
        </div>
      </section>

      {/* Google Calendar */}
      <section style={{ marginBottom: "2rem" }}>
        <h2 style={sectionStyle}>Google Calendar</h2>
        {googleStatus === "loading" ? (
          <p style={hintStyle}>Checking connection...</p>
        ) : googleStatus === "connected" ? (
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span style={{ color: "#00ff88", fontSize: "0.85rem" }}>Connected</span>
            <span style={{ color: "#555", fontSize: "0.8rem" }}>Plans can be published to your calendar.</span>
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

      {/* Save */}
      <button onClick={handleSave} style={saveBtnStyle}>
        {saved ? "Saved" : "Save Preferences"}
      </button>
    </div>
  );
}

// ---- Styles ----

const pageStyle: React.CSSProperties = {
  fontFamily: "'SF Mono', 'Fira Code', monospace",
  background: "#0a0a0a",
  color: "#e0e0e0",
  minHeight: "100vh",
  padding: "2rem",
  maxWidth: 600,
  margin: "0 auto",
};

const headingStyle: React.CSSProperties = {
  color: "#00ff88",
  fontSize: "1.4rem",
  margin: "0 0 1.5rem",
  fontWeight: 700,
};

const sectionStyle: React.CSSProperties = {
  color: "#e0e0e0",
  fontSize: "1rem",
  margin: "0 0 0.25rem",
  fontWeight: 600,
};

const hintStyle: React.CSSProperties = {
  color: "#666",
  fontSize: "0.8rem",
  margin: "0 0 0.75rem",
};

const timeInputStyle: React.CSSProperties = {
  background: "#111",
  color: "#e0e0e0",
  border: "1px solid #333",
  padding: "0.35rem 0.5rem",
  fontFamily: "inherit",
  fontSize: "0.85rem",
  borderRadius: "4px",
};

const saveBtnStyle: React.CSSProperties = {
  background: "#00ff88",
  color: "#000",
  border: "none",
  padding: "0.6rem 1.5rem",
  fontFamily: "inherit",
  fontWeight: "bold",
  fontSize: "0.95rem",
  cursor: "pointer",
  borderRadius: "4px",
};

const connectBtnStyle: React.CSSProperties = {
  background: "#4285f4",
  color: "#fff",
  border: "none",
  padding: "0.5rem 1rem",
  fontFamily: "inherit",
  fontWeight: "bold",
  fontSize: "0.85rem",
  cursor: "pointer",
  borderRadius: "4px",
};
