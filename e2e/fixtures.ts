/**
 * The suite's `test` and `expect`. Import both from here, never from
 * @playwright/test, so every page gets the console guard.
 *
 *   import { test, expect, createSession, unique } from "./fixtures";
 *
 * Fixtures:
 * - page: the signed-in e2e account (storageState from the setup project).
 *   Fails the test on any console error or uncaught page error, apart from
 *   CONSOLE_ALLOWLIST and the test's own `allowConsoleErrors`.
 * - request: API calls as the same signed-in account.
 * - makeAxeBuilder(): AxeBuilder for `page`, limited to WCAG 2.2 A and AA
 *   (WCAG_TAGS). For another page, call axeBuilder(thatPage).
 * - testUser: a fresh identity for this test only, through the X-User-Id
 *   test header. `testUser.api` calls the API as it; `testUserPage` is a
 *   page signed in as it. Use these when a screen shows account-wide data
 *   (Home, Progress, Settings) or a test changes account settings. A test
 *   identity has no account row, so Chat (which stores messages against
 *   the account) needs the signed-in `page`.
 * - account: a real account of its own, created through the sign-up API
 *   and signed in through next-auth's credentials endpoint:
 *   `{ email, password, api, page }`. For tests that need a row in the
 *   users table and may change or delete it (password, account deletion,
 *   export). Never change or delete the shared e2e account.
 * - allowConsoleErrors (option): extra patterns one test expects, such as
 *   the 404 it navigates to on purpose.
 */
import { randomBytes } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {
  test as base,
  expect,
  type APIRequestContext,
  type BrowserContextOptions,
  type ConsoleMessage,
  type Page,
} from "@playwright/test";

export { expect };
export * from "./support/api";

/** WCAG 2.0, 2.1 and 2.2 at levels A and AA. */
export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** AxeBuilder for any page (such as `testUserPage`), limited to WCAG_TAGS. */
export function axeBuilder(page: Page): AxeBuilder {
  return new AxeBuilder({ page }).withTags(WCAG_TAGS);
}

/** storageState for signed-out tests: `test.use({ storageState: SIGNED_OUT })`. */
export const SIGNED_OUT = { cookies: [], origins: [] };

/**
 * Console output any test may produce. Keep it short; each entry says why.
 * A pattern that hides a real failure belongs in one test's
 * `allowConsoleErrors`, not here.
 */
export const CONSOLE_ALLOWLIST: RegExp[] = [];

export interface TestUser {
  /** The X-User-Id value. */
  id: string;
  headers: Record<string, string>;
  /** API calls as this user. */
  api: APIRequestContext;
}

type Options = {
  allowConsoleErrors: RegExp[];
};

export interface TestAccount {
  email: string;
  password: string;
  /** API calls with the account's session cookie. */
  api: APIRequestContext;
  /** A page signed in as the account, with the console guard. */
  page: Page;
}

type Fixtures = {
  makeAxeBuilder: () => AxeBuilder;
  testUser: TestUser;
  testUserPage: Page;
  account: TestAccount;
};

/** Password for accounts made by the `account` fixture. Test-only. */
const ACCOUNT_PASSWORD = "e2e-only-Passw0rd";

/**
 * A made-up client address from the documentation ranges (RFC 5737).
 * Production builds limit sign-ups (3 an hour) and sign-ins (10 every 15
 * minutes) per address, and with no proxy in front, `next start` takes the
 * address from X-Forwarded-For. A fresh one per account keeps tests out of
 * each other's buckets.
 */
function testClientIp(): string {
  const [range, host] = randomBytes(2);
  return `${["192.0.2", "198.51.100", "203.0.113"][range % 3]}.${1 + (host % 254)}`;
}

/** The project's device settings, for contexts a fixture opens itself. */
type DeviceOptions = Pick<
  BrowserContextOptions,
  "baseURL" | "viewport" | "userAgent" | "deviceScaleFactor" | "isMobile" | "hasTouch" | "locale" | "timezoneId"
