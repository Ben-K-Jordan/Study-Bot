"use client";

import { useState, useEffect } from "react";
import { getOrCreateUserId } from "@/lib/client-utils";

const DEFAULTS = {
  displayName: "",
  studyStart: "09:00",
  studyEnd: "17:00",
  dailyCap: 180,
  dailyXpGoal: 50,
};

export default function SettingsPage() {
  const [displayName, setDisplayName] = useState(DEFAULTS.displayName);
  const [studyStart, setStudyStart] = useState(DEFAULTS.studyStart);
  const [studyEnd, setStudyEnd] = useState(DEFAULTS.studyEnd);
  const [dailyCap, setDailyCap] = useState(DEFAULTS.dailyCap);
  const [dailyXpGoal, setDailyXpGoal] = useState(DEFAULTS.dailyXpGoal);
  const [leaderboardVisible, setLeaderboardVisible] = useState(true);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const [googleStatus, setGoogleStatus] = useState<"loading" | "connected" | "disconnected">("loading");

  // Load settings from backend (with localStorage fallback)
  useEffect(() => {
    const userId = getOrCreateUserId();
    async function loadSettings() {
      try {
        const res = await fetch("/api/settings", {
          headers: { "X-User-Id": userId },
        });
        if (res.ok) {
          const data = await res.json();
          setDisplayName(data.displayName || "");
          setStudyStart(data.studyStart || DEFAULTS.studyStart);
          setStudyEnd(data.studyEnd || DEFAULTS.studyEnd);
          setDailyCap(data.dailyCap ?? DEFAULTS.dailyCap);
          setDailyXpGoal(data.dailyXpGoal ?? DEFAULTS.dailyXpGoal);
          setLeaderboardVisible(data.leaderboardVisible !== false);
          // Also sync to localStorage for plan page compatibility
          localStorage.setItem("study_bot_prefs", JSON.stringify({
            studyStart: data.studyStart || DEFAULTS.studyStart,
            studyEnd: data.studyEnd || DEFAULTS.studyEnd,
            dailyCap: data.dailyCap ?? DEFAULTS.dailyCap,
          }));
        } else {
          // Fall back to localStorage
          loadFromLocalStorage();
        }
      } catch {
        loadFromLocalStorage();
      } finally {
        setLoading(false);
      }
    }

    function loadFromLocalStorage() {
      try {
        const raw = localStorage.getItem("study_bot_prefs");
        if (raw) {
          const prefs = JSON.parse(raw);
          if (prefs.studyStart) setStudyStart(prefs.studyStart);
          if (prefs.studyEnd) setStudyEnd(prefs.studyEnd);
          if (prefs.dailyCap) setDailyCap(prefs.dailyCap);
        }
      } catch {
        // Use defaults
      }
    }

    loadSettings();
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

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);

    // Save to localStorage (always, as fallback)
    localStorage.setItem("study_bot_prefs", JSON.stringify({ studyStart, studyEnd, dailyCap }));

    // Save to backend
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": getOrCreateUserId(),
        },
        body: JSON.stringify({
          displayName: displayName.trim() || undefined,
          studyStart,
          studyEnd,
          dailyCap,
          dailyXpGoal,
          leaderboardVisible,
        }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      // localStorage save already happened as fallback
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const handleGoogleConnect = () => {
    window.location.href = `/api/integrations/google/connect?user_id=${getOrCreateUserId()}`;
  };

  if (loading) {
    return (
      <div style={pageStyle}>
        <h1 style={headingStyle}>Settings</h1>
        <p style={{ color: "#7a7060" }}>Loading preferences...</p>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <h1 style={headingStyle}>Settings</h1>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={sectionStyle}>Profile</h2>
        <p style={hintStyle}>Set a display name for the leaderboard.</p>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Your display name"
          maxLength={50}
          style={textInputStyle}
        />
      </section>

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
        <h2 style={sectionStyle}>Daily XP goal</h2>
        <p style={hintStyle}>Your daily XP target shown on the dashboard.</p>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <input
            type="range"
            min={10}
            max={200}
            step={10}
            value={dailyXpGoal}
            onChange={(e) => setDailyXpGoal(Number(e.target.value))}
            style={{ flex: 1, accentColor: "#f0dc4e" }}
          />
          <span style={{ color: "#f0dc4e", fontWeight: "bold", minWidth: "3rem", textAlign: "right" }}>
            {dailyXpGoal} XP
          </span>
        </div>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={sectionStyle}>Leaderboard</h2>
        <label style={{ display: "flex", alignItems: "center", gap: "0.75rem", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={leaderboardVisible}
            onChange={(e) => setLeaderboardVisible(e.target.checked)}
            style={{ accentColor: "#f0dc4e", width: 18, height: 18, cursor: "pointer" }}
          />
          <span style={{ color: "#e8dcc8", fontSize: "0.95rem" }}>Show me on the leaderboard</span>
        </label>
        <p style={{ ...hintStyle, marginTop: "0.35rem" }}>
          When off, your name won&apos;t appear to other users.
        </p>
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

      <button onClick={handleSave} disabled={saving} style={{ ...saveBtnStyle, opacity: saving ? 0.6 : 1 }}>
        {saved ? "Saved!" : saving ? "Saving..." : "Save Preferences"}
      </button>
      <p style={{ fontSize: "0.7rem", color: "#5a7a5a", marginTop: "0.5rem" }}>
        Settings are synced to your account and available on all devices.
      </p>
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
  color: "#9a8a7a",
  fontSize: "0.9rem",
  margin: "0 0 0.75rem",
};

const textInputStyle: React.CSSProperties = {
  width: "100%",
  background: "#2d422d",
  color: "#e8dcc8",
  border: "1px solid #4a6a4a",
  padding: "0.5rem 0.75rem",
  fontFamily: "inherit",
  fontSize: "1rem",
  borderRadius: "4px",
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
