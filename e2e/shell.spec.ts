/**
 * Every destination in the app shell loads for a new student: its title
 * in the top app bar and the tab, no console errors (the fixture fails the
 * test on any), and no WCAG 2.2 A or AA violations axe can find. A new test
 * identity keeps the screens in their empty states, so the checks don't
 * depend on what other tests created.
 */
import type { Page } from "@playwright/test";
import { test, expect, createPlan, expectNoAxeViolations, hydrated, morningZone, unique } from "./fixtures";

const DESTINATIONS = [
  { path: "/", title: "Home" },
  { path: "/plan", title: "Plan" },
  { path: "/plan/new", title: "New plan" },
  { path: "/plan/materials", title: "Materials" },
  { path: "/learn", title: "Study" },
  { path: "/flashcards", title: "Flashcards" },
  { path: "/guides", title: "Study guides" },
  { path: "/chat", title: "Chat" },
  { path: "/achievements", title: "Progress" },
  { path: "/settings", title: "Settings" },
];

for (const { path, title } of DESTINATIONS) {
  test(`${title} (${path}) loads and passes axe`, { tag: ["@a11y", "@mobile"] }, async ({ testUserPage: page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page).toHaveTitle(`${title} · Study Bot`);
    // Waits for loading states ("Loading chat history…") to give way to the
    // page's own content before axe looks.
    await expectNoAxeViolations(page, title);
  });
}

/** A plan whose first session is today, so the shell shows the Start button. */
async function planWithSessionToday(api: Parameters<typeof createPlan>[0]) {
  return createPlan(api, { course_name: unique("E2E Shell"), time_zone: morningZone(), all_day: true });
}

