/**
 * The suite's `test` and `expect`, and every helper the specs share. Import
 * from here, never from @playwright/test, so every page gets the console
 * guard:
 *
 *   import { test, expect, createSession, unique } from "./fixtures";
 *
 * Fixtures:
 * - page: the signed-in e2e account (storageState from the setup project).
 *   Fails the test on any console error or uncaught page error, apart from
 *   CONSOLE_ALLOWLIST and the test's own `allowConsoleErrors`.
 * - request: API calls as the same signed-in account.
 * - clientAddress: the made-up client address (X-Forwarded-For) that `page`
 *   and `request` send. Each test gets its own, so the per-address limits on
 *   sign-in, sign-up and email links never cross between tests.
 * - makeAxeBuilder(): AxeBuilder for `page`, limited to WCAG 2.2 A and AA
 *   (WCAG_TAGS). For another page, call axeBuilder(thatPage), or
 *   expectNoAxeViolations(page), which also waits for the page to settle.
 * - testUser: a fresh identity for this test only, through the X-User-Id
 *   test header. `testUser.api` calls the API as it; `testUserPage` is a
 *   page signed in as it. Use these when a screen shows account-wide data
 *   (Home, Progress, Study) or the test needs its own AI rate limit. A test
 *   identity has no account row, so Chat (which stores messages against the
 *   account) and anything that changes the account need `account`.
 * - account: a real account of its own, created through the sign-up API
 *   and signed in through next-auth's credentials endpoint:
 *   `{ email, password, api, page }`. For tests that need a row in the
 *   users table and may change or delete it (password, settings, account
 *   deletion, export, chat). Never change or delete the shared e2e account.
 * - seedSession({ deck, ...session }): a session on the shared account whose
 *   started run holds a known deck (multiple choice, model answers), which
 *   the mock AI never writes. Skips the test without DATABASE_URL.
 * - allowConsoleErrors (option): extra patterns one test expects, such as
 *   the 404 it navigates to on purpose. Give it one pattern: Playwright reads
 *   a two-item array whose second item is an object (a RegExp is one) as
 *   [value, options], so combine statuses with loggedStatus(401, 429).
 */
import { randomBytes } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {
  test as base,
  expect,
  type APIRequestContext,
  type ConsoleMessage,
  type Page,
} from "@playwright/test";
import { createSession, startRun, type CreatedSession, type SessionInput } from "./support/api";
import { NEEDS_DATABASE, hasDatabase, seedDeck, type SeedQuestion } from "./support/db";
import { settled } from "./support/page";

export { expect };
export * from "./support/api";
export * from "./support/auth";
export * from "./support/db";
export { TIME_ZONE } from "./support/env";
export * from "./support/lesson";
export * from "./support/page";
export * from "./support/time";

/** WCAG 2.0, 2.1 and 2.2 at levels A and AA. */
export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** AxeBuilder for any page (such as `testUserPage`), limited to WCAG_TAGS. */
export function axeBuilder(page: Page): AxeBuilder {
  return new AxeBuilder({ page }).withTags(WCAG_TAGS);
}

/**
 * Run axe (WCAG_TAGS) once the page has settled (no "Loading…" status, no
 * animation running), and fail with each violation's rule and elements.
 * `state` names the screen in the failure message.
 */
export async function expectNoAxeViolations(page: Page, state = "the page"): Promise<void> {
  await settled(page);
  const { violations } = await axeBuilder(page).analyze();
  expect(
    violations.map((v) => ({ rule: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(" ")) })),
    `axe violations on ${state}`,
  ).toEqual([]);
}

/** storageState for signed-out tests: `test.use({ storageState: SIGNED_OUT })`. */
export const SIGNED_OUT = { cookies: [], origins: [] };

/**
 * Console output any test may produce. Keep it short; each entry says why.
 * A pattern that hides a real failure belongs in one test's
 * `allowConsoleErrors`, not here.
 */
export const CONSOLE_ALLOWLIST: RegExp[] = [];

/**
 * Chromium logs every 4xx and 5xx response as a console error. A test that
 * causes them on purpose (a wrong password answers 401) allows them with
 * `test.use({ allowConsoleErrors: [loggedStatus(401, 429)] })`.
 */
