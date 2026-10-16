#!/usr/bin/env tsx
/**
 * Screenshot harness for reviewing the app with realistic data.
 *
 * Signs in as the demo user through the real sign-in page, then captures
 * every route at each viewport and color scheme with animations disabled.
 * It does not start the app: run `npm run dev` (or `npm start`) against the
 * demo database first, seeded with scripts/seed-demo.ts.
 *
 * Usage:
 *   npx tsx scripts/screenshots.ts --base http://localhost:3000 --out <dir>
 *     [--routes /,/plan,/learn]        signed-in routes (default: every app page)
 *     [--signed-out-routes /auth/signin] captured without a session ("" to skip)
 *     [--themes light,dark] [--viewports desktop,mobile] [--full-page]
 *     [--email demo@studybot.local] [--password study-bot-demo]
 *     [--test-auth <userId>]           fall back to the X-User-Id header if sign-in
 *                                      fails (server needs ALLOW_TEST_AUTH=true and a
 *                                      localhost NEXTAUTH_URL; start it with -H 127.0.0.1)
 *     [--no-signin]                    skip the sign-in page, use --test-auth only
 *     [--session] [--session-id <id>]  also capture today's session: preflight,
 *                                      then the first question (this starts a run;
 *                                      reseed afterwards to reset the demo)
 *     [--theme-key <key>]              also write the theme to localStorage[key]
 *     [--dpr <n>] [--settle <ms>] [--timeout <ms>] [--headed]
 *
 * Files are written as <out>/<route-slug>-<viewport>-<theme>.png, with a
 * manifest.json listing each capture, its HTTP status and console errors.
 *
 * Exit codes: 0 all captured, 1 some captures failed, 2 sign-in failed,
 * 64 bad arguments.
 */
