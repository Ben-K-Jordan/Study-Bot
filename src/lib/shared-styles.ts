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
  fontFamily: "var(--sb-font-display)",
  color: "var(--sb-text)",
};

export const subtitleStyle: React.CSSProperties = {
  color: "var(--sb-text-muted)",
  margin: 0,
  fontSize: "0.9rem",
};

export const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.75rem",
  color: "var(--sb-text-dim)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: "0.35rem",
};

export const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem",
  fontSize: "0.85rem",
  fontFamily: "inherit",
  background: "var(--sb-bg-card)",
  color: "var(--sb-text)",
  border: "1px solid var(--sb-border)",
  borderRadius: "var(--sb-radius-sm)",
};

export const generateBtnStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.75rem 1.5rem",
  fontSize: "1.05rem",
  fontFamily: "var(--sb-font-body)",
  fontWeight: 600,
  background: "var(--sb-primary)",
  color: "var(--sb-bg-darkest)",
  border: "none",
  borderRadius: "var(--sb-radius)",
  cursor: "pointer",
};

export const sectionTitleStyle: React.CSSProperties = {
  fontSize: "0.8rem",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  fontWeight: 600,
  color: "var(--sb-text-muted)",
  margin: "0 0 0.75rem",
  fontFamily: "var(--sb-font-display)",
};

export const deleteBtnStyle: React.CSSProperties = {
  padding: "0 0.65rem",
  fontFamily: "inherit",
  fontSize: "1.1rem",
  fontWeight: 700,
  background: "none",
  color: "var(--sb-error)",
  border: "1px solid var(--sb-error)",
  borderRadius: "var(--sb-radius-sm)",
  cursor: "pointer",
  flexShrink: 0,
};
