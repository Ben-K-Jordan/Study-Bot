import { defineConfig, devices } from "@playwright/test";
import { AUTH_FILE, BASE_URL, E2E_PORT, TIME_ZONE, assertE2eDatabase, serverEnv } from "./e2e/support/env";

/**
 * e2e suite. See e2e/README.md for running it locally.
 *
 * - E2E_PORT (default 3000) picks the app's port; the base URL follows it.
 * - CI=true: builds the app and runs `next start`, as CI does. Otherwise
 *   `next dev`.
 * - E2E_REUSE_SERVER=1: use a server already listening on E2E_PORT (one you
 *   started with the env in e2e/README.md) instead of starting one.
 *
 * The suite never loads .env. A server it starts gets explicit offline
 * settings and the DATABASE_URL you pass, which must name an e2e database.
 */
const isCI = !!process.env.CI;
const reuseServer = process.env.E2E_REUSE_SERVER === "1";

export default defineConfig({
  testDir: "./e2e",
  // One folder per port, so parallel runs on different ports don't wipe
  // each other's traces.
  outputDir: `test-results/e2e-${E2E_PORT}`,
  // Tests own their data (a unique course, plan or user per test), so they
  // can run in any order and in parallel.
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  // One Next server serves every worker; more than this slows each test
  // down more than it saves. Override with --workers.
  workers: isCI ? 2 : 4,
  reporter: isCI
    ? [["github"], ["html", { open: "never", outputFolder: `playwright-report/e2e-${E2E_PORT}` }]]
    : [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    locale: "en-US",
    timezoneId: TIME_ZONE,
  },
  projects: [
    {
      // Creates the e2e account and signs in through /auth/signin.
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: AUTH_FILE },
      dependencies: ["setup"],
    },
    {
      // Phone layout (bottom navigation, floating start button). Runs only
      // tests tagged @mobile.
      name: "mobile",
      use: { ...devices["Pixel 7"], storageState: AUTH_FILE },
      grep: /@mobile/,
      dependencies: ["setup"],
    },
  ],
  webServer: reuseServer
    ? {
        // Started by you; Playwright only waits for it.
        command: `echo "Expecting a server on ${BASE_URL}"`,
        url: `${BASE_URL}/api/health`,
        reuseExistingServer: true,
        timeout: 30_000,
      }
    : {
        command: isCI
          ? `npm run build && npm run start -- -p ${E2E_PORT}`
          : `npm run dev -- -p ${E2E_PORT}`,
        url: `${BASE_URL}/api/health`,
        // Playwright merges this over its own environment. CI=true comes from
        // the runner and is what lets `next start` accept test auth.
        env: serverEnv(assertE2eDatabase(process.env.DATABASE_URL)),
        reuseExistingServer: false,
        timeout: isCI ? 300_000 : 120_000,
        stdout: "ignore",
        stderr: "pipe",
      },
});
