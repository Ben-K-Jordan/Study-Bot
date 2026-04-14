"use client";

import Link from "next/link";

export default function VerifyEmailPage() {
  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={{ textAlign: "center", fontSize: "3rem", marginBottom: "1rem" }}>📧</div>
        <h1 style={titleStyle}>Check Your Email</h1>
        <p style={textStyle}>
          We&apos;ve sent a verification link to your email address.
          Click the link to activate your account.
        </p>
        <p style={mutedStyle}>
          The link expires in 24 hours. If you don&apos;t see it, check your spam folder.
        </p>
        <p style={mutedStyle}>
          Already verified?{" "}
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
  maxWidth: 420,
  background: "var(--color-bg-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 12,
  padding: "2rem",
};

const titleStyle: React.CSSProperties = {
  fontSize: "1.8rem",
  fontFamily: "var(--font-display)",
  color: "var(--color-primary)",
  margin: "0 0 1rem",
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
