/**
 * Where the e2e suite points and who it signs in as. Shared by
 * playwright.config.ts, the setup project and the fixtures.
 *
 * Everything comes from explicit environment variables. The suite never
 * reads .env: that file can hold live keys and the development database.
 */
import path from "node:path";

/** Port of the app under test. Each parallel run uses its own. */
export const E2E_PORT = Number(process.env.E2E_PORT ?? 3000);

export const BASE_URL = `http://localhost:${E2E_PORT}`;

/**
 * Signed-in browser state from the setup project. One file per port, so
 * runs against different servers (and databases) never share a cookie.
 */
export const AUTH_FILE = path.join(__dirname, "..", ".auth", String(E2E_PORT), "user.json");

/**
 * The dedicated e2e account. The setup project creates it through the
 * sign-up API (a repeat sign-up for the same email is a no-op) and signs
 * in with it on /auth/signin. Override with E2E_USER_EMAIL and
 * E2E_USER_PASSWORD; never use a real account.
 */
export const E2E_USER = {
  name: "E2E Student",
  email: process.env.E2E_USER_EMAIL ?? "e2e-student@studybot.test",
  password: process.env.E2E_USER_PASSWORD ?? "e2e-only-Passw0rd",
} as const;

const AI_FREE_KEY = "dummy";
const ZERO_KEY = "0".repeat(64);

/**
 * Environment for a server the suite starts itself: offline providers,
 * test auth, and URLs that match the port. DATABASE_URL must be set by the
 * caller and name an e2e database (see assertE2eDatabase).
 */
export function serverEnv(databaseUrl: string): Record<string, string> {
  return {
    AI_PROVIDER: "mock",
    GOOGLE_PROVIDER: "fake",
    EMAIL_PROVIDER: "console",
    OPENAI_API_KEY: AI_FREE_KEY,
    NEXTAUTH_SECRET: "e2e-test-secret",
    TOKEN_ENC_KEY: ZERO_KEY,
    // Trust the X-User-Id header. A production build also needs CI=true.
    ALLOW_TEST_AUTH: "true",
    NEXTAUTH_URL: BASE_URL,
    BASE_URL,
    DATABASE_URL: databaseUrl,
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

/**
 * Refuse to start a server against a database that isn't an e2e one, so a
 * missing DATABASE_URL can't fall back to the development database in
 * .env. Set E2E_ALLOW_ANY_DB=1 to skip the name check.
 */
export function assertE2eDatabase(databaseUrl: string | undefined): string {
  if (!databaseUrl) {
    throw new Error(
      "Set DATABASE_URL to an e2e database (for example postgresql://postgres:postgres@localhost:5433/studybot_e2e) " +
        "before the suite starts a server. See e2e/README.md.",
    );
  }
  const name = new URL(databaseUrl).pathname.replace(/^\//, "");
  if (!name.includes("e2e") && process.env.E2E_ALLOW_ANY_DB !== "1") {
    throw new Error(
      `DATABASE_URL points at "${name}", which isn't an e2e database. Use one whose name contains "e2e", or set E2E_ALLOW_ANY_DB=1.`,
    );
  }
  return databaseUrl;
}