import { mkdir, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";

type Theme = "light" | "dark";
type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

interface ViewportSpec {
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
}

const VIEWPORTS: Record<string, ViewportSpec> = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

const DEFAULT_ROUTES = ["/", "/plan", "/learn", "/flashcards", "/guides", "/chat", "/achievements", "/settings"];
const DEFAULT_SIGNED_OUT_ROUTES = ["/auth/signin", "/auth/signup", "/auth/forgot-password"];
const DEMO_TIMEZONE = "America/New_York";

const NO_MOTION_CSS = [
  "*, *::before, *::after {",
  "  animation-duration: 0s !important;",
  "  animation-delay: 0s !important;",
  "  animation-iteration-count: 1 !important;",
  "  transition-duration: 0s !important;",
  "  transition-delay: 0s !important;",
  "  scroll-behavior: auto !important;",
  "  caret-color: transparent !important;",
  "}",
].join("\n");

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

interface Options {
  base: string;
  out: string;
  routes: string[];
  signedOutRoutes: string[];
  themes: Theme[];
  viewports: string[];
  fullPage: boolean;
  email: string;
  password: string;
  testAuth: string | null;
  noSignin: boolean;
  session: boolean;
  sessionId: string | null;
  themeKey: string | null;
  dpr: number | null;
  settle: number;
  timeout: number;
  headed: boolean;
}

function usageError(message: string): never {
  console.error(`screenshots: ${message}\nRun with --help for usage.`);
  process.exit(64);
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Git Bash on Windows rewrites arguments that start with "/" into Windows
 * paths ("/plan" arrives as "C:/Program Files/Git/plan"). Undo that, and
 * accept routes written without the leading slash.
 */
function normalizeRoute(raw: string): string {
  const msys = raw.match(/^[A-Za-z]:[\\/](?:.*[\\/])?Git([\\/].*)?$/i);
  const route = msys ? (msys[1] ?? "/").replace(/\\/g, "/") : raw;
  return route.startsWith("/") ? route : `/${route}`;
}

function parseArgs(argv: string[]): Options {
  const flags = new Set(["--full-page", "--no-signin", "--session", "--headed", "--help"]);
  const values = new Map<string, string>();
  const seen = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) usageError(`unexpected argument "${arg}"`);
    const eq = arg.indexOf("=");
    const name = eq > 0 ? arg.slice(0, eq) : arg;
    if (flags.has(name)) {
      seen.add(name);
      continue;
    }
    const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
    if (value === undefined) usageError(`${name} needs a value`);
    values.set(name, value);
  }
  if (seen.has("--help")) {
    console.log(
      "Usage: npx tsx scripts/screenshots.ts --base http://localhost:3000 --out <dir> " +
        "[--routes /,/plan] [--signed-out-routes /auth/signin] [--themes light,dark] " +
        "[--viewports desktop,mobile] [--full-page] [--email <email>] [--password <password>] " +
        "[--test-auth <userId>] [--no-signin] [--session] [--session-id <id>] [--theme-key <key>] " +
        "[--dpr <n>] [--settle <ms>] [--timeout <ms>] [--headed]",
    );
    process.exit(0);
  }

  const known = new Set([
    "--base", "--out", "--routes", "--signed-out-routes", "--themes", "--viewports", "--email",
    "--password", "--test-auth", "--session-id", "--theme-key", "--dpr", "--settle", "--timeout",
  ]);
  for (const name of values.keys()) if (!known.has(name)) usageError(`unknown option ${name}`);

  const base = (values.get("--base") ?? "http://localhost:3000").replace(/\/+$/, "");
  try {
    new URL(base);
  } catch {
    usageError(`--base "${base}" is not a URL`);
  }

  const routes = values.has("--routes") ? splitList(values.get("--routes")!).map(normalizeRoute) : DEFAULT_ROUTES;
  const signedOutRoutes = values.has("--signed-out-routes")
    ? splitList(values.get("--signed-out-routes")!).map(normalizeRoute)
    : DEFAULT_SIGNED_OUT_ROUTES;

  const themes = splitList(values.get("--themes") ?? "light,dark");
  for (const t of themes) if (t !== "light" && t !== "dark") usageError(`unknown theme "${t}" (use light, dark)`);

  const viewports = splitList(values.get("--viewports") ?? "desktop,mobile");
  for (const v of viewports) {
    if (!VIEWPORTS[v]) usageError(`unknown viewport "${v}" (use ${Object.keys(VIEWPORTS).join(", ")})`);
  }

  const num = (name: string, fallback: number) => {
    const raw = values.get(name);
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) usageError(`${name} must be a non-negative number`);
    return n;
  };

  const testAuth = values.get("--test-auth") ?? null;
  const noSignin = seen.has("--no-signin");
  if (noSignin && !testAuth) usageError("--no-signin needs --test-auth <userId>");

  return {
    base,
    out: resolve(values.get("--out") ?? join("test-results", "screenshots")),
    routes,
    signedOutRoutes,
    themes: themes as Theme[],
    viewports,
    fullPage: seen.has("--full-page"),
    email: values.get("--email") ?? "demo@studybot.local",
    password: values.get("--password") ?? "study-bot-demo",
    testAuth,
    noSignin,
    session: seen.has("--session") || values.has("--session-id"),
    sessionId: values.get("--session-id") ?? null,
    themeKey: values.get("--theme-key") ?? null,
    dpr: values.has("--dpr") ? num("--dpr", 1) || 1 : null,
    settle: num("--settle", 400),
    timeout: num("--timeout", 30_000),
    headed: seen.has("--headed"),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function routeSlug(route: string): string {
  if (route === "/" || route === "") return "home";
  const slug = route
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug || "home";
}

async function firstVisible(candidates: Locator[], timeoutMs: number): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const c of candidates) {
      const first = c.first();
      if ((await first.count()) > 0 && (await first.isVisible().catch(() => false))) return first;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

interface AuthMode {
  kind: "session" | "header";
  storageState?: StorageState;
  userId?: string;
}

interface CaptureRecord {
  name: string;
  route: string;
  viewport: string;
  theme: Theme;
  file: string | null;
  status: number | null;
  finalUrl: string | null;
  consoleErrors: string[];
  pageErrors: string[];
  warnings: string[];
  error: string | null;
  ms: number;
}

class Harness {
  readonly records: CaptureRecord[] = [];

  constructor(
    private readonly browser: Browser,
    private readonly opts: Options,
  ) {}

  async newContext(viewport: string, theme: Theme, auth: AuthMode | null): Promise<BrowserContext> {
    const vp = VIEWPORTS[viewport];
    const context = await this.browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: this.opts.dpr ?? vp.deviceScaleFactor,
      isMobile: vp.isMobile,
      hasTouch: vp.hasTouch,
      colorScheme: theme,
      reducedMotion: "reduce",
      locale: "en-US",
      timezoneId: DEMO_TIMEZONE,
      storageState: auth?.kind === "session" ? auth.storageState : undefined,
      extraHTTPHeaders: auth?.kind === "header" && auth.userId ? { "X-User-Id": auth.userId } : undefined,
    });
    // Passed as source text, not a function: tsx compiles named functions with
    // a __name() helper that doesn't exist in the page.
    await context.addInitScript({
      content: `(() => {
        const css = ${JSON.stringify(NO_MOTION_CSS)};
        const themeKey = ${JSON.stringify(this.opts.themeKey)};
        if (themeKey) {
          try { localStorage.setItem(themeKey, ${JSON.stringify(theme)}); } catch (e) {}
        }
        const add = () => {
          if (document.getElementById("__screenshot_no_motion")) return;
          const style = document.createElement("style");
          style.id = "__screenshot_no_motion";
          style.textContent = css;
          (document.head || document.documentElement).appendChild(style);
        };
        if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add);
        else add();
      })();`,
    });
    return context;
  }

  /** Navigate, let the page settle, and save one screenshot. */
  async capture(
    context: BrowserContext,
    name: string,
    route: string,
    viewport: string,
    theme: Theme,
    options: { expectSignedIn: boolean; prepare?: (page: Page) => Promise<string[]> },
  ): Promise<CaptureRecord> {
    const started = Date.now();
    const record: CaptureRecord = {
      name,
      route,
      viewport,
      theme,
      file: null,
      status: null,
      finalUrl: null,
      consoleErrors: [],
      pageErrors: [],
      warnings: [],
      error: null,
      ms: 0,
    };
    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") record.consoleErrors.push(msg.text().slice(0, 500));
    });
    page.on("pageerror", (err) => record.pageErrors.push(String(err).slice(0, 500)));
    try {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      const response = await page.goto(this.opts.base + route, { waitUntil: "load", timeout: this.opts.timeout });
      record.status = response?.status() ?? null;
      await page
        .waitForLoadState("networkidle", { timeout: this.opts.timeout })
        .catch(() => record.warnings.push("network did not go idle"));
      record.finalUrl = page.url();
      if (options.expectSignedIn && new URL(page.url()).pathname.startsWith("/auth/")) {
        throw new Error(`redirected to ${new URL(page.url()).pathname}: the session was not accepted`);
      }
      if (options.prepare) record.warnings.push(...(await options.prepare(page)));
      // Source text again (see newContext): wait for web fonts, and confirm
      // the no-motion stylesheet made it into the page.
      const motionOff = await page.evaluate(
        "document.fonts.ready.then(() => Boolean(document.getElementById('__screenshot_no_motion')))",
      );
      if (!motionOff) record.warnings.push("animation-disabling stylesheet missing");
      if (this.opts.settle > 0) await page.waitForTimeout(this.opts.settle);
      const file = join(this.opts.out, `${name}-${viewport}-${theme}.png`);
      await page.screenshot({
        path: file,
        fullPage: this.opts.fullPage,
        animations: "disabled",
        caret: "hide",
        timeout: this.opts.timeout,
      });
      record.file = file;
    } catch (err) {
      record.error = err instanceof Error ? err.message.split("\n")[0] : String(err);
    } finally {
      record.ms = Date.now() - started;
      await page.close().catch(() => {});
    }
    this.records.push(record);
    const status = record.error
      ? `FAILED: ${record.error}`
      : `${record.status ?? "-"}${record.consoleErrors.length ? `, ${record.consoleErrors.length} console errors` : ""}${
          record.warnings.length ? `, ${record.warnings.join("; ")}` : ""
        }`;
    console.log(`  ${name}-${viewport}-${theme}.png  ${status}`);
    return record;
  }
}

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------

