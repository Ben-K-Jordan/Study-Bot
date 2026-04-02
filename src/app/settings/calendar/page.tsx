"use client";

import { useState, useEffect, useCallback } from "react";
import { getOrCreateUserId } from "@/lib/client-utils";

interface CalendarEntry {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole?: string;
  timeZone?: string;
}

interface IntegrationStatus {
  status: "CONNECTED" | "DISCONNECTED" | "ERROR";
  connected: boolean;
  connected_email?: string;
  scopes?: string[];
  default_calendar_id: string;
  busy_calendar_ids: string[];
  timezone?: string;
  last_healthy_at?: string | null;
  last_error?: { code: string; message: string } | null;
}

export default function CalendarSettingsPage() {
  const [integration, setIntegration] = useState<IntegrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [calendars, setCalendars] = useState<CalendarEntry[]>([]);
  const [selectedCalendar, setSelectedCalendar] = useState("primary");
  const [busyCalendars, setBusyCalendars] = useState<string[]>(["primary"]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);

  const headers = useCallback(() => ({ "X-User-Id": getOrCreateUserId() }), []);

  // Check URL params for OAuth result
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "1") {
      setMessage("Google Calendar connected successfully!");
      window.history.replaceState({}, "", "/settings/calendar");
    }
    if (params.get("error")) {
      setError(`Connection failed: ${params.get("error")}`);
      window.history.replaceState({}, "", "/settings/calendar");
    }
  }, []);

  // Fetch status
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/google/status", { headers: headers() });
      const data: IntegrationStatus = await res.json();
      setIntegration(data);
      setSelectedCalendar(data.default_calendar_id || "primary");
      setBusyCalendars(data.busy_calendar_ids || ["primary"]);
    } catch {
      setError("Failed to check connection status");
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // Fetch calendar list when connected
  const integrationStatus = integration?.status;
  useEffect(() => {
    if (integrationStatus !== "CONNECTED") return;
    async function fetchCalendars() {
      try {
        const res = await fetch("/api/integrations/google/calendars", { headers: headers() });
        if (res.ok) {
          const data = await res.json();
          setCalendars(data.calendars || []);
        }
      } catch {
        // Non-critical
      }
    }
    fetchCalendars();
  }, [integrationStatus, headers]);

  const handleConnect = () => {
    window.location.href = `/api/integrations/google/connect?x_user_id=${getOrCreateUserId()}`;
  };

  const handleDisconnect = async () => {
    try {
      const res = await fetch("/api/integrations/google/disconnect", {
        method: "POST",
        headers: headers(),
      });
      if (res.ok) {
        setIntegration({ status: "DISCONNECTED", connected: false, default_calendar_id: "primary", busy_calendar_ids: ["primary"] });
        setCalendars([]);
        setMessage("Google Calendar disconnected.");
      }
    } catch {
      setError("Failed to disconnect");
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/integrations/google/test", {
        method: "POST",
        headers: headers(),
      });
      const data = await res.json();
      if (data.ok) {
        setMessage("Connection test passed!");
        await fetchStatus();
      } else if (data.error === "GOOGLE_RECONNECT_REQUIRED") {
        setError("Google token expired or revoked. Please reconnect your account.");
        await fetchStatus();
      } else {
        setError(`Connection test failed: ${data.reason || "Unknown error"}`);
        await fetchStatus();
      }
    } catch {
      setError("Network error during test");
    } finally {
      setTesting(false);
    }
  };

  const handleSavePreferences = async () => {
    setSavingPrefs(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/integrations/google/preferences", {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({
          default_calendar_id: selectedCalendar,
          busy_calendar_ids: busyCalendars,
        }),
      });
      if (res.ok) {
        setMessage("Preferences saved.");
      } else {
        const data = await res.json();
        setError(data.error || "Failed to save preferences");
      }
    } catch {
      setError("Network error");
    } finally {
      setSavingPrefs(false);
    }
  };

  const toggleBusyCalendar = (calId: string) => {
    setBusyCalendars((prev) => {
      if (prev.includes(calId)) {
        if (prev.length <= 1) return prev; // Must keep at least one
        return prev.filter((id) => id !== calId);
      }
      return [...prev, calId];
    });
  };

  const isConnected = integration?.status === "CONNECTED";
  const needsReconnect = integration?.status === "ERROR" ||
    integration?.last_error?.code === "INVALID_GRANT";

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
        <div style={successBannerStyle}>
          {message}
          <button onClick={() => setMessage(null)} style={dismissStyle}>x</button>
        </div>
      )}

      {error && (
        <div style={errorBannerStyle}>
          {error}
          <button onClick={() => setError(null)} style={dismissStyle}>x</button>
        </div>
      )}

      {/* State Panel */}
      <fieldset style={fieldsetStyle}>
        <legend style={{ color: "#00ff88" }}>Connection Status</legend>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
          <StatusDot connected={isConnected} error={integration?.status === "ERROR"} />
          <span style={{ fontWeight: "bold", color: isConnected ? "#00ff88" : "#888" }}>
            {integration?.status === "CONNECTED" ? "Connected" : integration?.status === "ERROR" ? "Error" : "Not connected"}
          </span>
        </div>

        {integration?.connected_email && (
          <div style={infoRowStyle}>
            <span style={labelStyle}>Account:</span>
            <span>{integration.connected_email}</span>
          </div>
        )}

        {integration?.last_healthy_at && (
          <div style={infoRowStyle}>
            <span style={labelStyle}>Last verified:</span>
            <span style={{ color: "#888" }}>{new Date(integration.last_healthy_at).toLocaleString()}</span>
          </div>
        )}

        {integration?.last_error && (
          <div style={{ ...errorBannerStyle, margin: "0.75rem 0 0 0" }}>
            <strong>{integration.last_error.code}:</strong> {integration.last_error.message}
          </div>
        )}

        <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", flexWrap: "wrap" }}>
          {!isConnected ? (
            <button onClick={handleConnect} style={primaryButtonStyle}>
              {needsReconnect ? "Reconnect Google Calendar" : "Connect Google Calendar"}
            </button>
          ) : (
            <>
              <button onClick={handleTestConnection} disabled={testing} style={secondaryButtonStyle}>
                {testing ? "Testing..." : "Test Connection"}
              </button>
              <button onClick={handleDisconnect} style={dangerButtonStyle}>
                Disconnect
              </button>
            </>
          )}
          {needsReconnect && isConnected && (
            <button onClick={handleConnect} style={primaryButtonStyle}>
              Reconnect
            </button>
          )}
        </div>
      </fieldset>

      {/* Calendar Preferences (only when connected) */}
      {isConnected && calendars.length > 0 && (
        <fieldset style={{ ...fieldsetStyle, marginTop: "1rem" }}>
          <legend style={{ color: "#00ff88" }}>Calendar Preferences</legend>

          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.3rem", fontSize: "0.9rem" }}>
              Default calendar (for publishing):
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

          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.3rem", fontSize: "0.9rem" }}>
              Busy calendars (for availability checks):
            </label>
            {calendars.map((cal) => (
              <label key={cal.id} style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.2rem", fontSize: "0.85rem" }}>
                <input
                  type="checkbox"
                  checked={busyCalendars.includes(cal.id)}
                  onChange={() => toggleBusyCalendar(cal.id)}
                />
                {cal.summary} {cal.primary ? "(Primary)" : ""}
              </label>
            ))}
          </div>

          <button onClick={handleSavePreferences} disabled={savingPrefs} style={primaryButtonStyle}>
            {savingPrefs ? "Saving..." : "Save Preferences"}
          </button>
        </fieldset>
      )}

      {isConnected && integration.scopes && integration.scopes.length > 0 && (
        <details style={{ marginTop: "1rem", fontSize: "0.8rem", color: "#666" }}>
          <summary style={{ cursor: "pointer" }}>Granted scopes</summary>
          <div style={{ marginTop: "0.25rem" }}>
            {integration.scopes.map((s) => (
              <div key={s}>{s}</div>
            ))}
          </div>
        </details>
      )}

      <div style={{ marginTop: "1.5rem" }}>
        <a href="/plan" style={{ color: "#00ff88", fontSize: "0.9rem" }}>
          ← Back to Week Planner
        </a>
      </div>
    </div>
  );
}

