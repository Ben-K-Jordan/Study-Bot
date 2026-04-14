"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <h1 style={titleStyle}>Invalid Link</h1>
          <p style={textStyle}>This password reset link is invalid or has expired.</p>
          <p style={mutedStyle}>
            <Link href="/auth/forgot-password" style={linkStyle}>Request a new reset link</Link>
          </p>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong");
        setLoading(false);
        return;
      }

      setSuccess(true);
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ textAlign: "center", fontSize: "3rem", marginBottom: "1rem" }}>✅</div>
          <h1 style={titleStyle}>Password Reset</h1>
          <p style={textStyle}>Your password has been reset successfully.</p>
          <Link href="/auth/signin" style={{ ...buttonStyle, display: "block", textAlign: "center", textDecoration: "none", marginTop: "1rem" }}>
            Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <h1 style={titleStyle}>Reset Password</h1>
        <p style={subtitleStyle}>Enter your new password</p>

        {error && <div style={errorStyle}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <label htmlFor="password" style={labelStyle}>New Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min 8 characters"
            required
            minLength={8}
            autoComplete="new-password"
            style={inputStyle}
          />

          <label htmlFor="confirm-password" style={labelStyle}>Confirm Password</label>
          <input
            id="confirm-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Type it again"
            required
            minLength={8}
            autoComplete="new-password"
            style={inputStyle}
          />

          <button
            type="submit"
            disabled={loading}
            style={{ ...buttonStyle, opacity: loading ? 0.6 : 1 }}
          >
            {loading ? "Resetting..." : "Reset Password"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div style={containerStyle}>
        <div style={cardStyle}>
          <p style={{ textAlign: "center", color: "var(--color-text-muted)" }}>Loading...</p>
        </div>
      </div>
    }>
      <ResetPasswordForm />
    </Suspense>
  );
}

const containerStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "1rem",
  fontFamily: "var(--font-body)",
  backgroundColor: "var(--color-bg)",
};

const cardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 400,
  background: "var(--color-bg-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 12,
  padding: "2rem",
};

const titleStyle: React.CSSProperties = {
  fontSize: "1.8rem",
  fontFamily: "var(--font-display)",
  color: "var(--color-primary)",
  margin: "0 0 0.25rem",
  textAlign: "center",
};

const subtitleStyle: React.CSSProperties = {
  color: "var(--color-text-muted)",
  textAlign: "center",
  margin: "0 0 1.5rem",
  fontSize: "0.95rem",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.85rem",
  color: "var(--color-text-faint)",
  marginBottom: "0.3rem",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.65rem 0.75rem",
  fontSize: "1rem",
  fontFamily: "inherit",
  background: "var(--color-bg-input)",
  color: "var(--color-text)",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  marginBottom: "1rem",
  boxSizing: "border-box",
};

const buttonStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.75rem",
  fontSize: "1.05rem",
  fontFamily: "inherit",
  fontWeight: 600,
  background: "var(--color-primary)",
  color: "var(--color-bg-darkest)",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  marginTop: "0.5rem",
};

const errorStyle: React.CSSProperties = {
  background: "var(--color-error)",
  color: "var(--color-bg-darkest)",
  padding: "0.5rem 0.75rem",
  borderRadius: 6,
  fontSize: "0.85rem",
  marginBottom: "1rem",
  textAlign: "center",
};

const textStyle: React.CSSProperties = {
  color: "var(--color-text)",
  textAlign: "center",
  fontSize: "1rem",
  lineHeight: 1.6,
  margin: "0 0 1rem",
};

const mutedStyle: React.CSSProperties = {
  color: "var(--color-text-muted)",
  textAlign: "center",
  fontSize: "0.9rem",
  margin: "0.5rem 0",
};

const linkStyle: React.CSSProperties = {
  color: "var(--color-primary)",
  textDecoration: "none",
  fontWeight: 600,
};
