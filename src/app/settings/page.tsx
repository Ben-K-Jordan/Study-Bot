"use client";

import { useState, useEffect } from "react";
const DEFAULTS = {
  displayName: "",
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
  const [displayName, setDisplayName] = useState(DEFAULTS.displayName);
  const [studyStart, setStudyStart] = useState(DEFAULTS.studyStart);
  const [studyEnd, setStudyEnd] = useState(DEFAULTS.studyEnd);
  const [dailyCap, setDailyCap] = useState(DEFAULTS.dailyCap);
  const [dailyXpGoal, setDailyXpGoal] = useState(DEFAULTS.dailyXpGoal);
  const [leaderboardVisible, setLeaderboardVisible] = useState(true);
  const [timezone, setTimezone] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const [googleStatus, setGoogleStatus] = useState<"loading" | "connected" | "disconnected">("loading");

  // Notification preferences
  const [pushReminders, setPushReminders] = useState(true);
  const [streakReminders, setStreakReminders] = useState(true);
  const [emailReminders, setEmailReminders] = useState(true);
  const [weeklyDigest, setWeeklyDigest] = useState(true);
  const [reminderTime, setReminderTime] = useState("09:00");
  const [pushSupported, setPushSupported] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);

  // Load settings from backend (with localStorage fallback)
  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const data = await res.json();
          setDisplayName(data.displayName || "");
          setStudyStart(data.studyStart || DEFAULTS.studyStart);
          setStudyEnd(data.studyEnd || DEFAULTS.studyEnd);
          setDailyCap(data.dailyCap ?? DEFAULTS.dailyCap);
          setDailyXpGoal(data.dailyXpGoal ?? DEFAULTS.dailyXpGoal);
          setLeaderboardVisible(data.leaderboardVisible !== false);
          setTimezone(data.timezone || "");
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

    // Load notification preferences
    fetch("/api/notifications/preferences")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) {
          setPushReminders(data.pushReminders);
          setStreakReminders(data.streakReminders);
          setEmailReminders(data.emailReminders);
          setWeeklyDigest(data.weeklyDigest);
          setReminderTime(data.reminderTime || "09:00");
        }
      })
      .catch(() => {});

    // Check push notification support
    if ("serviceWorker" in navigator && "PushManager" in window) {
      setPushSupported(true);
      navigator.serviceWorker.ready.then((reg) => {
        reg.pushManager.getSubscription().then((sub) => {
          setPushSubscribed(!!sub);
        });
      });
    }
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
          displayName: displayName.trim() || undefined,
          studyStart,
          studyEnd,
          dailyCap,
          dailyXpGoal,
          leaderboardVisible,
          timezone: timezone.trim() || null,
        }),
      });
      // Save notification preferences in parallel
      await fetch("/api/notifications/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pushReminders, streakReminders, emailReminders, weeklyDigest, reminderTime }),
      }).catch(() => {});

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

  const handlePushToggle = async () => {
    if (!pushSupported) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      if (pushSubscribed) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await fetch("/api/push/unsubscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          });
          await sub.unsubscribe();
        }
        setPushSubscribed(false);
      } else {
        const keyRes = await fetch("/api/push/vapid-key");
        const { publicKey } = await keyRes.json();
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicKey,
        });
        const json = sub.toJSON();
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint: sub.endpoint,
            keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
          }),
        });
        setPushSubscribed(true);
      }
    } catch {
      // Permission denied or other error
    }
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
          aria-label="Display name"
          style={textInputStyle}
        />
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={sectionStyle}>Study hours</h2>
        <p style={hintStyle}>Sessions will be scheduled between these times.</p>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <input type="time" value={studyStart} onChange={(e) => setStudyStart(e.target.value)} aria-label="Study start time" style={timeInputStyle} />
          <span style={{ color: "var(--color-text-muted)" }}>to</span>
          <input type="time" value={studyEnd} onChange={(e) => setStudyEnd(e.target.value)} aria-label="Study end time" style={timeInputStyle} />
        </div>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={sectionStyle}>Timezone</h2>
        <p style={hintStyle}>Used for streak day boundaries. Leave empty for UTC.</p>
        <input
          type="text"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          placeholder="e.g. America/New_York"
          list="timezone-options"
          aria-label="Timezone"
          style={textInputStyle}
        />
        <datalist id="timezone-options">
          {TIMEZONE_OPTIONS.map((tz) => (
            <option key={tz} value={tz} />
          ))}
        </datalist>
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
            aria-label="Daily study cap in minutes"
            style={{ flex: 1, accentColor: "var(--color-primary)" }}
          />
          <span style={{ color: "var(--color-primary)", fontWeight: "bold", minWidth: "4rem", textAlign: "right" }}>
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
            aria-label="Daily XP goal"
            style={{ flex: 1, accentColor: "var(--color-primary)" }}
          />
          <span style={{ color: "var(--color-primary)", fontWeight: "bold", minWidth: "3rem", textAlign: "right" }}>
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
            style={{ accentColor: "var(--color-primary)", width: 18, height: 18, cursor: "pointer" }}
          />
          <span style={{ color: "var(--color-text)", fontSize: "0.95rem" }}>Show me on the leaderboard</span>
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
            <span style={{ color: "var(--color-success)", fontSize: "0.95rem" }}>Connected</span>
            <span style={{ color: "var(--color-text-dim)", fontSize: "0.9rem" }}>Plans can be published to your calendar.</span>
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

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={sectionStyle}>Notifications</h2>
        <p style={hintStyle}>Control how Study Bot nags you (lovingly).</p>

        {pushSupported && (
          <div style={{ marginBottom: "1rem" }}>
            <label style={toggleRowStyle}>
              <input
                type="checkbox"
                checked={pushSubscribed}
                onChange={handlePushToggle}
                style={checkboxStyle}
              />
              <span style={{ color: "var(--color-text)", fontSize: "0.95rem" }}>Push notifications</span>
            </label>
            <p style={{ ...hintStyle, marginLeft: "2rem", marginTop: "0.15rem" }}>
              {pushSubscribed ? "We'll bug you right on your device." : "Allow browser notifications for study reminders."}
            </p>
          </div>
        )}

        <label style={toggleRowStyle}>
          <input type="checkbox" checked={pushReminders} onChange={(e) => setPushReminders(e.target.checked)} style={checkboxStyle} />
          <span style={{ color: "var(--color-text)", fontSize: "0.95rem" }}>Study reminders</span>
        </label>

        <label style={toggleRowStyle}>
          <input type="checkbox" checked={streakReminders} onChange={(e) => setStreakReminders(e.target.checked)} style={checkboxStyle} />
          <span style={{ color: "var(--color-text)", fontSize: "0.95rem" }}>Streak warnings</span>
        </label>

        <label style={toggleRowStyle}>
          <input type="checkbox" checked={emailReminders} onChange={(e) => setEmailReminders(e.target.checked)} style={checkboxStyle} />
          <span style={{ color: "var(--color-text)", fontSize: "0.95rem" }}>Email reminders</span>
        </label>

        <label style={toggleRowStyle}>
          <input type="checkbox" checked={weeklyDigest} onChange={(e) => setWeeklyDigest(e.target.checked)} style={checkboxStyle} />
          <span style={{ color: "var(--color-text)", fontSize: "0.95rem" }}>Weekly digest email</span>
        </label>

        <div style={{ marginTop: "0.75rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span style={{ color: "var(--color-text-faint)", fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Reminder time
            </span>
            <input
              type="time"
              value={reminderTime}
              onChange={(e) => setReminderTime(e.target.value)}
              style={timeInputStyle}
            />
          </label>
        </div>
      </section>

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
  padding: "2rem",
  maxWidth: 600,
  margin: "0 auto",
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
  margin: "0 0 0.75rem",
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

const toggleRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.75rem",
  cursor: "pointer",
  marginBottom: "0.5rem",
};

const checkboxStyle: React.CSSProperties = {
  accentColor: "var(--color-primary)",
  width: 18,
  height: 18,
  cursor: "pointer",
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