/** Clicks `selector` in the page and returns the named animations seen in the next few seconds. */
function animationsAfterClick(page: Page, selector: string, until: string[]): Promise<string[]> {
  return page.evaluate(
    async ([sel, wanted]) => {
      const seen = new Set<string>();
      (document.querySelector(sel) as HTMLElement).click();
      const end = performance.now() + 10_000;
      while (performance.now() < end) {
        for (const animation of document.getAnimations()) {
          if (animation instanceof CSSAnimation) seen.add(animation.animationName);
        }
        if (wanted.every((name) => seen.has(name))) break;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return [...seen];
    },
    [selector, until] as const,
  );
}

test("the app bar title starts where the page content starts", async ({ testUserPage: page, isMobile }) => {
  test.skip(isMobile, "wide windows only");
  for (const width of [1440, 1000]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/plan");
    const title = page.getByRole("heading", { level: 1 });
    await expect(title).toHaveText("Plan");
    const content = page.locator('[data-slot="page-container"]').first();
    const contentX = await content.evaluate((node) => node.getBoundingClientRect().x + parseFloat(getComputedStyle(node).paddingLeft));
    expect((await title.boundingBox())!.x, `at ${width}px`).toBeCloseTo(contentX, 0);
  }
});

test("opening a session, the rail and the app bar recede, and they come back after", async ({
  testUserPage: page,
  testUser,
  isMobile,
}) => {
  test.skip(isMobile, "the rail shows from 600px");
  const plan = await planWithSessionToday(testUser.api);
  await page.goto("/plan");
  const start = page.locator('[data-slot="session-fab"][data-placement="rail"]');
  await hydrated(start);

  const entering = await animationsAfterClick(page, '[data-slot="session-fab"][data-placement="rail"]', ["shell-rail-out", "shell-bar-out"]);
  expect(entering).toEqual(expect.arrayContaining(["shell-rail-out", "shell-bar-out"]));
  await expect(page).toHaveURL(new RegExp(`/s/${plan.items[0].session_id}$`));

  const leave = page.getByRole("link", { name: "Leave session" });
  await hydrated(leave);
  const leaving = await animationsAfterClick(page, 'a[aria-label="Leave session"]', ["shell-rail-out", "shell-bar-out"]);
  expect(leaving).toEqual(expect.arrayContaining(["shell-rail-out", "shell-bar-out"]));
});

test("a control that takes focus scrolls clear of the floating Start button", { tag: "@mobile" }, async ({
  testUserPage: page,
  testUser,
}) => {
  await planWithSessionToday(testUser.api);
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/plan");
  const fab = page.locator('[data-slot="session-fab"][data-placement="floating"]');
  await expect(fab).toBeVisible();
  // The plan streams in after its skeleton; wait for its controls.
  await expect(page.getByRole("main").getByRole("link", { name: "New plan" })).toBeVisible();

  // Move the page's first control down behind the button: clear of the
  // bottom bar, so without the button's own scroll margin focusing it
  // wouldn't scroll it out from under the button.
  await page.evaluate(() => {
    const main = document.getElementById("main-content")!;
    // The first control on screen (the wide layout's side column is hidden here).
    const first = [...main.querySelectorAll("a[href], button, input, select, textarea")].find(
      (el) => el.getClientRects().length > 0
    )!;
    const fabTop = document.querySelector('[data-slot="session-fab"][data-placement="floating"]')!.getBoundingClientRect().top;
    const spacer = document.createElement("div");
    spacer.style.height = `${fabTop + 45 - first.getBoundingClientRect().bottom}px`;
    spacer.style.flexShrink = "0";
    main.prepend(spacer);
    window.scrollTo(0, 0);
  });
  const inMain = () => page.evaluate(() => Boolean(document.activeElement?.closest("#main-content")));
  for (let presses = 0; presses < 10 && !(await inMain()); presses++) await page.keyboard.press("Tab");
  expect(await inMain()).toBe(true);

  const focused = await page.evaluate(() => document.activeElement!.getBoundingClientRect().bottom);
  const fabTop = (await fab.boundingBox())!.y;
  expect(focused, "the focused control ends above the Start button").toBeLessThanOrEqual(fabTop);
});

test("in a short window (400% zoom) the bars and the Start button stop covering the page", { tag: "@mobile" }, async ({
  testUserPage: page,
  testUser,
}) => {
  await planWithSessionToday(testUser.api);
  await page.setViewportSize({ width: 320, height: 256 });
  await page.goto("/plan");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Plan");

  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav).toHaveCSS("position", "static");
  await expect(page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) })).toHaveCSS(
    "position",
    "absolute",
  );
  await expect(page.locator('[data-slot="session-fab"][data-placement="floating"]')).toBeHidden();

  // The More sheet scrolls inside its height cap, so the theme control is reachable
  const more = nav.getByRole("button", { name: "More", exact: true });
  await hydrated(more);
  await more.click();
  const system = page.getByRole("dialog", { name: "More" }).getByRole("radio", { name: "System" });
  await system.scrollIntoViewIfNeeded();
  await expect(system).toBeInViewport({ ratio: 1 });
});

test("in forced colours the current destination keeps its indicator", { tag: "@mobile" }, async ({
  testUserPage: page,
}) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/plan");
  // The pill's fill disappears in forced colours; a Highlight outline replaces it
  const indicator = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Plan" }).locator("span").first();
  await expect(indicator).toHaveCSS("outline-style", "solid");
  await expect(indicator).toHaveCSS("outline-width", "2px");
});

test("the sign-in refresh also runs on client navigation and when the tab returns", { tag: "@mobile" }, async ({ page }) => {
  const KEY = "study-bot:session-refreshed-at";
  // Refreshed just now as the page loads, so the load itself asks for nothing
  await page.addInitScript((key) => localStorage.setItem(key, String(Date.now())), KEY);
  await page.goto("/");
  const plan = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Plan" });
  await hydrated(plan);

  // A day since the last refresh, in a tab that stays open
  await page.evaluate((key) => localStorage.setItem(key, "0"), KEY);
  const onNavigation = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/auth/session");
  await plan.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Plan");
  await onNavigation;
  await expect.poll(() => page.evaluate((key) => Number(localStorage.getItem(key)), KEY)).toBeGreaterThan(0);

  await page.evaluate((key) => localStorage.setItem(key, "0"), KEY);
  const onReturn = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/auth/session");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await onReturn;
});
