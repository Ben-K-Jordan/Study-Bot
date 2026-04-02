/**
 * Asset budget checker.
 *
 * Validates that all optimized assets meet size/dimension budgets.
 * Run via: npx tsx scripts/assets-check.ts
 * Used in CI to prevent regressions.
 */
import { stat } from "fs/promises";
import path from "path";
import fg from "fast-glob";
import sharp from "sharp";

const OUT_DIR = "public/assets/ui";

const MAX_FILE_SIZE = 300 * 1024; // 300KB
const MAX_DIMENSION = 2000;
const MAX_PIXELS = 4_000_000;
const PIXEL_ALLOWLIST: string[] = [];

export interface CheckResult {
  total: number;
  warnings: string[];
  errors: string[];
}

export async function checkAssets(): Promise<CheckResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  const files = await fg("**/*", { cwd: OUT_DIR });
  files.sort();

  for (const file of files) {
    const filePath = path.join(OUT_DIR, file);
    const stats = await stat(filePath);

    // Size budget
    if (stats.size > MAX_FILE_SIZE) {
      errors.push(
        `${file}: ${(stats.size / 1024).toFixed(1)}KB exceeds ${MAX_FILE_SIZE / 1024}KB limit`
      );
    }

    // Dimension checks for raster images
    const ext = path.extname(file).toLowerCase();
    if (ext === ".avif" || ext === ".webp" || ext === ".png") {
      try {
        const meta = await sharp(filePath).metadata();
        const w = meta.width ?? 0;
        const h = meta.height ?? 0;

        if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
          warnings.push(`${file}: ${w}x${h} exceeds ${MAX_DIMENSION}px`);
        }

        const basename = path.basename(file, ext);
        if (w * h > MAX_PIXELS && !PIXEL_ALLOWLIST.includes(basename)) {
          errors.push(`${file}: ${w * h} pixels exceeds ${MAX_PIXELS} limit`);
        }
      } catch {
        // Non-image file, skip dimension check
      }
    }
  }

  return { total: files.length, warnings, errors };
}

// CLI entry
if (process.argv[1]?.endsWith("assets-check.ts") || process.argv[1]?.endsWith("assets-check")) {
  checkAssets().then((result) => {
    for (const w of result.warnings) {
      console.warn(`⚠ ${w}`);
    }
    for (const e of result.errors) {
      console.error(`✗ ${e}`);
    }
    console.log(`✓ ${result.total} assets checked (${result.errors.length} errors, ${result.warnings.length} warnings)`);
    if (result.errors.length > 0) {
      process.exit(1);
    }
  });
}
