/** Shared styles for all auth pages */

export const containerStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "1rem",
  fontFamily: "var(--font-body)",
  backgroundColor: "var(--color-bg)",
};

export const cardStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 400,
  background: "var(--color-bg-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 12,
  padding: "2rem",
};

export const titleStyle: React.CSSProperties = {
  fontSize: "1.8rem",
  fontFamily: "var(--font-display)",
  color: "var(--color-primary)",
  margin: "0 0 0.25rem",
  textAlign: "center",
};

export const subtitleStyle: React.CSSProperties = {
  color: "var(--color-text-muted)",
  textAlign: "center",
  margin: "0 0 1.5rem",
  fontSize: "0.95rem",
};

export const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.85rem",
  color: "var(--color-text-faint)",
  marginBottom: "0.3rem",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

export const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.65rem 0.75rem",
  fontSize: "1rem",
  fontFamily: "inherit",
  background: "var(--color-bg-input)",
  color: "var(--color-text)",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  marginBottom: "1rem",
  boxSizing: "border-box",
};

export const buttonStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.75rem",
  fontSize: "1.05rem",
  fontFamily: "inherit",
  fontWeight: 600,
  background: "var(--color-primary)",
  color: "var(--color-bg-darkest)",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  marginTop: "0.5rem",
};

export const errorStyle: React.CSSProperties = {
  background: "var(--color-error)",
  color: "var(--color-bg-darkest)",
  padding: "0.5rem 0.75rem",
  borderRadius: 6,
  fontSize: "0.85rem",
  marginBottom: "1rem",
  textAlign: "center",
};

export const successStyle: React.CSSProperties = {
  background: "var(--color-bg-done)",
  color: "var(--color-success)",
  padding: "0.5rem 0.75rem",
  borderRadius: 6,
  fontSize: "0.85rem",
  marginBottom: "1rem",
  textAlign: "center",
  border: "1px solid var(--color-border-done)",
};

export const switchStyle: React.CSSProperties = {
  textAlign: "center",
  color: "var(--color-text-muted)",
  fontSize: "0.9rem",
  marginTop: "1.5rem",
};

export const linkStyle: React.CSSProperties = {
  color: "var(--color-primary)",
  textDecoration: "none",
  fontWeight: 600,
};

export const textStyle: React.CSSProperties = {
  color: "var(--color-text)",
  textAlign: "center",
  fontSize: "1rem",
  lineHeight: 1.6,
  margin: "0 0 1rem",
};

export const mutedStyle: React.CSSProperties = {
  color: "var(--color-text-muted)",
  textAlign: "center",
  fontSize: "0.9rem",
  margin: "0.5rem 0",
};

/** Wrapper style for password field + toggle button */
export const passwordWrapperStyle: React.CSSProperties = {
  position: "relative",
  marginBottom: "1rem",
};

export const passwordInputStyle: React.CSSProperties = {
  ...inputStyle,
  marginBottom: 0,
  paddingRight: "2.75rem",
};

export const passwordToggleStyle: React.CSSProperties = {
  position: "absolute",
  right: "0.5rem",
  top: "50%",
  transform: "translateY(-50%)",
  background: "none",
  border: "none",
  color: "var(--color-text-muted)",
  cursor: "pointer",
  padding: "0.25rem",
  fontSize: "0.85rem",
  lineHeight: 1,
  minHeight: "auto",
  minWidth: "auto",
};
