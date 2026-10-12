"use client";

import React from "react";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * React error boundary — catches render errors in child components
 * and displays a fallback UI instead of crashing the entire page.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div style={{
          padding: "1.5rem",
          margin: "1rem 0",
          background: "var(--sb-bg-card)",
          border: "1px solid var(--sb-border-subtle)",
          borderRadius: "var(--sb-radius-lg)",
          boxShadow: "var(--sb-shadow-card)",
          color: "var(--sb-text-secondary)",
          textAlign: "center",
        }}>
          <p style={{ margin: 0, fontSize: "0.95rem" }}>
            Something went wrong. Try refreshing the page.
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              marginTop: "0.75rem",
              padding: "0.4rem 1rem",
              background: "var(--sb-bg-input)",
              color: "var(--sb-text)",
              border: "1px solid var(--sb-border)",
              borderRadius: "var(--sb-radius-sm)",
              fontWeight: 600,
              cursor: "pointer",
              fontSize: "0.85rem",
            }}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
