/**
 * Asset optimization pipeline.
 *
 * Reads raw exports from design/exports-raw/,
 * outputs optimized assets to public/assets/ui/,
 * generates src/ui/assets/manifest.ts.
 *
 * Usage: npx tsx scripts/assets-build.ts
 *
 * PNG → AVIF (q55) + WebP (q80), strip metadata, optional @2x→@1x downscale
 * SVG → SVGO optimized
 */
import { mkdir, writeFile, rm } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import sharp from "sharp";
import { optimize } from "svgo";
import { readFile } from "fs/promises";
import fg from "fast-glob";

// ---- Config ----

const RAW_DIR = "design/exports-raw";
const OUT_DIR = "public/assets/ui";
const MANIFEST_PATH = "src/ui/assets/manifest.ts";

const AVIF_QUALITY = 55;
const WEBP_QUALITY = 80;

const MAX_FILE_SIZE = 300 * 1024; // 300KB
const MAX_DIMENSION = 2000;
const MAX_PIXELS = 4_000_000;

// Assets allowed to exceed pixel budget (e.g. hero backgrounds)
const PIXEL_ALLOWLIST: string[] = [];

// ---- Types ----

interface AssetEntry {
  key: string;
  avif?: string;
  webp?: string;
  svg?: string;
  width?: number;
  height?: number;
}

interface BuildResult {
  assets: AssetEntry[];
  warnings: string[];
  errors: string[];
}

// ---- SVG optimization config ----

const SVGO_CONFIG = {
  plugins: [
    { name: "removeDoctype" as const },
    { name: "removeXMLProcInst" as const },
    { name: "removeComments" as const },
    { name: "removeMetadata" as const },
    { name: "removeEditorsNSData" as const },
    { name: "removeDesc" as const, params: { removeAny: true } },
    { name: "removeUselessDefs" as const },
    { name: "cleanupAttrs" as const },
    { name: "removeEmptyAttrs" as const },
    { name: "removeEmptyContainers" as const },
    { name: "sortAttrs" as const },
    { name: "removeDimensions" as const, active: false },
  ],
};

// ---- Main ----

