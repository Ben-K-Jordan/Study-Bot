import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

// Load .env for DATABASE_URL (used by pg.Pool in tests).
// Force BASE_URL to port 3000 to match the Playwright webServer.
const savedBaseUrl = process.env.BASE_URL;
dotenv.config();
process.env.BASE_URL = savedBaseUrl || "http://localhost:3000";

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // Sequential since tests depend on state
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: 1,
  reporter: isCI
    ? [["github"], ["html", { open: "never" }]]
    : "list",
  timeout: 30_000,
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    extraHTTPHeaders: {
      "X-User-Id": "e2e_test_user",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: isCI
      ? "NO_STANDALONE=1 npm run build && ALLOW_TEST_AUTH=true NEXTAUTH_SECRET=e2e-test-secret npm run start"
      : "ALLOW_TEST_AUTH=true npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !isCI,
    timeout: isCI ? 120_000 : 30_000,
  },
});
