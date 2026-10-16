/**
 * The auth screens as a student uses them: create account, sign in and its
 * errors, where sign-in sends you, signing out, forgot and reset password,
 * and email verification links. Every test has its own account (the
 * `account` fixture or the form) and its own client address, so the
 * per-address limits never cross between tests.
 *
 * Unit tests already cover the route rules and messages
 * (auth-routes, auth-messages, auth-callback-url, auth-signin-limits and
 * auth-credentials-sign-in); these check what reaches the screen.
 * Tests that follow a reset or verification link need DATABASE_URL (see
 * support/db.ts).
 */
import {
  test,
  expect,
  DETAILS_DONT_MATCH,
  NEEDS_DATABASE,
  SIGNED_OUT,
  emailVerifiedAt,
  hasDatabase,
  hydrated,
  insertToken,
  latestToken,
  loggedStatus,
  newEmail,
  openMenu,
  openSignIn,
  signInWith,
  takeOverToken,
} from "./fixtures";

const NEW_PASSWORD = "e2e-only-NewPassw0rd";

test.describe("signed out", () => {
  test.use({ storageState: SIGNED_OUT });

  test.describe("create account", () => {
    test("each field's error shows beside it and in a summary at the top", { tag: "@mobile" }, async ({ page }) => {
      await page.goto("/auth/signup");
      await expect(page).toHaveTitle("Create account · Study Bot");
      const name = page.getByRole("textbox", { name: "Name" });
      const email = page.getByRole("textbox", { name: "Email" });
      const password = page.getByRole("textbox", { name: "Password", exact: true });
      const confirm = page.getByRole("textbox", { name: "Confirm password" });
      await expect(name).toBeFocused();

      await test.step("the password rule shows before anything is typed", async () => {
        await expect(password).toHaveAccessibleDescription("Use at least 8 characters.");
      });

      await test.step("an empty form names all four fields", async () => {
        await page.getByRole("button", { name: "Create account" }).click();
        const summary = page.getByRole("group", { name: "Fix 4 fields to continue" });
        await expect(summary).toBeFocused();
        await expect(summary.getByRole("link")).toHaveText([
          "Enter your name.",
          "Enter your email address.",
          "Enter a password.",
          "Enter the password again.",
        ]);
        await expect(name).toHaveAccessibleDescription("Enter your name.");
        await expect(email).toHaveAccessibleDescription("Enter your email address.");
        await expect(password).toHaveAccessibleDescription("Enter a password.");
        await expect(confirm).toHaveAccessibleDescription("Enter the password again.");
        for (const field of [name, email, password, confirm]) {
          await expect(field).toHaveAttribute("aria-invalid", "true");
        }
      });

      await test.step("a summary link moves focus to its field", async () => {
        await page.getByRole("link", { name: "Enter a password." }).click();
        await expect(password).toBeFocused();
      });

      await test.step("each rule has its own message, and a fixed field clears", async () => {
        await name.fill("Ada");
        await expect(name).not.toHaveAttribute("aria-invalid");
        await email.fill("ada@");
        await password.fill("short");
        await confirm.fill("shorter");
        await page.getByRole("button", { name: "Create account" }).click();

        await expect(page.getByRole("group", { name: "Fix 3 fields to continue" })).toBeFocused();
        await expect(email).toHaveAccessibleDescription("Enter an email address like name@example.com.");
        await expect(password).toHaveAccessibleDescription("Use at least 8 characters.");
        await expect(confirm).toHaveAccessibleDescription("Enter the same password in both fields.");
        await expect(page).toHaveURL("/auth/signup");
      });

      await test.step("a password past bcrypt's 72 bytes is refused, not cut short", async () => {
        // 37 accented letters: under 40 characters, but 74 bytes.
        const long = "\u00e9".repeat(37);
        await password.fill(long);
        await confirm.fill(long);
        await page.getByRole("button", { name: "Create account" }).click();
        await expect(password).toHaveAccessibleDescription("Use a shorter password.");
        await expect(page).toHaveURL("/auth/signup");
      });
    });

    test("Show password reveals both passwords, and a pasted password is accepted", async ({ page, baseURL }) => {
      const secret = "e2e-only-Pasted-Passw0rd";
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL });
      await page.goto("/auth/signup");
      await expect(page.getByRole("textbox", { name: "Name" })).toBeFocused();
      const password = page.getByRole("textbox", { name: "Password", exact: true });
      const confirm = page.getByRole("textbox", { name: "Confirm password" });

      await test.step("paste into both password fields", async () => {
        await page.evaluate((text) => navigator.clipboard.writeText(text), secret);
        await password.click();
        await page.keyboard.press("ControlOrMeta+V");
        await confirm.click();
        await page.keyboard.press("ControlOrMeta+V");
        await expect(password).toHaveValue(secret);
        await expect(confirm).toHaveValue(secret);
      });

      await test.step("one checkbox shows and hides both", async () => {
        await expect(password).toHaveAttribute("type", "password");
        await expect(confirm).toHaveAttribute("type", "password");
        const show = page.getByRole("checkbox", { name: "Show password" });
        await show.check();
        await expect(password).toHaveAttribute("type", "text");
        await expect(confirm).toHaveAttribute("type", "text");
        await show.uncheck();
        await expect(password).toHaveAttribute("type", "password");
        await expect(confirm).toHaveAttribute("type", "password");
      });
    });

    test("a new account is signed in and lands on the page that asked for sign-in", { tag: "@mobile" }, async ({ page }) => {
      const email = newEmail();
      await page.goto("/plan/new");
      await expect(page).toHaveURL("/auth/signin?callbackUrl=%2Fplan%2Fnew");

      await page.getByRole("link", { name: "Create account" }).click();
      await expect(page).toHaveURL("/auth/signup?callbackUrl=%2Fplan%2Fnew");
      await expect(page.getByRole("textbox", { name: "Name" })).toBeFocused();
      await page.getByRole("textbox", { name: "Name" }).fill("Ada Lovelace");
      await page.getByRole("textbox", { name: "Email" }).fill(email);
      await page.getByRole("textbox", { name: "Password", exact: true }).fill(NEW_PASSWORD);
      await page.getByRole("textbox", { name: "Confirm password" }).fill(NEW_PASSWORD);
      await page.getByRole("button", { name: "Create account" }).click();

      await expect(page).toHaveURL("/plan/new");
      await expect(page.getByRole("heading", { level: 1, name: "New plan" })).toBeVisible();

      const menu = await openMenu(page, "Open account menu");
      await expect(menu).toContainText("Ada Lovelace");
      await expect(menu).toContainText(email);
    });

    test.describe(() => {
      // Signing in with the new password answers 401.
      test.use({ allowConsoleErrors: [loggedStatus(401)] });

      test("an email that already has an account gets a way to sign in, not a second account", async ({ page, account }) => {
        await page.goto("/auth/signup");
        await expect(page.getByRole("textbox", { name: "Name" })).toBeFocused();
        await page.getByRole("textbox", { name: "Name" }).fill("Someone Else");
        await page.getByRole("textbox", { name: "Email" }).fill(account.email);
        await page.getByRole("textbox", { name: "Password", exact: true }).fill(NEW_PASSWORD);
        await page.getByRole("textbox", { name: "Confirm password" }).fill(NEW_PASSWORD);
        await page.getByRole("button", { name: "Create account" }).click();

        const summary = page.getByRole("group", {
          name: "This email already has an account. Sign in with its password, or reset the password.",
        });
        await expect(summary).toBeFocused();
        await expect(summary.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/auth/signin");
        await expect(page).toHaveURL("/auth/signup");

        // The existing account and its session are untouched.
        expect((await account.api.get("/api/settings")).status()).toBe(200);
      });
    });
  });

  test.describe("sign in", () => {
    // Wrong passwords answer 401 and the rate limit 429, on purpose.
    test.use({ allowConsoleErrors: [loggedStatus(401, 429)] });

    test("empty fields and a wrong password are explained, then the right one signs in", { tag: "@mobile" }, async ({ page, account }) => {
      // Each password check takes the server about 2 s (bcrypt at cost 12), and this test makes several.
      test.slow();
      await openSignIn(page);
      await expect(page).toHaveTitle("Sign in · Study Bot");
      const email = page.getByRole("textbox", { name: "Email" });
      const password = page.getByLabel("Password", { exact: true });

      await test.step("empty fields", async () => {
        await page.getByRole("button", { name: "Sign in" }).click();
        await expect(page.getByRole("group", { name: "Fix 2 fields to continue" })).toBeFocused();
        await expect(email).toHaveAccessibleDescription("Enter your email address.");
        await expect(password).toHaveAccessibleDescription("Enter your password.");
      });

      await test.step("a wrong password", async () => {
        await signInWith(page, account.email, "not-the-password");
        await expect(page.getByRole("group", { name: DETAILS_DONT_MATCH })).toBeFocused();
        await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
        await expect(page).toHaveURL("/auth/signin");
      });

      await test.step("the right password", async () => {
        await password.fill(account.password);
        await page.getByRole("button", { name: "Sign in" }).click();
        await expect(page).toHaveURL("/");
        await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
      });
    });

    test("too many attempts from one network say when to retry", async ({ page, account, playwright, baseURL, clientAddress }) => {
      // Each network gets 10 sign-in attempts every 15 minutes. Use them up
      // from this test's address with posts that carry no CSRF token: the
      // limit counts them, and next-auth turns them away before it checks a
      // password, so they don't load the server with password hashing.
      const api = await playwright.request.newContext({
        baseURL,
        storageState: SIGNED_OUT,
        extraHTTPHeaders: { "X-Forwarded-For": clientAddress },
      });
      for (let attempt = 1; attempt <= 10; attempt++) {
        const response = await api.post("/api/auth/callback/credentials", {
          form: { email: account.email, password: `wrong-${attempt}`, json: "true" },
        });
        expect(response.status(), `attempt ${attempt}`).not.toBe(429);
      }
      await api.dispose();

      await openSignIn(page);
      await signInWith(page, account.email, account.password);
      await expect(page.getByRole("group", { name: /^Too many sign-in attempts\. Retry in \d+ minutes?\.$/ })).toBeFocused();
      await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
      await expect(page).toHaveURL("/auth/signin");
      // The right password was never checked, so the session didn't start.
      expect((await (await page.request.get("/api/auth/session")).json())?.user).toBeUndefined();
    });

    test("sign in returns to the deep link that asked for it", async ({ page, account }) => {
      await page.goto("/achievements?view=list");
      await expect(page).toHaveURL("/auth/signin?callbackUrl=%2Fachievements%3Fview%3Dlist");
      await expect(page.getByRole("textbox", { name: "Email" })).toBeFocused();
      await signInWith(page, account.email, account.password);
      await expect(page).toHaveURL("/achievements?view=list");
      await expect(page.getByRole("heading", { level: 1, name: "Progress" })).toBeVisible();
    });

    test("a callbackUrl to another site is ignored", async ({ page, account }) => {
      await openSignIn(page, `/auth/signin?callbackUrl=${encodeURIComponent("https://evil.example/phish")}`);
      // Nothing carries the address on to the other auth screens either.
      await expect(page.getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/auth/signup");
      await signInWith(page, account.email, account.password);
      await expect(page).toHaveURL("/");
      await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    });
  });

  test.describe("forgot and reset password", () => {
    // The old password answers 401 once the new one is set.
    test.use({ allowConsoleErrors: [loggedStatus(401)] });

    test("Forgot password sends a link, and the link sets a new password once", async ({ page, account }) => {
      // Each password check takes the server about 2 s (bcrypt at cost 12), and this test makes several.
      test.slow();
      test.skip(!hasDatabase, NEEDS_DATABASE);
      let link = "";

      await test.step("ask for a link from sign in", async () => {
        await openSignIn(page);
        await page.getByRole("link", { name: "Forgot password?" }).click();
        await expect(page.getByRole("heading", { level: 1, name: "Reset password" })).toBeVisible();
        const email = page.getByRole("textbox", { name: "Email" });
        await expect(email).toBeFocused();
        await email.fill("name@");
        await page.getByRole("button", { name: "Send reset link" }).click();
        await expect(email).toHaveAccessibleDescription("Enter an email address like name@example.com.");

        await email.fill(account.email);
        await page.getByRole("button", { name: "Send reset link" }).click();
        await expect(page.getByRole("heading", { level: 1, name: "Check your email" })).toBeFocused();
        // The tab title follows the screen, not the page it started on.
        await expect(page).toHaveTitle("Check your email · Study Bot");
        await expect(page.getByRole("main")).toContainText(
          `If an account uses ${account.email}, a password reset link is on its way. The link lasts 1 hour.`,
        );
      });

      await test.step("the app stores a link that lasts 1 hour", async () => {
        // The email goes out after the response, so the row can lag the screen.
        await expect.poll(() => latestToken(account.email, "PASSWORD_RESET")).toMatchObject({ used: false });
        const row = (await latestToken(account.email, "PASSWORD_RESET"))!;
        expect(row.minutes_left).toBeGreaterThan(55);
        expect(row.minutes_left).toBeLessThanOrEqual(60);
        link = `/auth/reset-password?token=${await takeOverToken(row.id)}`;
      });

      await test.step("the link asks for the new password twice", async () => {
        await page.goto(link);
        await expect(page.getByRole("heading", { level: 1, name: "Choose a new password" })).toBeVisible();
        await expect(page).toHaveTitle("Choose a new password · Study Bot");
        const password = page.getByRole("textbox", { name: "New password", exact: true });
        const confirm = page.getByRole("textbox", { name: "Confirm new password" });
        await expect(password).toBeFocused();
        await expect(password).toHaveAccessibleDescription("Use at least 8 characters.");
        await password.fill(NEW_PASSWORD);
        await confirm.fill(`${NEW_PASSWORD}-typo`);
        await page.getByRole("button", { name: "Reset password" }).click();
        await expect(confirm).toHaveAccessibleDescription("Enter the same password in both fields.");

        await confirm.fill(NEW_PASSWORD);
        await page.getByRole("button", { name: "Reset password" }).click();
        await expect(page.getByRole("heading", { level: 1, name: "Password updated" })).toBeFocused();
        await expect(page).toHaveTitle("Password updated · Study Bot");
      });

      await test.step("sessions signed in with the old password end", async () => {
        expect((await account.api.get("/api/settings")).status()).toBe(401);
      });

      await test.step("only the new password signs in", async () => {
        await page.getByRole("link", { name: "Sign in" }).click();
        await expect(page.getByRole("textbox", { name: "Email" })).toBeFocused();
        await signInWith(page, account.email, account.password);
        await expect(page.getByRole("group", { name: DETAILS_DONT_MATCH })).toBeFocused();
        await page.getByLabel("Password", { exact: true }).fill(NEW_PASSWORD);
        await page.getByRole("button", { name: "Sign in" }).click();
        await expect(page).toHaveURL("/");
      });

      await test.step("the link works once", async () => {
        await page.goto(link);
        await expect(page.getByRole("heading", { level: 1, name: "Reset link already used" })).toBeVisible();
        await expect(page).toHaveTitle("Reset link already used · Study Bot");
        await expect(page.getByRole("link", { name: "Request a new link" })).toHaveAttribute("href", "/auth/forgot-password");
      });
    });

    test("an expired reset link says so and leads to a new one", async ({ page, account }) => {
      test.skip(!hasDatabase, NEEDS_DATABASE);
      const token = await insertToken(account.email, "PASSWORD_RESET", { expiresInMinutes: -5 });

      await page.goto(`/auth/reset-password?token=${token}`);
      await expect(page.getByRole("heading", { level: 1, name: "Reset link expired" })).toBeVisible();
      await expect(page).toHaveTitle("Reset link expired · Study Bot");
      await expect(page.getByRole("main")).toContainText("Reset links last 1 hour. Request a new link to choose a new password.");
      await expect(page.getByRole("textbox", { name: "New password" })).toHaveCount(0);

      await page.getByRole("link", { name: "Request a new link" }).click();
      await expect(page).toHaveURL("/auth/forgot-password");
      const email = page.getByRole("textbox", { name: "Email" });
      await expect(email).toBeFocused();
      await email.fill(account.email);
      await page.getByRole("button", { name: "Send reset link" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Check your email" })).toBeFocused();

      // The new link replaces the expired one and lasts the next hour.
      await expect.poll(async () => (await latestToken(account.email, "PASSWORD_RESET"))?.minutes_left ?? 0).toBeGreaterThan(55);
    });

    test("a reset link with a missing or made-up token says it doesn't work", async ({ page }) => {
      for (const path of ["/auth/reset-password?token=not-a-real-token", "/auth/reset-password"]) {
        await test.step(path, async () => {
          await page.goto(path);
          await expect(page.getByRole("heading", { level: 1, name: "This reset link doesn't work" })).toBeVisible();
          // The tab title is the first thing a screen reader reads; it matches the heading.
          await expect(page).toHaveTitle("This reset link doesn't work · Study Bot");
          await expect(page.getByRole("main")).toContainText(
            "The link may be incomplete. Copy the whole link from the email, or request a new one.",
          );
          await expect(page.getByRole("link", { name: "Request a new link" })).toHaveAttribute("href", "/auth/forgot-password");
          await expect(page.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/auth/signin");
        });
      }
    });
  });

  test.describe("email verification", () => {
    test("a verification link verifies the email once and opens sign in", async ({ page, account }) => {
      test.skip(!hasDatabase, NEEDS_DATABASE);

      await test.step("an expired link says so", async () => {
        const expired = await insertToken(account.email, "EMAIL_VERIFY", { expiresInMinutes: -5 });
        await page.goto(`/api/auth/verify-email?token=${expired}`);
        await expect(page).toHaveURL("/auth/verify-email?status=expired");
        await expect(page.getByRole("heading", { level: 1, name: "Verification link expired" })).toBeVisible();
        expect(await emailVerifiedAt(account.email)).toBeNull();
      });

      const token = await insertToken(account.email, "EMAIL_VERIFY", { expiresInMinutes: 24 * 60 });
      for (const visit of ["first", "second"]) {
        await test.step(`the working link, ${visit} visit`, async () => {
          await page.goto(`/api/auth/verify-email?token=${token}`);
          await expect(page).toHaveURL("/auth/signin?verified=true");
          await expect(page.getByRole("status").filter({ hasText: "Email verified" })).toContainText("Sign in to continue.");
          expect(await emailVerifiedAt(account.email)).not.toBeNull();
        });
      }
    });

    test("a link that doesn't work explains itself and sends a new one", async ({ page }) => {
      const email = newEmail();
      await page.goto("/api/auth/verify-email?token=not-a-real-token");
      await expect(page).toHaveURL("/auth/verify-email?status=invalid");
      await expect(page.getByRole("heading", { level: 1, name: "This verification link doesn't work" })).toBeVisible();

      const field = page.getByRole("textbox", { name: "Email" });
      const send = page.getByRole("button", { name: "Send a new link" });
      await hydrated(send);
      await send.click();
      await expect(field).toHaveAccessibleDescription("Enter your email address.");

      await field.fill(email);
      await send.click();
      await expect(page.getByRole("status").filter({ hasText: "Link sent" })).toContainText(
        `If ${email} has an account waiting for verification, a new link is on its way. It lasts 24 hours.`,
      );
    });

    test("the verify email page explains each status", async ({ page }) => {
      const main = page.getByRole("main");
      const sendButton = page.getByRole("button", { name: "Send a new link" });
      const emailField = page.getByRole("textbox", { name: "Email" });

      await test.step("sent, with the address", async () => {
        await page.goto("/auth/verify-email?email=ada%40studybot.test");
        await expect(page.getByRole("heading", { level: 1, name: "Verify your email" })).toBeVisible();
        await expect(page).toHaveTitle("Verify your email · Study Bot");
        await expect(main).toContainText("A verification link went to ada@studybot.test. Open it to finish creating your account.");
        await expect(sendButton).toBeVisible();
        await expect(emailField).toHaveCount(0);
      });

      await test.step("sent, with something that isn't an address", async () => {
        await page.goto(`/auth/verify-email?email=${encodeURIComponent("<b>not an address</b>")}`);
        await expect(main).toContainText("A verification link went to the email you signed up with.");
        await expect(main).not.toContainText("not an address");
        await expect(emailField).toBeVisible();
      });

      for (const { status, title, description, canResend } of [
        {
          status: "expired",
          title: "Verification link expired",
          description: "Verification links last 24 hours. Send a new one to finish creating your account.",
          canResend: true,
        },
        {
          status: "busy",
          title: "Too many attempts",
          description: "Wait a few minutes, then open the link in your email again.",
          canResend: false,
        },
        {
          status: "failed",
          title: "Email not verified yet",
          description: "The link couldn't be checked just now. Open it again in a few minutes.",
          canResend: false,
        },
      ]) {
        await test.step(status, async () => {
          await page.goto(`/auth/verify-email?status=${status}`);
          await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
          await expect(page).toHaveTitle(`${title} · Study Bot`);
          await expect(main).toContainText(description);
          await expect(sendButton).toHaveCount(canResend ? 1 : 0);
          await expect(page.getByRole("link", { name: "Back to sign in" })).toBeVisible();
        });
      }
    });
  });

  test.describe("before the page's script runs", () => {
    // What a student on a slow connection gets when they submit before the
    // form has hydrated: the browser submits the server-rendered form itself.
    test.use({ javaScriptEnabled: false });

    test("submitting sign in or create account never puts the password in the address", async ({ page }) => {
      const secret = "e2e-only-NotInTheUrl";

      await test.step("sign in", async () => {
        await page.goto("/auth/signin");
        await page.getByRole("textbox", { name: "Email" }).fill("ada@studybot.test");
        await page.getByLabel("Password", { exact: true }).fill(secret);
        await page.getByRole("button", { name: "Sign in" }).click();
        await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
        await expect(page).toHaveURL("/auth/signin");
      });

      await test.step("create account", async () => {
        await page.goto("/auth/signup?callbackUrl=%2Fplan");
        await page.getByRole("textbox", { name: "Name" }).fill("Ada");
        await page.getByRole("textbox", { name: "Email" }).fill("ada@studybot.test");
        await page.getByRole("textbox", { name: "Password", exact: true }).fill(secret);
        await page.getByRole("textbox", { name: "Confirm password" }).fill(secret);
        await page.getByRole("button", { name: "Create account" }).click();
        await expect(page.getByRole("heading", { level: 1, name: "Create account" })).toBeVisible();
        await expect(page).toHaveURL("/auth/signup?callbackUrl=%2Fplan");
      });
    });
  });
});

test.describe("signed in", () => {
  test("the sign-in and create account pages send a signed-in student on", async ({ page }) => {
    // The shared account; this only reads.
    await page.goto("/auth/signin");
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

    await page.goto("/auth/signup?callbackUrl=%2Fachievements");
    await expect(page).toHaveURL("/achievements");
    await expect(page.getByRole("heading", { level: 1, name: "Progress" })).toBeVisible();
  });

  test("Sign out in the account menu ends the session", { tag: "@mobile" }, async ({ account }) => {
    const page = account.page;
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

    const menu = await openMenu(page, "Open account menu");
    await expect(menu).toContainText(account.email);
    await menu.getByRole("menuitem", { name: "Sign out" }).click();

    await expect(page).toHaveURL("/auth/signin");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await page.goto("/settings");
    await expect(page).toHaveURL("/auth/signin?callbackUrl=%2Fsettings");
  });
});