export function loggedStatus(...statuses: number[]): RegExp {
  return new RegExp(`the server responded with a status of (${statuses.join("|")}) `);
}

/**
 * A random address in 2001:db8::/32, the IPv6 documentation range (RFC 3849),
 * for X-Forwarded-For. Production builds limit sign-ups (3 an hour),
 * sign-ins (10 every 15 minutes) and email links per address, and with no
 * proxy in front, `next start` takes the address from X-Forwarded-For. The
 * range is far too large for two tests to share an address by chance.
 */
export function documentationAddress(): string {
  const hex = () => randomBytes(2).toString("hex");
  return `2001:db8:${hex()}:${hex()}::${hex()}`;
}

export interface TestUser {
  /** The X-User-Id value. */
  id: string;
  headers: Record<string, string>;
  /** API calls as this user. */
  api: APIRequestContext;
}

export interface TestAccount {
  email: string;
  password: string;
  /** API calls with the account's session cookie. */
  api: APIRequestContext;
  /** A page signed in as the account, with the console guard. */
  page: Page;
}

export type SeededSession = CreatedSession & { runId: string };

type Options = {
  allowConsoleErrors: RegExp[];
};

type Fixtures = {
  clientAddress: string;
  makeAxeBuilder: () => AxeBuilder;
  testUser: TestUser;
  testUserPage: Page;
  account: TestAccount;
  seedSession: (input: Omit<SessionInput, "questions"> & { deck: readonly SeedQuestion[] }) => Promise<SeededSession>;
};

/** Password for accounts made by the `account` fixture. Test-only. */
const ACCOUNT_PASSWORD = "e2e-only-Passw0rd";

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

  // Every context and request context the test's own `page` and `request`
  // come from sends this test's address.
  extraHTTPHeaders: async ({ extraHTTPHeaders }, provide) => {
    await provide({ ...extraHTTPHeaders, "X-Forwarded-For": documentationAddress() });
  },

  clientAddress: async ({ extraHTTPHeaders }, provide) => {
    await provide(extraHTTPHeaders?.["X-Forwarded-For"] ?? "");
  },

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

  testUserPage: async ({ browser, testUser, allowConsoleErrors }, provide) => {
    // browser.newContext() in a test starts from the project's `use` options:
    // the device, baseURL, and the signed-in storageState, which would win
    // over the test header. So drop the session cookie explicitly.
    const context = await browser.newContext({ storageState: SIGNED_OUT, extraHTTPHeaders: testUser.headers });
    const page = await context.newPage();
    const problems = guardConsole(page, [...CONSOLE_ALLOWLIST, ...allowConsoleErrors]);
    await provide(page);
    await context.close();
    assertNoConsoleProblems(problems);
  },

  // Its own timeout: signing up and signing in hash the password twice (about
  // 2 s each with bcryptjs at cost 12), which shouldn't eat into the test's time.
  account: [
    async ({ playwright, browser, baseURL, allowConsoleErrors }, provide) => {
      const email = `e2e-${randomBytes(5).toString("hex")}@studybot.test`;
      // An address of its own, apart from the test's clientAddress, so creating
      // the account never uses up the test's sign-in attempts.
      const headers = { "X-Forwarded-For": documentationAddress() };
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

      // The project's device and baseURL, with this account's session instead of the shared one.
      const context = await browser.newContext({ extraHTTPHeaders: headers, storageState: await api.storageState() });
      const page = await context.newPage();
      const problems = guardConsole(page, [...CONSOLE_ALLOWLIST, ...allowConsoleErrors]);
      await provide({ email, password: ACCOUNT_PASSWORD, api, page });
      await context.close();
      await api.dispose();
      assertNoConsoleProblems(problems);
    },
    { timeout: 30_000 },
  ],

  seedSession: async ({ request }, provide, testInfo) => {
    testInfo.skip(!hasDatabase, NEEDS_DATABASE);
    await provide(async ({ deck, ...input }) => {
      const session = await createSession(request, { ...input, questions: deck.length });
      const run = await startRun(request, session.id);
      await seedDeck(run.run_id, deck);
      return { ...session, runId: run.run_id };
    });
  },
});
