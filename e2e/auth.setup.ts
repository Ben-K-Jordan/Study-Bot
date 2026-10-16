/**
 * Setup project: make sure the e2e account exists, sign in through the real
 * /auth/signin page, and save the session for the chromium and mobile
 * projects.
 *
 * Production builds limit sign-ups (3 an hour) and sign-ins (10 every 15
 * minutes) per network, in memory. So when the saved session still works
 * against this server, it is kept, and repeated runs on a server you
 * started yourself don't use those up.
 */
import fs from "node:fs";
import path from "node:path";
import { test as setup, expect, SIGNED_OUT } from "./fixtures";
import { AUTH_FILE, E2E_USER } from "./support/env";

setup.use({ storageState: SIGNED_OUT });

setup("sign in as the e2e account", async ({ page, request, playwright, baseURL }) => {
  if (fs.existsSync(AUTH_FILE)) {
    // A recreated database or another NEXTAUTH_SECRET ends the saved session.
    const saved = await playwright.request.newContext({ baseURL, storageState: AUTH_FILE });
    const session = await (await saved.get("/api/auth/session")).json().catch(() => null);
    await saved.dispose();
    if (session?.user?.email === E2E_USER.email) return;
  }

  await setup.step("create the account through the sign-up API", async () => {
    // A taken email gets the same 201, so this is safe on a used database.
    const response = await request.post("/api/auth/signup", {
      data: { name: E2E_USER.name, email: E2E_USER.email, password: E2E_USER.password },
    });
    expect(response.status(), await response.text()).toBe(201);
  });

  await setup.step("sign in on /auth/signin", async () => {
    await page.goto("/auth/signin");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await page.getByLabel("Email").fill(E2E_USER.email);
    await page.getByLabel("Password", { exact: true }).fill(E2E_USER.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/");
    // The signed-in shell: Home's title in the top app bar.
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  });

  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  await page.context().storageState({ path: AUTH_FILE });
});