async function signIn(browser: Browser, opts: Options): Promise<{ state: StorageState } | { reason: string }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "en-US" });
  const page = await context.newPage();
  try {
    const response = await page.goto(`${opts.base}/auth/signin`, { waitUntil: "load", timeout: opts.timeout });
    if (!response || response.status() >= 400) {
      return { reason: `/auth/signin returned HTTP ${response?.status() ?? "no response"}` };
    }
    await page.waitForLoadState("networkidle", { timeout: opts.timeout }).catch(() => {});

    const emailField = await firstVisible(
      [page.getByLabel(/^email( address)?$/i), page.locator('input[type="email"]'), page.locator('input[name="email"]')],
      opts.timeout / 2,
    );
    const passwordField = await firstVisible(
      [page.getByLabel(/^password$/i), page.locator('input[type="password"]')],
      opts.timeout / 4,
    );
    if (!emailField || !passwordField) {
      return { reason: "couldn't find the email and password fields on /auth/signin" };
    }
    await emailField.fill(opts.email);
    await passwordField.fill(opts.password);

    const submit = page.getByRole("button", { name: /^sign in$/i });
    if ((await submit.count()) > 0) await submit.first().click();
    else await passwordField.press("Enter");

    try {
      await page.waitForURL((url) => !url.pathname.startsWith("/auth/"), { timeout: opts.timeout });
    } catch {
      const alert = await page
        .getByRole("alert")
        .first()
        .textContent({ timeout: 1000 })
        .catch(() => null);
      return {
        reason: `still on ${new URL(page.url()).pathname} after submitting${alert?.trim() ? ` ("${alert.trim()}")` : ""}`,
      };
    }

    const session = await context.request
      .get(`${opts.base}/api/auth/session`)
      .then((r) => r.json() as Promise<{ user?: { email?: string } }>)
      .catch(() => null);
    if (!session?.user) return { reason: "signed in, but /api/auth/session has no user" };
    return { state: await context.storageState() };
  } catch (err) {
    return { reason: err instanceof Error ? err.message.split("\n")[0] : String(err) };
  } finally {
    await context.close();
  }
}

