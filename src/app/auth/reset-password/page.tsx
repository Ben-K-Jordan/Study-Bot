"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  containerStyle,
  cardStyle,
  titleStyle,
  subtitleStyle,
  labelStyle,
  buttonStyle,
  errorStyle,
  successStyle,
  textStyle,
  mutedStyle,
  linkStyle,
  passwordWrapperStyle,
  passwordInputStyle,
  passwordToggleStyle,
} from "../styles";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <h1 style={{ ...titleStyle, margin: "0 0 1rem" }}>Invalid Link</h1>
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
          <h1 style={{ ...titleStyle, margin: "0 0 1rem" }}>Password Reset</h1>
          <div style={successStyle} role="alert">Your password has been reset successfully.</div>
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

        {error && <div style={errorStyle} role="alert" aria-live="polite">{error}</div>}

        <form onSubmit={handleSubmit}>
          <label htmlFor="password" style={labelStyle}>New Password</label>
          <div style={passwordWrapperStyle}>
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min 8 characters"
              required
              minLength={8}
              autoComplete="new-password"
              style={passwordInputStyle}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              style={passwordToggleStyle}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="compact-btn"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>

          <label htmlFor="confirm-password" style={labelStyle}>Confirm Password</label>
          <div style={passwordWrapperStyle}>
            <input
              id="confirm-password"
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Type it again"
              required
              minLength={8}
              autoComplete="new-password"
              style={passwordInputStyle}
            />
          </div>

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
