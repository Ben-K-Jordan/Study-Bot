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
    background: "#f0dc4e",
    color: "#1f2e1f",
    border: "none",
  },
  secondary: {
    background: "#334d33",
    color: "#e8dcc8",
    border: "1px solid #4a6a4a",
  },
  danger: {
    background: "#e88888",
    color: "#1f2e1f",
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
    fontFamily: "var(--font-body)",
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