async function checkHeaderAuth(browser: Browser, opts: Options, userId: string): Promise<string | null> {
  const context = await browser.newContext({ extraHTTPHeaders: { "X-User-Id": userId } });
  try {
    const res = await context.request.get(`${opts.base}/api/stats/game`);
    if (res.ok()) return null;
    return `GET /api/stats/game returned ${res.status()} with X-User-Id (the server needs ALLOW_TEST_AUTH=true)`;
  } catch (err) {
    return err instanceof Error ? err.message.split("\n")[0] : String(err);
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------
// Session screens
// ---------------------------------------------------------------------------

interface PlanListItem {
  status: string;
  start_time: string;
  session_id: string;
  course_name: string;
}

async function findTodaySession(context: BrowserContext, opts: Options): Promise<string | null> {
  if (opts.sessionId) return opts.sessionId;
  const res = await context.request.get(`${opts.base}/api/plans`);
  if (!res.ok()) return null;
  const body = (await res.json()) as { plans?: { items: PlanListItem[] }[] };
  const dayKey = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: DEMO_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const today = dayKey(new Date());
  const items = (body.plans ?? [])
    .flatMap((p) => p.items)
    .filter((i) => i.status === "SCHEDULED")
    .sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time));
  const todays = items.find((i) => dayKey(new Date(i.start_time)) === today);
  return (todays ?? items.find((i) => Date.parse(i.start_time) > Date.now()) ?? null)?.session_id ?? null;
}

