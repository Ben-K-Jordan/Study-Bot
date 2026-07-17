/**
 * Shared style constants used across multiple page components.
 * Must only be imported from "use client" components.
 */
import type React from "react";

export const headerStyle: React.CSSProperties = { marginBottom: "1.5rem" };

export const titleStyle: React.CSSProperties = {
  fontSize: "1.5rem",
  fontWeight: 700,
  margin: "0 0 0.25rem",
  fontFamily: "var(--font-display)",
  color: "var(--color-text)",
};

export const subtitleStyle: React.CSSProperties = {
  color: "var(--color-text-muted)",
  margin: 0,
  fontSize: "0.9rem",
};

export const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.75rem",
  color: "var(--color-text-dim)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: "0.35rem",
};

export const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem",
  fontSize: "0.85rem",
  fontFamily: "inherit",
  background: "var(--color-bg-card)",
  color: "var(--color-text)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
};

export const generateBtnStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.75rem 1.5rem",
  fontSize: "1.05rem",
  fontFamily: "var(--font-body)",
  fontWeight: 600,
  background: "var(--color-primary)",
  color: "var(--color-bg-darkest)",
  border: "none",
  borderRadius: "var(--radius)",
  cursor: "pointer",
};

export const sectionTitleStyle: React.CSSProperties = {
  fontSize: "0.8rem",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  margin: "0 0 0.75rem",
  fontFamily: "var(--font-display)",
};

export const deleteBtnStyle: React.CSSProperties = {
  padding: "0 0.65rem",
  fontFamily: "inherit",
  fontSize: "1.1rem",
  fontWeight: 700,
  background: "none",
  color: "var(--color-error)",
  border: "1px solid var(--color-error)",
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  flexShrink: 0,
};
