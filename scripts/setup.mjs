#!/usr/bin/env node
/**
 * Study Bot one-shot setup.
 *
 *   npm run setup
 *
 * What it does:
 *   1. Copies .env.example -> .env (never overwrites an existing .env).
 *   2. Generates NEXTAUTH_SECRET and TOKEN_ENC_KEY where they
 *      are empty (user-set values are never touched).
 *   3. Starts the Postgres container via Docker Compose (if Docker is
 *      available) and waits for its healthcheck.
 *   4. Applies Prisma migrations and generates the Prisma client.
 *
 * Cross-platform (macOS / Linux / Windows), no dependencies beyond Node.
 */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
const examplePath = join(root, ".env.example");

// ---------------------------------------------------------------------------
// 0. Node version check (Next.js 14 + this script need Node 20.19+)
// ---------------------------------------------------------------------------
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
if (nodeMajor < 20 || (nodeMajor === 20 && nodeMinor < 19)) {
  console.error(
    `Setup failed: Node ${process.versions.node} is too old — this project requires Node 20.19 or newer, so install a current Node LTS and re-run npm run setup.`,
  );
  process.exit(1);
}

// On Windows, docker/npx are .cmd shims and need a shell to resolve.
const useShell = process.platform === "win32";

const log = (msg = "") => console.log(msg);
const step = (msg) => console.log(`\n=> ${msg}`);
const ok = (msg) => console.log(`   ok    ${msg}`);
const warn = (msg) => console.log(`   note  ${msg}`);
const die = (msg) => {
  console.error(`\nSetup failed: ${msg}`);
  process.exit(1);
};

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    cwd: root,
    shell: useShell,
    encoding: "utf8",
    ...opts,
  });
}

// Synchronous cross-platform sleep (no child processes needed).
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// ---------------------------------------------------------------------------
// 1. Create .env from .env.example (never overwrite)
// ---------------------------------------------------------------------------
step("Environment file");
if (existsSync(envPath)) {
  ok(".env already exists — leaving your values untouched");
} else {
  if (!existsSync(examplePath)) die(".env.example not found — cannot create .env");
  copyFileSync(examplePath, envPath);
  ok("created .env from .env.example");
}

// ---------------------------------------------------------------------------
// 2. Fill in generated secrets where the value is empty
//    (matches `KEY=""`, `KEY=''` or `KEY=` — never a user-set value)
// ---------------------------------------------------------------------------
const SECRET_GENERATORS = {
  NEXTAUTH_SECRET: () => randomBytes(32).toString("base64"),
  TOKEN_ENC_KEY: () => randomBytes(32).toString("hex"),
};

let envText = readFileSync(envPath, "utf8");
for (const [key, generate] of Object.entries(SECRET_GENERATORS)) {
  const emptyAssignment = new RegExp(`^(${key}=)(""|''|)([ \\t]*(?:#.*)?)$`, "m");
  if (emptyAssignment.test(envText)) {
    const value = generate();
    envText = envText.replace(
      emptyAssignment,
      (_match, prefix, _empty, trailer) => `${prefix}"${value}"${trailer}`,
    );
    ok(`generated ${key}`);
  } else if (new RegExp(`^${key}=`, "m").test(envText)) {
    ok(`${key} already set — keeping your value`);
  } else {
    warn(`${key} not found in .env — add it manually if you need it`);
  }
}
try {
  writeFileSync(envPath, envText);
} catch (err) {
  die(`could not write .env: ${err.message}`);
}

// ---------------------------------------------------------------------------
// 3. Load .env into process.env for child processes (minimal parser;
//    real environment variables win over .env values)
// ---------------------------------------------------------------------------
function parseEnv(text) {
  const result = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2];
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      const closing = value.indexOf(quote, 1);
      value = closing === -1 ? value.slice(1) : value.slice(1, closing);
    } else {
      const comment = value.indexOf(" #");
      if (comment !== -1) value = value.slice(0, comment);
      value = value.trim();
    }
    result[match[1]] = value;
  }
  return result;
}

