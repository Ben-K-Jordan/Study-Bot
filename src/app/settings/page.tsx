"use client";

import { useState, useEffect } from "react";
const DEFAULTS = {
  studyStart: "09:00",
  studyEnd: "17:00",
  dailyCap: 180,
  dailyXpGoal: 50,
};

// Fallback for runtimes without Intl.supportedValuesOf
const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Africa/Cairo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Pacific/Auckland",
];

const TIMEZONE_OPTIONS: string[] =
  typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : COMMON_TIMEZONES;

export default function SettingsPage() {
  const [studyStart, setStudyStart] = useState(DEFAULTS.studyStart);
  const [studyEnd, setStudyEnd] = useState(DEFAULTS.studyEnd);
  const [dailyCap, setDailyCap] = useState(DEFAULTS.dailyCap);
  const [dailyXpGoal, setDailyXpGoal] = useState(DEFAULTS.dailyXpGoal);
  const [timezone, setTimezone] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const [googleStatus, setGoogleStatus] = useState<"loading" | "connected" | "disconnected">("loading");
  const [googleConfigured, setGoogleConfigured] = useState(true);

  // null = config not loaded yet — note stays hidden until we know for sure.
  const [aiMock, setAiMock] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/config")
      .then((res) => (res.ok ? res.json() : null))
      .then((config) => {
        if (!cancelled && config) setAiMock(config.ai_mock === true);
      })
      .catch(() => {
        // Non-critical — leave note hidden.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Ticks every second so the timezone preview shows a live clock.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Instant validation feedback: render the current time in the selected
  // zone, or flag the value as unrecognized. Empty means UTC (the default).
  const effectiveZone = timezone.trim() || "UTC";
  let zonePreview: string | null = null;
  try {
    zonePreview = new Intl.DateTimeFormat(undefined, {
      timeZone: effectiveZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(now);
  } catch {
    zonePreview = null; // Not a valid IANA timezone
  }

  const handleDetectTimezone = () => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected) setTimezone(detected);
  };

  // Load settings from backend (with localStorage fallback)
  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const data = await res.json();
          setStudyStart(data.studyStart || DEFAULTS.studyStart);
          setStudyEnd(data.studyEnd || DEFAULTS.studyEnd);
          setDailyCap(data.dailyCap ?? DEFAULTS.dailyCap);
          setDailyXpGoal(data.dailyXpGoal ?? DEFAULTS.dailyXpGoal);
          setTimezone(data.timezone || "");
          setGoogleConfigured(Boolean(data.google_configured));
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
        const res = await fetch("/api/integrations/google/status");
        const data = await res.json();
        setGoogleStatus(data.connected || data.status === "CONNECTED" ? "connected" : "disconnected");
      } catch {
        setGoogleStatus("disconnected");
      }
    }
    checkGoogle();
  }, []);

  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError(null);

    // Save to localStorage (always, as fallback)
    localStorage.setItem("study_bot_prefs", JSON.stringify({ studyStart, studyEnd, dailyCap }));

    // Save to backend
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studyStart,
          studyEnd,
          dailyCap,
          dailyXpGoal,
          timezone: timezone.trim() || null,
        }),
      });

      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        setSaveError("Failed to save settings. Your preferences were saved locally.");
      }
    } catch {
      setSaveError("Could not reach the server. Your preferences were saved locally.");
    } finally {
      setSaving(false);
    }
  };

  const handleGoogleConnect = () => {
    window.location.href = `/api/integrations/google/connect`;
  };

  if (loading) {
    return (
      <div style={pageStyle}>
        <h1 style={headingStyle}>Settings</h1>
        <p style={{ color: "var(--color-text-dim)" }}>Loading preferences...</p>
      </div>
    );
  }

  return (
    <div id="main-content" style={pageStyle} role="form" aria-label="User settings">
      <style>{`
        .settings-row { display: grid; grid-template-columns: 1fr; gap: 0.5rem 2.5rem; align-items: center; }
        @media (min-width: 720px) { .settings-row { grid-template-columns: minmax(220px, 280px) 1fr; } }
      `}</style>
      <h1 style={headingStyle}>Settings</h1>

      <section style={sectionCardStyle}>
        <div className="settings-row">
          <div>
            <h2 style={sectionStyle}>Study hours</h2>
            <p style={hintStyle}>Sessions will be scheduled between these times.</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <input type="time" value={studyStart} onChange={(e) => setStudyStart(e.target.value)} aria-label="Study start time" style={timeInputStyle} />
            <span style={{ color: "var(--color-text-muted)" }}>to</span>
            <input type="time" value={studyEnd} onChange={(e) => setStudyEnd(e.target.value)} aria-label="Study end time" style={timeInputStyle} />
          </div>
        </div>
      </section>

      <section style={sectionCardStyle}>
        <div className="settings-row">
          <div>
            <h2 style={sectionStyle}>Timezone</h2>
            <p style={hintStyle}>Used for streak day boundaries. Leave empty for UTC.</p>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                type="text"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="e.g. America/New_York"
                list="timezone-options"
                aria-label="Timezone"
                style={{ ...textInputStyle, flex: 1, minWidth: 0 }}
              />
              <button
                type="button"
                className="compact-btn"
                onClick={handleDetectTimezone}
                title="Use your browser's timezone"
                style={detectBtnStyle}
              >
                Detect
              </button>
            </div>
            <datalist id="timezone-options">
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
            <p
              aria-live="polite"
              style={{
                fontSize: "0.85rem",
                margin: "0.5rem 0 0",
                overflowWrap: "break-word",
                color: zonePreview ? "var(--color-text-muted)" : "var(--color-error)",
              }}
            >
              {zonePreview
                ? `Current time in ${effectiveZone}: ${zonePreview}`
                : `"${timezone.trim()}" is not a recognized timezone (expected an IANA name like America/New_York).`}
            </p>
          </div>
        </div>
      </section>

      <section style={sectionCardStyle}>
        <div className="settings-row">
          <div>
            <h2 style={sectionStyle}>Daily study cap</h2>
            <p style={hintStyle}>Maximum study time per day.</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <input
              type="range"
              min={30}
              max={480}
              step={15}
              value={dailyCap}
              onChange={(e) => setDailyCap(Number(e.target.value))}
              aria-label="Daily study cap in minutes"
              style={{ flex: 1, minWidth: 0, accentColor: "var(--color-primary)" }}
            />
            <span style={{ color: "var(--color-primary)", fontWeight: "bold", minWidth: "4rem", textAlign: "right" }}>
              {Math.floor(dailyCap / 60)}h{dailyCap % 60 > 0 ? ` ${dailyCap % 60}m` : ""}
            </span>
          </div>
        </div>
      </section>

      <section style={sectionCardStyle}>
        <div className="settings-row">
          <div>
            <h2 style={sectionStyle}>Daily XP goal</h2>
            <p style={hintStyle}>Your daily XP target shown on the dashboard.</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <input
              type="range"
              min={10}
              max={200}
              step={10}
              value={dailyXpGoal}
              onChange={(e) => setDailyXpGoal(Number(e.target.value))}
              aria-label="Daily XP goal"
              style={{ flex: 1, minWidth: 0, accentColor: "var(--color-primary)" }}
            />
            <span style={{ color: "var(--color-primary)", fontWeight: "bold", minWidth: "3rem", textAlign: "right" }}>
              {dailyXpGoal} XP
            </span>
          </div>
        </div>
      </section>

      <section style={sectionCardStyle}>
        <div className="settings-row">
          <div>
            <h2 style={sectionStyle}>Google Calendar</h2>
            <p style={hintStyle}>Publish study sessions to your calendar.</p>
          </div>
          <div style={{ minWidth: 0 }}>
            {googleStatus === "loading" ? (
              <p style={{ ...hintStyle, margin: 0 }}>Checking connection...</p>
            ) : googleStatus === "connected" ? (
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                <span style={{ color: "var(--color-success)", fontSize: "0.95rem" }}>Connected</span>
                <span style={{ color: "var(--color-text-dim)", fontSize: "0.9rem" }}>Plans can be published to your calendar.</span>
              </div>
            ) : googleConfigured ? (
              <div>
                <p style={{ ...hintStyle, margin: "0 0 0.75rem" }}>Connect to publish study sessions to your calendar and auto-detect busy times.</p>
                <button onClick={handleGoogleConnect} style={connectBtnStyle}>
                  Connect Google Calendar
                </button>
              </div>
            ) : (
              <p style={{ ...hintStyle, margin: 0 }}>Google Calendar sync is not configured on this server.</p>
            )}
          </div>
        </div>
      </section>

      {aiMock === true && (
        <section style={sectionCardStyle}>
          <div className="settings-row">
            <div>
              <h2 style={sectionStyle}>AI provider</h2>
            </div>
            <p style={{ ...hintStyle, margin: 0 }}>
              Mock provider active. Set AI_PROVIDER and OPENAI_API_KEY in .env for real AI.
            </p>
          </div>
        </section>
      )}

      {saveError && (
        <div role="alert" aria-live="polite" style={{ background: "var(--color-bg-error-tint)", color: "var(--color-error)", border: "1px solid var(--color-error)", padding: "0.5rem 0.75rem", borderRadius: "var(--radius-sm)", fontSize: "0.85rem", marginBottom: "0.75rem", textAlign: "center" }}>
          {saveError}
        </div>
      )}
      <button onClick={handleSave} disabled={saving} style={{ ...saveBtnStyle, opacity: saving ? 0.6 : 1 }}>
        {saved ? "Saved!" : saving ? "Saving..." : "Save Preferences"}
      </button>
      <p style={{ fontSize: "0.7rem", color: "var(--color-text-dim)", marginTop: "0.5rem" }}>
        Settings are synced to your account and available on all devices.
      </p>
    </div>
  );
}