// ---- Sub-components ----

function StatusDot({ connected, error }: { connected: boolean; error: boolean }) {
  const color = error ? "#ff4444" : connected ? "#00ff88" : "#666";
  return (
    <span
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: color,
        boxShadow: connected ? `0 0 6px ${color}` : undefined,
      }}
    />
  );
}

// ---- Styles ----

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
  width: "100%",
};

const infoRowStyle: React.CSSProperties = {
  display: "flex",
  gap: "0.5rem",
  fontSize: "0.85rem",
  marginBottom: "0.25rem",
};

const labelStyle: React.CSSProperties = {
  color: "#888",
  minWidth: 100,
};

const primaryButtonStyle: React.CSSProperties = {
  background: "#00ff88",
  color: "#000",
  border: "none",
  padding: "0.5rem 1rem",
  fontFamily: "monospace",
  fontWeight: "bold",
  fontSize: "0.9rem",
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  background: "#333",
  color: "#e0e0e0",
  border: "1px solid #555",
  padding: "0.5rem 1rem",
  fontFamily: "monospace",
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

const successBannerStyle: React.CSSProperties = {
  color: "#00ff88",
  border: "1px solid #00ff88",
  padding: "0.5rem 0.75rem",
  marginBottom: "1rem",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

const errorBannerStyle: React.CSSProperties = {
  color: "#ff4444",
  border: "1px solid #ff4444",
  padding: "0.5rem 0.75rem",
  marginBottom: "1rem",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

const dismissStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "inherit",
  cursor: "pointer",
  fontFamily: "monospace",
  fontSize: "0.9rem",
  padding: "0 0.25rem",
};
