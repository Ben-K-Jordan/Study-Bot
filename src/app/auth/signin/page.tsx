"use client";

import { useState, Suspense } from "react";
import { signIn } from "next-auth/react";
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
  switchStyle,
  linkStyle,
  passwordWrapperStyle,
  passwordInputStyle,
  passwordToggleStyle,
  inputStyle,
} from "../styles";

function SignInForm() {
  const searchParams = useSearchParams();
  const justVerified = searchParams.get("verified") === "true";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("Invalid email or password");
      setLoading(false);
    } else {
      window.location.href = "/";
    }
  }

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <h1 style={titleStyle}>Welcome Back</h1>
        <p style={subtitleStyle}>Sign in to continue studying</p>

        {justVerified && (
          <div style={successStyle} role="alert">Email verified! You can now sign in.</div>
        )}

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

          <label htmlFor="password" style={labelStyle}>Password</label>
          <div style={passwordWrapperStyle}>
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min 8 characters"
              required
              minLength={8}
              autoComplete="current-password"
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

          <button
            type="submit"
            disabled={loading}
            style={{ ...buttonStyle, opacity: loading ? 0.6 : 1 }}
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <p style={{ textAlign: "center", marginTop: "1rem" }}>
          <Link href="/auth/forgot-password" style={{ ...linkStyle, fontSize: "0.85rem", fontWeight: 400 }}>
            Forgot your password?
          </Link>
        </p>

        <p style={switchStyle}>
          Don&apos;t have an account?{" "}
          <Link href="/auth/signup" style={linkStyle}>Sign up</Link>
        </p>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={
      <div style={containerStyle}>
        <div style={cardStyle}>
          <p style={{ textAlign: "center", color: "var(--color-text-muted)" }}>Loading...</p>
        </div>
      </div>
    }>
      <SignInForm />
    </Suspense>
  );
}
