/**
 * Guards for the tsx scripts under scripts/. They run outside Next, so they
 * neither load .env on their own nor share the app's question templates
 * unless they import them. These checks read the source, so they need no
 * database and run in `npm run test:unit`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const root = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

/** The first `import` statement in a file, ignoring comments and the shebang. */
function firstImport(source: string): string | undefined {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("import "));
}

describe("scripts that read the database load .env first", () => {
  // tsx does not read .env the way Next does. Without dotenv these scripts
  // saw DATABASE_URL and AI_PROVIDER as unset, and Prisma fell back to
  // libpq defaults instead of the configured database.
  it.each(["scripts/worker.ts", "scripts/seed-research.ts"])("%s", (file) => {
    expect(firstImport(read(file))).toBe('import "dotenv/config";');
  });

  it("seed-demo.ts still requires an explicit DATABASE_URL", () => {
    // It refuses any database whose name lacks "demo", so it must not pick
    // up the dev database from .env.
    expect(read("scripts/seed-demo.ts")).not.toMatch(/dotenv/);
  });
});

describe("seed-demo.ts writes the app's own question text", () => {
  const source = read("scripts/seed-demo.ts");

  it("uses the shared pretest, review and repair templates", () => {
    for (const fn of ["pretestQuestionText(", "reviewQuestionText(", "crossSessionRepairText("]) {
      expect(source).toContain(fn);
    }
  });

  it("keeps none of the pre-redesign templates", () => {
    for (const legacy of [
      "Diagnostic:",
      "Before we dive in",
      "Quick review",
      "Error repair (from",
      "key concept behind",
      "You missed this question",
    ]) {
      expect(source).not.toContain(legacy);
    }
  });

  it("names review topics by title, falling back to the readable key", () => {
    expect(source).toContain("humanizeObjectiveKey(m.key)");
  });
});
