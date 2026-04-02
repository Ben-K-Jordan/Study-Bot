/**
 * Icon component — renders SVG from asset manifest.
 *
 * Usage:
 *   <Icon name="icon-check" size={20} />
 *   <Icon name="icon-phone-off" className="text-red-500" />
 */
import { assets, type AssetKey, type AssetMeta } from "@/ui/assets/manifest";

interface IconProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  name: AssetKey;
  size?: number;
}

export function Icon({ name, size, style, ...rest }: IconProps) {
  const meta: AssetMeta = assets[name];
  const src = meta.svg ?? meta.avif ?? meta.webp;
  if (!src) return null;

  const w = size ?? meta.width ?? 24;
  const h = size ?? meta.height ?? 24;

  return (
    <img
      src={src}
      width={w}
      height={h}
      alt={rest.alt ?? name}
      style={{ display: "inline-block", verticalAlign: "middle", ...style }}
      {...rest}
    />
  );
}
