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
        fontFamily: "var(--font-body)",
        backgroundColor: "var(--color-bg)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-border-subtle)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-card)",
          padding: "2rem",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>😵</div>
        <h1
          style={{
            fontSize: "1.6rem",
            fontFamily: "var(--font-display)",
            color: "var(--color-error)",
            margin: "0 0 0.5rem",
          }}
        >
          Something went wrong
        </h1>
        <p
          style={{
            color: "var(--color-text-muted)",
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
            background: "var(--color-primary)",
            color: "var(--color-bg-darkest)",
            border: "none",
            borderRadius: "var(--radius-sm)",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
