"use client";

import { useState } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (res.status === 429) {
        setError("Too many requests. Please try again later.");
        setLoading(false);
        return;
      }

      setSent(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ textAlign: "center", fontSize: "3rem", marginBottom: "1rem" }}>📬</div>
          <h1 style={titleStyle}>Check Your Email</h1>
          <p style={textStyle}>
            If an account with that email exists, we&apos;ve sent a password reset link.
            Check your inbox (and spam folder).
          </p>
          <p style={mutedStyle}>
            <Link href="/auth/signin" style={linkStyle}>Back to sign in</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <h1 style={titleStyle}>Forgot Password</h1>
        <p style={subtitleStyle}>Enter your email and we&apos;ll send you a reset link</p>

        {error && <div style={errorStyle}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <label htmlFor="email" style={labelStyle}>Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoComplete="email"
            style={inputStyle}
          />

          <button
            type="submit"
            disabled={loading}
            style={{ ...buttonStyle, opacity: loading ? 0.6 : 1 }}
          >
            {loading ? "Sending..." : "Send Reset Link"}
          </button>
        </form>

        <p style={switchStyle}>
          Remember your password?{" "}
          <Link href="/auth/signin" style={linkStyle}>Sign in</Link>
        </p>
      </div>
    </div>
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

const switchStyle: React.CSSProperties = {
  textAlign: "center",
  color: "var(--color-text-muted)",
  fontSize: "0.9rem",
  marginTop: "1.5rem",
};

const linkStyle: React.CSSProperties = {
  color: "var(--color-primary)",
  textDecoration: "none",
  fontWeight: 600,
};