/** Start or resume the session and wait until a question is on screen. */
async function openFirstQuestion(page: Page, timeout: number): Promise<string[]> {
  const warnings: string[] = [];
  const questionCandidates = () => [
    page.getByRole("textbox"),
    page.getByRole("radio"),
    page.getByText(/question \d+ of \d+|prompt \d+ \/ \d+/i),
  ];
  // A resumed run may already show the question; otherwise start or resume it.
  if (!(await firstVisible(questionCandidates(), 1000))) {
    const start = page.getByRole("button", { name: /start session|resume session/i });
    if ((await start.count()) > 0) await start.first().click();
    else warnings.push("no Start or Resume button found");
    if (!(await firstVisible(questionCandidates(), timeout))) warnings.push("no question appeared");
  }
  await page.waitForLoadState("networkidle", { timeout }).catch(() => {});
  return warnings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await mkdir(opts.out, { recursive: true });

  const browser = await chromium.launch({ headless: !opts.headed });
  const harness = new Harness(browser, opts);
  let exitCode = 0;
  let auth: AuthMode | null = null;

  try {
    // Reachability first, so a missing server fails with a clear message.
    const probe = await browser.newContext();
    const health = await probe.request.get(`${opts.base}/api/health`, { timeout: opts.timeout }).catch((err: unknown) => err);
    await probe.close();
    if (health instanceof Error) {
      console.error(`screenshots: can't reach ${opts.base} (${health.message.split("\n")[0]}). Is the app running?`);
      process.exitCode = 2;
      return;
    }

    console.log(`Capturing ${opts.base} into ${opts.out}`);

    // Signed-out pages first: they also show what the sign-in step is about to use.
    if (opts.signedOutRoutes.length > 0) {
      console.log("Signed out");
      for (const viewport of opts.viewports) {
        for (const theme of opts.themes) {
          const context = await harness.newContext(viewport, theme, null);
          for (const route of opts.signedOutRoutes) {
            await harness.capture(context, routeSlug(route), route, viewport, theme, { expectSignedIn: false });
          }
          await context.close();
        }
      }
    }

    // Sign in through the real page, falling back to the test-auth header.
    if (!opts.noSignin) {
      const result = await signIn(browser, opts);
      if ("state" in result) {
        auth = { kind: "session", storageState: result.state };
        console.log(`Signed in as ${opts.email}`);
      } else if (opts.testAuth) {
        console.warn(`Sign-in failed (${result.reason}); falling back to the X-User-Id header.`);
      } else {
        console.error(
          `screenshots: sign-in as ${opts.email} failed: ${result.reason}.\n` +
            "Check that the app is running against the seeded demo database " +
            "(scripts/seed-demo.ts), or pass --test-auth <userId> with ALLOW_TEST_AUTH=true on the server.",
        );
        process.exitCode = 2;
        return;
      }
    }
    if (!auth && opts.testAuth) {
      const problem = await checkHeaderAuth(browser, opts, opts.testAuth);
      if (problem) {
        console.error(`screenshots: test auth for ${opts.testAuth} failed: ${problem}.`);
        process.exitCode = 2;
        return;
      }
      auth = { kind: "header", userId: opts.testAuth };
      console.log(`Using X-User-Id ${opts.testAuth}`);
    }
    if (!auth) {
      process.exitCode = 2;
      return;
    }

    console.log("Signed-in pages");
    for (const viewport of opts.viewports) {
      for (const theme of opts.themes) {
        const context = await harness.newContext(viewport, theme, auth);
        for (const route of opts.routes) {
          await harness.capture(context, routeSlug(route), route, viewport, theme, { expectSignedIn: true });
        }
        await context.close();
      }
    }

    if (opts.session) {
      const lookup = await harness.newContext(opts.viewports[0], opts.themes[0], auth);
      const sessionId = await findTodaySession(lookup, opts);
      await lookup.close();
      if (!sessionId) {
        console.error("  session: no scheduled session found in /api/plans (pass --session-id)");
        exitCode = 1;
      } else {
        console.log(`Session /s/${sessionId}`);
        const route = `/s/${sessionId}`;
        // Every preflight first: starting the session below changes what it shows.
        for (const viewport of opts.viewports) {
          for (const theme of opts.themes) {
            const context = await harness.newContext(viewport, theme, auth);
            await harness.capture(context, "session-preflight", route, viewport, theme, { expectSignedIn: true });
            await context.close();
          }
        }
        for (const viewport of opts.viewports) {
          for (const theme of opts.themes) {
            const context = await harness.newContext(viewport, theme, auth);
            await harness.capture(context, "session-question", route, viewport, theme, {
              expectSignedIn: true,
              prepare: (page) => openFirstQuestion(page, opts.timeout),
            });
            await context.close();
          }
        }
        console.log("  note: this started a run for that session; rerun scripts/seed-demo.ts to reset the demo.");
      }
    }
  } finally {
    await browser.close();
    const failed = harness.records.filter((r) => r.error);
    await writeFile(
      join(opts.out, "manifest.json"),
      JSON.stringify(
        {
          base: opts.base,
          generatedAt: new Date().toISOString(),
          auth: auth?.kind ?? "none",
          fullPage: opts.fullPage,
          captures: harness.records.map((r) => ({
            ...r,
            file: r.file ? r.file.slice(opts.out.length + 1) : null,
          })),
        },
        null,
        2,
      ),
    );
    const withErrors = harness.records.filter((r) => r.consoleErrors.length > 0 || r.pageErrors.length > 0);
    console.log(
      `${harness.records.length - failed.length} of ${harness.records.length} screenshots saved` +
        (withErrors.length ? `, ${withErrors.length} with console or page errors` : "") +
        ` (manifest.json in ${opts.out})`,
    );
    if (failed.length > 0) exitCode = 1;
    if (!process.exitCode) process.exitCode = exitCode;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