// ---- Styles ----

const pageStyle: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  minHeight: "100vh",
  padding: "2rem clamp(24px, 4vw, 32px)",
  maxWidth: 900,
  margin: "0 auto",
};

const sectionCardStyle: React.CSSProperties = {
  background: "var(--color-bg-card)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius)",
  boxShadow: "var(--shadow-card)",
  padding: "1.25rem 1.5rem",
  marginBottom: "1rem",
};

const headingStyle: React.CSSProperties = {
  color: "var(--color-primary)",
  fontSize: "2rem",
  margin: "0 0 1.5rem",
  fontWeight: 700,
  fontFamily: "var(--font-display)",
};

const sectionStyle: React.CSSProperties = {
  color: "var(--color-text)",
  fontSize: "1.2rem",
  margin: "0 0 0.25rem",
  fontWeight: 600,
  fontFamily: "var(--font-display)",
};

const hintStyle: React.CSSProperties = {
  color: "var(--color-text-faint)",
  fontSize: "0.9rem",
  margin: "0.25rem 0 0",
};

const textInputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--color-bg-input)",
  color: "var(--color-text)",
  border: "1px solid var(--color-border)",
  padding: "0.5rem 0.75rem",
  fontFamily: "inherit",
  fontSize: "1rem",
  borderRadius: "var(--radius-sm)",
};

