"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";

export default function SignUpPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create account");
        setLoading(false);
        return;
      }

      // Auto-sign in after signup
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("Account created but sign-in failed. Please sign in manually.");
        setLoading(false);
      } else {
        window.location.href = "/";
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <h1 style={titleStyle}>Create Account</h1>
        <p style={subtitleStyle}>Start your study journey</p>

        {error && <div style={errorStyle}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <label htmlFor="name" style={labelStyle}>Name</label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            required
            maxLength={50}
            autoComplete="name"
            style={inputStyle}
          />

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

          <label htmlFor="password" style={labelStyle}>Password</label>
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
            {loading ? "Creating account..." : "Create Account"}
          </button>
        </form>

        <p style={switchStyle}>
          Already have an account?{" "}
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