const parsedEnv = parseEnv(envText);
for (const [key, value] of Object.entries(parsedEnv)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

// ---------------------------------------------------------------------------
// 4. Start the database via Docker Compose (optional but recommended)
// ---------------------------------------------------------------------------
function explainNoDocker(reason) {
  warn(reason);
  log("");
  log("   Docker is optional. To use your own Postgres instead:");
  log("     1. Point DATABASE_URL in .env at your database.");
  log("     2. Run: npx prisma migrate deploy");
  log("");
  log("   Or install Docker Desktop and re-run: npm run setup");
}

function waitForHealthy(timeoutMs) {
  const startedAt = Date.now();
  process.stdout.write("   waiting for Postgres healthcheck ");
  while (Date.now() - startedAt < timeoutMs) {
    const ps = run("docker", ["compose", "ps", "--format", "json", "db"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (ps.status === 0 && ps.stdout) {
      const text = ps.stdout.trim();
      // Compose emits either a single JSON object, an array, or NDJSON lines
      // depending on version — handle all three.
      let entries = [];
      try {
        const parsed = JSON.parse(text);
        entries = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        entries = text
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => {
            try {
              return JSON.parse(line);
            } catch {
              return null;
            }
          })
          .filter(Boolean);
      }
      const health = ((entries[0] || {}).Health || "").toLowerCase();
      if (health === "healthy") {
        process.stdout.write(" healthy\n");
        return true;
      }
    }
    process.stdout.write(".");
    sleep(2000);
  }
  process.stdout.write(" timed out\n");
  return false;
}

step("Database (Docker)");
let dbHealthy = false;
const composeCheck = run("docker", ["compose", "version"], {
  stdio: ["ignore", "pipe", "pipe"],
});
if (composeCheck.status !== 0 || composeCheck.error) {
  explainNoDocker("Docker Compose not found — skipping database startup.");
} else {
  const up = run("docker", ["compose", "up", "-d", "db"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (up.status !== 0) {
    const detail = (up.stderr || "").trim().split(/\r?\n/).pop() || "unknown error";
    explainNoDocker(`Docker is installed but not usable (${detail}) — skipping database startup.`);
  } else {
    ok("started the db container (host port 5433)");
    dbHealthy = waitForHealthy(60_000);
    if (!dbHealthy) {
      warn("Postgres did not report healthy in time — check: npm run db:logs");
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Prisma: migrations + client
// ---------------------------------------------------------------------------
step("Database migrations (prisma migrate deploy)");
const migrate = run("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit" });
const migrated = migrate.status === 0;
if (migrated) {
  ok("migrations applied");
} else {
  warn("database not reachable — start Postgres and run: npx prisma migrate deploy");
}

step("Prisma client (prisma generate)");
const generate = run("npx", ["prisma", "generate"], { stdio: "inherit" });
const generated = generate.status === 0;
if (generated) {
  ok("Prisma client generated");
} else {
  warn("prisma generate failed — run it manually: npx prisma generate");
}

// ---------------------------------------------------------------------------
// 6. Summary
// ---------------------------------------------------------------------------
log("");
log("----------------------------------------------------------");
log("Setup complete.");
if (!migrated || !generated) {
  log("");
  log("Still to do before the app will run:");
  if (!migrated) {
    log("  - Start Postgres (npm run db:up, or your own server on the");
    log("    DATABASE_URL in .env), then: npx prisma migrate deploy");
  }
  if (!generated) log("  - npx prisma generate");
}
if (parsedEnv.AI_PROVIDER === "mock") {
  log("");
  log("Heads up: AI_PROVIDER is \"mock\" in .env. Mock mode exists for tests —");
  log("sessions get template questions and canned feedback. For real studying,");
  log("set AI_PROVIDER=openai and add an OPENAI_API_KEY in .env.");
}
log("");
log("Next steps:");
log("  npm run dev       start the app  ->  http://localhost:3000");
log("  npm run worker    (optional) background job worker");
log("  npm test          run the test suite");
log("----------------------------------------------------------");
