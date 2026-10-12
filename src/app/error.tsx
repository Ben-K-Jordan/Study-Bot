"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
        fontFamily: "var(--sb-font-body)",
        backgroundColor: "var(--sb-bg)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          background: "var(--sb-bg-card)",
          border: "1px solid var(--sb-border-subtle)",
          borderRadius: "var(--sb-radius-lg)",
          boxShadow: "var(--sb-shadow-card)",
          padding: "2rem",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>😵</div>
        <h1
          style={{
            fontSize: "1.6rem",
            fontFamily: "var(--sb-font-display)",
            color: "var(--sb-error)",
            margin: "0 0 0.5rem",
          }}
        >
          Something went wrong
        </h1>
        <p
          style={{
            color: "var(--sb-text-muted)",
            fontSize: "0.9rem",
            margin: "0 0 1.5rem",
            lineHeight: 1.5,
          }}
        >
          {error.message || "An unexpected error occurred. Please try again."}
        </p>
        <button
          onClick={reset}
          style={{
            width: "100%",
            padding: "0.75rem",
            fontSize: "1.05rem",
            fontFamily: "inherit",
            fontWeight: 600,
            background: "var(--sb-primary)",
            color: "var(--sb-bg-darkest)",
            border: "none",
            borderRadius: "var(--sb-radius-sm)",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