>;

/** Collect console errors and page errors; returns the list to check after the test. */
function guardConsole(page: Page, allowed: RegExp[]): string[] {
  const problems: string[] = [];
  const isAllowed = (text: string) => allowed.some((pattern) => pattern.test(text));
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() !== "error" || isAllowed(message.text())) return;
    const { url, lineNumber } = message.location();
    problems.push(`console.error: ${message.text()}${url ? ` (${url}:${lineNumber})` : ""}`);
  });
  page.on("pageerror", (error) => {
    if (isAllowed(error.message)) return;
    problems.push(`pageerror: ${error.message}`);
  });
  return problems;
}

function assertNoConsoleProblems(problems: string[]): void {
  if (problems.length > 0) {
    throw new Error(`The page logged ${problems.length} unexpected error(s):\n${problems.join("\n")}`);
  }
}

// The fixture callback is named `provide` (Playwright's docs call it `use`)
// so the React hooks lint rule doesn't mistake it for React's use().
export const test = base.extend<Options & Fixtures>({
  allowConsoleErrors: [[], { option: true }],

  page: async ({ page, allowConsoleErrors }, provide) => {
    const problems = guardConsole(page, [...CONSOLE_ALLOWLIST, ...allowConsoleErrors]);
    await provide(page);
    assertNoConsoleProblems(problems);
  },

  makeAxeBuilder: async ({ page }, provide) => {
    await provide(() => axeBuilder(page));
  },

  testUser: async ({ playwright, baseURL }, provide, testInfo) => {
    const id = `e2e-${testInfo.workerIndex}-${randomBytes(4).toString("hex")}`;
    const headers = { "X-User-Id": id };
    const api = await playwright.request.newContext({ baseURL, extraHTTPHeaders: headers, storageState: SIGNED_OUT });
    await provide({ id, headers, api });
    await api.dispose();
  },

  testUserPage: async (
    { browser, testUser, baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId, allowConsoleErrors },
    provide,
  ) => {
    // Same device as the project, no session cookie, and the test header.
    const device: DeviceOptions = { baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId };
    const context = await browser.newContext({ ...device, extraHTTPHeaders: testUser.headers });
    const page = await context.newPage();
    const problems = guardConsole(page, [...CONSOLE_ALLOWLIST, ...allowConsoleErrors]);
    await provide(page);
    await context.close();
    assertNoConsoleProblems(problems);
  },

  account: async (
    { playwright, browser, baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId, allowConsoleErrors },
    provide,
  ) => {
    const email = `e2e-${randomBytes(5).toString("hex")}@studybot.test`;
    const headers = { "X-Forwarded-For": testClientIp() };
    const api = await playwright.request.newContext({ baseURL, extraHTTPHeaders: headers, storageState: SIGNED_OUT });

    const signUp = await api.post("/api/auth/signup", { data: { name: "E2E Account", email, password: ACCOUNT_PASSWORD } });
    expect(signUp.status(), await signUp.text()).toBe(201);
    const { csrfToken } = await (await api.get("/api/auth/csrf")).json();
    const signIn = await api.post("/api/auth/callback/credentials", {
      form: { csrfToken, email, password: ACCOUNT_PASSWORD, json: "true" },
    });
    expect(signIn.ok(), await signIn.text()).toBe(true);
    const session = await (await api.get("/api/auth/session")).json();
    expect(session?.user?.email).toBe(email);

    const device: DeviceOptions = { baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, timezoneId };
    const context = await browser.newContext({ ...device, extraHTTPHeaders: headers, storageState: await api.storageState() });
    const page = await context.newPage();
    const problems = guardConsole(page, [...CONSOLE_ALLOWLIST, ...allowConsoleErrors]);
    await provide({ email, password: ACCOUNT_PASSWORD, api, page });
    await context.close();
    await api.dispose();
    assertNoConsoleProblems(problems);
  },
});