const timeInputStyle: React.CSSProperties = {
  background: "var(--color-bg-input)",
  color: "var(--color-text)",
  border: "1px solid var(--color-border)",
  padding: "0.35rem 0.5rem",
  fontFamily: "inherit",
  fontSize: "0.95rem",
  borderRadius: "var(--radius-sm)",
};

const saveBtnStyle: React.CSSProperties = {
  background: "var(--color-primary)",
  color: "var(--color-bg-darkest)",
  border: "none",
  padding: "0.6rem 1.5rem",
  fontFamily: "inherit",
  fontWeight: "bold",
  fontSize: "1.05rem",
  cursor: "pointer",
  borderRadius: "var(--radius-sm)",
};

const detectBtnStyle: React.CSSProperties = {
  background: "var(--color-bg-input)",
  color: "var(--color-text)",
  border: "1px solid var(--color-border)",
  padding: "0.5rem 0.9rem",
  fontFamily: "inherit",
  fontSize: "0.9rem",
  fontWeight: 600,
  cursor: "pointer",
  borderRadius: "var(--radius-sm)",
  whiteSpace: "nowrap",
};

const connectBtnStyle: React.CSSProperties = {
  background: "var(--color-info)",
  color: "var(--color-bg-darkest)",
  border: "none",
  padding: "0.5rem 1rem",
  fontFamily: "inherit",
  fontWeight: "bold",
  fontSize: "0.95rem",
  cursor: "pointer",
  borderRadius: "var(--radius-sm)",
};
