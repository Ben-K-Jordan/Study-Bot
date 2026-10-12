"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
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
  switchStyle,
  linkStyle,
  passwordWrapperStyle,
  passwordInputStyle,
  passwordToggleStyle,
} from "../styles";

export default function SignUpPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

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

      // When email verification is not required (the default), sign the new
      // user in with the credentials they just chose and land them on the
      // dashboard, which shows onboarding for fresh accounts. Only send them
      // to "Check Your Email" when this server actually requires verification.
      let verificationRequired = true;
      try {
        const configRes = await fetch("/api/config");
        if (configRes.ok) {
          const config = await configRes.json();
          verificationRequired = config.verification_required === true;
        }
      } catch {
        // Config unavailable — fall through to the verify-email page, which
        // explains that verification may be optional.
      }

      if (!verificationRequired) {
        const result = await signIn("credentials", {
          email,
          password,
          redirect: false,
        });
        if (!result?.error) {
          window.location.href = "/";
          return;
        }
        // Auto sign-in failed unexpectedly; let the user sign in manually.
        router.push("/auth/signin");
        return;
      }

      // Redirect to verify-email page with email for resend
      router.push(`/auth/verify-email?email=${encodeURIComponent(email)}`);
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

        {error && <div style={errorStyle} role="alert" aria-live="polite">{error}</div>}

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
