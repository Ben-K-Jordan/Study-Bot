"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  containerStyle,
  cardStyle,
  titleStyle,
  textStyle,
  mutedStyle,
  linkStyle,
  buttonStyle,
  errorStyle,
  successStyle,
} from "../styles";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const emailParam = searchParams.get("email") || "";

  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleResend() {
    if (!emailParam || resending) return;
    setResending(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailParam }),
      });

      if (res.status === 429) {
        setError("Too many requests. Please wait a few minutes.");
        setResending(false);
        return;
      }

      setResent(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setResending(false);
    }
  }

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={{ textAlign: "center", fontSize: "3rem", marginBottom: "1rem" }}>📧</div>
        <h1 style={{ ...titleStyle, margin: "0 0 1rem" }}>Check Your Email</h1>
        <p style={textStyle}>
          We&apos;ve sent a verification link to your email address.
          Click the link to activate your account.
        </p>
        <p style={mutedStyle}>
          The link expires in 24 hours. If you don&apos;t see it, check your spam folder.
        </p>
        <p style={mutedStyle}>
          Seeing this page means this server has REQUIRE_EMAIL_VERIFICATION enabled
          (verification is off by default). Running locally with the default console email
          provider? The verification link is printed in the terminal where{" "}
          <code>npm run dev</code> is running.
        </p>

        {error && <div style={errorStyle} role="alert" aria-live="polite">{error}</div>}
        {resent && <div style={successStyle} role="alert">Verification email resent!</div>}

        {emailParam && !resent && (
          <button
            onClick={handleResend}
            disabled={resending}
            style={{
              ...buttonStyle,
              background: "var(--color-bg-input)",
              color: "var(--color-text)",
              border: "1px solid var(--color-border)",
              opacity: resending ? 0.6 : 1,
              marginTop: "1rem",
            }}
          >
            {resending ? "Resending..." : "Resend verification email"}
          </button>
        )}

        <p style={mutedStyle}>
          Already verified?{" "}
          <Link href="/auth/signin" style={linkStyle}>Sign in</Link>
        </p>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <div style={containerStyle}>
        <div style={cardStyle}>
          <p style={{ textAlign: "center", color: "var(--color-text-muted)" }}>Loading...</p>
        </div>
      </div>
    }>
      <VerifyEmailContent />
    </Suspense>
  );
}
