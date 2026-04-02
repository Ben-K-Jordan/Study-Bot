"use client";

import { useState, useEffect } from "react";
import { getOrCreateUserId } from "@/lib/client-utils";

interface CalendarEntry {
  id: string;
  summary: string;
  primary?: boolean;
}

export default function CalendarSettingsPage() {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scopes, setScopes] = useState<string[]>([]);
  const [calendars, setCalendars] = useState<CalendarEntry[]>([]);
  const [selectedCalendar, setSelectedCalendar] = useState("primary");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Check URL params for OAuth result
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "1") {
      setMessage("Google Calendar connected successfully!");
    }
    if (params.get("error")) {
      setError(`Connection failed: ${params.get("error")}`);
    }
  }, []);

  // Fetch status on mount
  useEffect(() => {
    async function fetchStatus() {
      try {
        const res = await fetch("/api/integrations/google/status", {
          headers: { "X-User-Id": getOrCreateUserId() },
        });
        const data = await res.json();
        setConnected(data.connected);
        setScopes(data.scopes || []);
        if (data.selected_calendar_id) {
          setSelectedCalendar(data.selected_calendar_id);
        }
      } catch {
        setError("Failed to check connection status");
      } finally {
        setLoading(false);
      }
    }
    fetchStatus();
  }, []);

  // Fetch calendar list when connected
  useEffect(() => {
    if (!connected) return;
    async function fetchCalendars() {
      try {
        const res = await fetch("/api/integrations/google/calendars", {
          headers: { "X-User-Id": getOrCreateUserId() },
        });
        if (res.ok) {
          const data = await res.json();
          setCalendars(data.calendars || []);
          if (data.selected) setSelectedCalendar(data.selected);
        }
      } catch {
        // Non-critical
      }
    }
    fetchCalendars();
  }, [connected]);

  const handleConnect = () => {
    window.location.href = `/api/integrations/google/connect?x_user_id=${getOrCreateUserId()}`;
  };

  const handleDisconnect = async () => {
    try {
      const res = await fetch("/api/integrations/google/disconnect", {
        method: "POST",
        headers: { "X-User-Id": getOrCreateUserId() },
      });
      if (res.ok) {
        setConnected(false);
        setCalendars([]);
        setScopes([]);
        setMessage("Google Calendar disconnected.");
      }
    } catch {
      setError("Failed to disconnect");
    }
  };

  if (loading) {
    return (
      <div style={pageStyle}>
        <h1 style={headingStyle}>Calendar Settings</h1>
        <p style={{ color: "#888" }}>Loading...</p>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <h1 style={headingStyle}>Calendar Settings</h1>

      {message && (
        <div style={{ color: "#00ff88", border: "1px solid #00ff88", padding: "0.5rem", marginBottom: "1rem" }}>
          {message}
        </div>
      )}

      {error && (
        <div style={{ color: "#ff4444", border: "1px solid #ff4444", padding: "0.5rem", marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      <fieldset style={fieldsetStyle}>
        <legend style={{ color: "#00ff88" }}>Google Calendar</legend>

        {!connected ? (
          <div>
            <p style={{ color: "#aaa", marginTop: 0 }}>
              Connect your Google Calendar to automatically schedule study sessions
              around your existing commitments.
            </p>
            <button onClick={handleConnect} style={primaryButtonStyle}>
              Connect Google Calendar
            </button>
          </div>
        ) : (
          <div>
            <p style={{ color: "#00ff88", marginTop: 0, fontWeight: "bold" }}>
              Connected
            </p>

            {scopes.length > 0 && (
              <div style={{ fontSize: "0.8rem", color: "#888", marginBottom: "1rem" }}>
                Scopes: {scopes.join(", ")}
              </div>
            )}

            {calendars.length > 0 && (
              <div style={{ marginBottom: "1rem" }}>
                <label style={{ display: "block", marginBottom: "0.3rem" }}>
                  Calendar for availability:
                </label>
                <select
                  value={selectedCalendar}
                  onChange={(e) => setSelectedCalendar(e.target.value)}
                  style={inputStyle}
                >
                  {calendars.map((cal) => (
                    <option key={cal.id} value={cal.id}>
                      {cal.summary} {cal.primary ? "(Primary)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button onClick={handleDisconnect} style={dangerButtonStyle}>
              Disconnect
            </button>
          </div>
        )}
      </fieldset>

      <div style={{ marginTop: "1.5rem" }}>
        <a href="/plan" style={{ color: "#00ff88", fontSize: "0.9rem" }}>
          ← Back to Week Planner
        </a>
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  fontFamily: "monospace",
  background: "#0a0a0a",
  color: "#e0e0e0",
  minHeight: "100vh",
  padding: "2rem",
  maxWidth: 600,
};

const headingStyle: React.CSSProperties = {
  color: "#00ff88",
  fontSize: "1.5rem",
  marginBottom: "1.5rem",
};

const fieldsetStyle: React.CSSProperties = {
  border: "1px solid #333",
  padding: "1rem",
};

const inputStyle: React.CSSProperties = {
  background: "#111",
  color: "#e0e0e0",
  border: "1px solid #333",
  padding: "0.4rem 0.6rem",
  fontFamily: "monospace",
  fontSize: "0.9rem",
};

const primaryButtonStyle: React.CSSProperties = {
  background: "#00ff88",
  color: "#000",
  border: "none",
  padding: "0.75rem 1.5rem",
  fontFamily: "monospace",
  fontWeight: "bold",
  fontSize: "1rem",
  cursor: "pointer",
};

const dangerButtonStyle: React.CSSProperties = {
  background: "#ff4444",
  color: "#fff",
  border: "none",
  padding: "0.5rem 1rem",
  fontFamily: "monospace",
  fontWeight: "bold",
  cursor: "pointer",
};
