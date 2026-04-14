"use client";

import { useState } from "react";
import Link from "next/link";
import {
  containerStyle,
  cardStyle,
  titleStyle,
  subtitleStyle,
  labelStyle,
  inputStyle,
  buttonStyle,
  errorStyle,
  textStyle,
  mutedStyle,
  switchStyle,
  linkStyle,
} from "../styles";

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
          <h1 style={{ ...titleStyle, margin: "0 0 1rem" }}>Check Your Email</h1>
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

        {error && <div style={errorStyle} role="alert" aria-live="polite">{error}</div>}

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