export async function buildAssets(): Promise<BuildResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const assets: AssetEntry[] = [];

  // Clean and recreate output dir
  if (existsSync(OUT_DIR)) {
    await rm(OUT_DIR, { recursive: true });
  }
  await mkdir(OUT_DIR, { recursive: true });

  // Scan raw exports
  const pngFiles = await fg("**/*.png", { cwd: RAW_DIR });
  const svgFiles = await fg("**/*.svg", { cwd: RAW_DIR });

  // Sort for deterministic output
  pngFiles.sort();
  svgFiles.sort();

  // Process PNGs
  for (const file of pngFiles) {
    const fullPath = path.join(RAW_DIR, file);
    const basename = path.basename(file, ".png");

    try {
      const img = sharp(fullPath);
      const meta = await img.metadata();
      const w = meta.width!;
      const h = meta.height!;

      // Dimension warnings
      if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
        warnings.push(`${file}: dimensions ${w}x${h} exceed ${MAX_DIMENSION}px`);
      }

      // Pixel budget
      if (w * h > MAX_PIXELS && !PIXEL_ALLOWLIST.includes(basename)) {
        errors.push(`${file}: ${w * h} pixels exceeds ${MAX_PIXELS} limit`);
        continue;
      }

      // Generate AVIF + WebP
      const avifPath = path.join(OUT_DIR, `${basename}.avif`);
      const webpPath = path.join(OUT_DIR, `${basename}.webp`);

      await sharp(fullPath)
        .avif({ quality: AVIF_QUALITY })
        .toFile(avifPath);

      await sharp(fullPath)
        .webp({ quality: WEBP_QUALITY })
        .toFile(webpPath);

      assets.push({
        key: basename,
        avif: `/assets/ui/${basename}.avif`,
        webp: `/assets/ui/${basename}.webp`,
        width: w,
        height: h,
      });

      // Handle @2x → @1x downscale
      if (basename.endsWith("@2x")) {
        const baseKey = basename.replace(/@2x$/, "");
        const halfW = Math.round(w / 2);
        const halfH = Math.round(h / 2);

        const avif1x = path.join(OUT_DIR, `${baseKey}@1x.avif`);
        const webp1x = path.join(OUT_DIR, `${baseKey}@1x.webp`);

        await sharp(fullPath)
          .resize(halfW, halfH)
          .avif({ quality: AVIF_QUALITY })
          .toFile(avif1x);

        await sharp(fullPath)
          .resize(halfW, halfH)
          .webp({ quality: WEBP_QUALITY })
          .toFile(webp1x);

        assets.push({
          key: `${baseKey}@1x`,
          avif: `/assets/ui/${baseKey}@1x.avif`,
          webp: `/assets/ui/${baseKey}@1x.webp`,
          width: halfW,
          height: halfH,
        });
      }
    } catch (err) {
      errors.push(`${file}: processing failed — ${err}`);
    }
  }

  // Process SVGs
  for (const file of svgFiles) {
    const fullPath = path.join(RAW_DIR, file);
    const basename = path.basename(file, ".svg");

    try {
      const raw = await readFile(fullPath, "utf-8");
      const result = optimize(raw, {
        path: fullPath,
        ...SVGO_CONFIG,
      });

      const outPath = path.join(OUT_DIR, `${basename}.svg`);
      await writeFile(outPath, result.data, "utf-8");

      // Parse width/height from SVG if present
      const wMatch = raw.match(/width="(\d+)"/);
      const hMatch = raw.match(/height="(\d+)"/);

      assets.push({
        key: basename,
        svg: `/assets/ui/${basename}.svg`,
        width: wMatch ? parseInt(wMatch[1], 10) : undefined,
        height: hMatch ? parseInt(hMatch[1], 10) : undefined,
      });
    } catch (err) {
      errors.push(`${file}: SVG optimization failed — ${err}`);
    }
  }

  // Sort assets by key for deterministic manifest
  assets.sort((a, b) => a.key.localeCompare(b.key));

  // Budget check: output file sizes
  const outputFiles = await fg("**/*", { cwd: OUT_DIR, stats: true });
  for (const entry of outputFiles) {
    // fast-glob with stats returns stats on the entry
    const filePath = path.join(OUT_DIR, entry.path);
    const { size } = await import("fs").then((fs) =>
      fs.promises.stat(filePath)
    );
    if (size > MAX_FILE_SIZE) {
      errors.push(
        `${entry.path}: ${(size / 1024).toFixed(1)}KB exceeds ${MAX_FILE_SIZE / 1024}KB budget`
      );
    }
  }

  // Generate manifest
  await generateManifest(assets);

  return { assets, warnings, errors };
}

// ---- Manifest generator ----

async function generateManifest(assets: AssetEntry[]): Promise<void> {
  await mkdir(path.dirname(MANIFEST_PATH), { recursive: true });

  const keys = assets.map((a) => `  | "${a.key}"`).join("\n");

  const entries = assets
    .map((a) => {
      const fields: string[] = [];
      if (a.avif) fields.push(`avif: "${a.avif}"`);
      if (a.webp) fields.push(`webp: "${a.webp}"`);
      if (a.svg) fields.push(`svg: "${a.svg}"`);
      if (a.width != null) fields.push(`width: ${a.width}`);
      if (a.height != null) fields.push(`height: ${a.height}`);
      return `  "${a.key}": { ${fields.join(", ")} }`;
    })
    .join(",\n");

  const code = `/**
 * AUTO-GENERATED by scripts/assets-build.ts — do not edit manually.
 * Run \`npm run assets:build\` to regenerate.
 */

export type AssetKey =
${keys};

export interface AssetMeta {
  avif?: string;
  webp?: string;
  svg?: string;
  width?: number;
  height?: number;
}

export const assets: Record<AssetKey, AssetMeta> = {
${entries},
};

/**
 * Get the best available source URL for an asset.
 * Preference: avif > webp > svg.
 */
export function assetSrc(key: AssetKey): string {
  const a = assets[key];
  return a.avif ?? a.webp ?? a.svg ?? "";
}
`;

  await writeFile(MANIFEST_PATH, code, "utf-8");
}

// ---- CLI entry ----

if (process.argv[1]?.endsWith("assets-build.ts") || process.argv[1]?.endsWith("assets-build")) {
  buildAssets().then((result) => {
    for (const w of result.warnings) {
      console.warn(`⚠ ${w}`);
    }
    for (const e of result.errors) {
      console.error(`✗ ${e}`);
    }
    console.log(
      `✓ ${result.assets.length} assets built (${result.errors.length} errors, ${result.warnings.length} warnings)`
    );
    if (result.errors.length > 0) {
      process.exit(1);
    }
  });
}
