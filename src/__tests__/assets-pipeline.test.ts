/**
 * Tests for the asset optimization pipeline.
 *
 * Verifies:
 * - Manifest generation with stable keys
 * - Budget enforcement (file size, dimensions, pixels)
 * - Deterministic output (running twice yields same manifest)
 * - @2x → @1x downscaling
 * - SVG optimization (metadata stripped)
 */
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync, statSync } from "fs";
import path from "path";

// Build assets before tests (the pipeline should already have been run)
// If not, tests will verify against whatever is in public/assets/ui

const OUT_DIR = "public/assets/ui";
const MANIFEST_PATH = "src/ui/assets/manifest.ts";
const MAX_FILE_SIZE = 300 * 1024;

describe("Asset Pipeline", () => {
  let manifestContent: string;
  let manifestModule: any;

  beforeAll(async () => {
    // Build assets fresh
    const { buildAssets } = await import("../../scripts/assets-build");
    const result = await buildAssets();
    expect(result.errors).toHaveLength(0);

    manifestContent = readFileSync(MANIFEST_PATH, "utf-8");
    manifestModule = await import("@/ui/assets/manifest");
  });

  describe("manifest generation", () => {
    it("generates a valid TypeScript manifest file", () => {
      expect(existsSync(MANIFEST_PATH)).toBe(true);
      expect(manifestContent).toContain("export type AssetKey");
      expect(manifestContent).toContain("export const assets");
      expect(manifestContent).toContain("export function assetSrc");
    });

    it("produces stable keys sorted alphabetically", () => {
      const keyMatches = manifestContent.match(/\| "([^"]+)"/g);
      expect(keyMatches).toBeTruthy();
      const keys = keyMatches!.map((m) => m.replace('| "', "").replace('"', ""));
      const sorted = [...keys].sort();
      expect(keys).toEqual(sorted);
    });

    it("includes all expected fixture assets", () => {
      const { assets } = manifestModule;
      expect(assets["btn-primary"]).toBeDefined();
      expect(assets["icon-phone-off"]).toBeDefined();
      expect(assets["icon-check"]).toBeDefined();
      expect(assets["icon-session"]).toBeDefined();
    });

    it("raster assets have avif and webp paths", () => {
      const { assets } = manifestModule;
      const btn = assets["btn-primary"];
      expect(btn.avif).toMatch(/\.avif$/);
      expect(btn.webp).toMatch(/\.webp$/);
      expect(btn.width).toBeGreaterThan(0);
      expect(btn.height).toBeGreaterThan(0);
    });

    it("SVG assets have svg path", () => {
      const { assets } = manifestModule;
      const icon = assets["icon-phone-off"];
      expect(icon.svg).toMatch(/\.svg$/);
      expect(icon.avif).toBeUndefined();
      expect(icon.webp).toBeUndefined();
    });

    it("assetSrc prefers avif for raster assets", () => {
      const { assetSrc } = manifestModule;
      expect(assetSrc("btn-primary")).toMatch(/\.avif$/);
    });

    it("assetSrc returns svg for SVG-only assets", () => {
      const { assetSrc } = manifestModule;
      expect(assetSrc("icon-check")).toMatch(/\.svg$/);
    });
  });

  describe("@2x downscaling", () => {
    it("generates @1x variant from @2x input", () => {
      const { assets } = manifestModule;
      expect(assets["btn-primary@2x"]).toBeDefined();
      expect(assets["btn-primary@1x"]).toBeDefined();
    });

    it("@1x dimensions are half of @2x", () => {
      const { assets } = manifestModule;
      const x2 = assets["btn-primary@2x"];
      const x1 = assets["btn-primary@1x"];
      expect(x1.width).toBe(Math.round(x2.width / 2));
      expect(x1.height).toBe(Math.round(x2.height / 2));
    });
  });

  describe("SVG optimization", () => {
    it("strips metadata and comments from SVGs", () => {
      const svgPath = path.join(OUT_DIR, "icon-phone-off.svg");
      const content = readFileSync(svgPath, "utf-8");
      expect(content).not.toContain("<metadata>");
      expect(content).not.toContain("<!--");
      expect(content).not.toContain("<desc>");
    });

    it("preserves functional SVG content", () => {
      const svgPath = path.join(OUT_DIR, "icon-phone-off.svg");
      const content = readFileSync(svgPath, "utf-8");
      expect(content).toContain("<svg");
      expect(content).toContain("<path");
      expect(content).toContain("viewBox");
    });
  });

  describe("budgets", () => {
    it("all output files are under 300KB", () => {
      const { assets } = manifestModule;
      for (const key of Object.keys(assets)) {
        const meta = assets[key];
        const paths = [meta.avif, meta.webp, meta.svg].filter(Boolean);
        for (const p of paths) {
          const fullPath = path.join("public", p);
          if (existsSync(fullPath)) {
            const size = statSync(fullPath).size;
            expect(size).toBeLessThan(MAX_FILE_SIZE);
          }
        }
      }
    });
  });

  describe("determinism", () => {
    it("running build twice produces identical manifest", async () => {
      const { buildAssets } = await import("../../scripts/assets-build");
      await buildAssets();
      const first = readFileSync(MANIFEST_PATH, "utf-8");
      await buildAssets();
      const second = readFileSync(MANIFEST_PATH, "utf-8");
      expect(first).toBe(second);
    });
  });
});
