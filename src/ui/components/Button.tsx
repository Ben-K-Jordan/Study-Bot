/**
 * Button component — CSS-first with optional raster texture accent.
 *
 * Usage:
 *   <Button>Start Session</Button>
 *   <Button variant="secondary" size="sm">Cancel</Button>
 *   <Button textureKey="btn-primary">Textured Button</Button>
 *
 * Prefer CSS for states and layout. Use textureKey only for
 * Photoshop-designed button skins/textures.
 */
import { assets, type AssetKey } from "@/ui/assets/manifest";

type ButtonVariant = "primary" | "secondary" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  textureKey?: AssetKey;
}

const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
  primary: {
    background: "#00ff88",
    color: "#000",
    border: "none",
  },
  secondary: {
    background: "#333",
    color: "#e0e0e0",
    border: "1px solid #555",
  },
  danger: {
    background: "#ff4444",
    color: "#fff",
    border: "none",
  },
};

const sizeStyles: Record<ButtonSize, React.CSSProperties> = {
  sm: { padding: "0.3rem 0.6rem", fontSize: "0.8rem" },
  md: { padding: "0.5rem 1rem", fontSize: "0.9rem" },
  lg: { padding: "0.75rem 1.5rem", fontSize: "1rem" },
};

export function Button({
  variant = "primary",
  size = "md",
  textureKey,
  style,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  const baseStyle: React.CSSProperties = {
    fontFamily: "monospace",
    fontWeight: "bold",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
    transition: "opacity 0.15s",
    ...variantStyles[variant],
    ...sizeStyles[size],
  };

  // Apply raster texture as background image if specified
  if (textureKey) {
    const meta = assets[textureKey];
    const src = meta?.avif ?? meta?.webp;
    if (src) {
      baseStyle.backgroundImage = `url(${src})`;
      baseStyle.backgroundSize = "cover";
      baseStyle.backgroundPosition = "center";
    }
  }

  return (
    <button style={{ ...baseStyle, ...style }} disabled={disabled} {...rest}>
      {children}
    </button>
  );
}
