"use client";

import React from "react";
import { ErrorState } from "@/components/app/error-state";

interface Props {
  children: React.ReactNode;
  /** Replaces the default ErrorState. Pass null to render nothing. */
  fallback?: React.ReactNode;
  /** What failed, as a sentence: "This message didn't load." */
  title?: string;
}

interface State {
  hasError: boolean;
  /** Bumped on retry so the children remount instead of rethrowing at once. */
  attempt: number;
}

/**
 * Catches render errors in part of a page and shows ErrorState with Retry
 * instead of taking the whole page down.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, attempt: 0 };
  }

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) return this.props.fallback;
      return (
        <ErrorState
          title={this.props.title ?? "This part of the page didn't load."}
          onRetry={() => this.setState((s) => ({ hasError: false, attempt: s.attempt + 1 }))}
        />
      );
    }

    return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
  }
}
