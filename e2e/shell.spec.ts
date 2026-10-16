/**
 * Every destination in the app shell loads for a new student: its title
 * in the top app bar and the tab, no console errors (the fixture fails the
 * test on any), and no WCAG 2.2 A or AA violations axe can find. A new test
 * identity keeps the screens in their empty states, so the checks don't
 * depend on what other tests created.
 */
import { test, expect, axeBuilder } from "./fixtures";

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
    // Skeletons give way to the page's own content before axe looks.
    await expect(page.getByRole("main").getByRole("status", { name: /Loading/ })).toHaveCount(0);

    expect((await axeBuilder(page).analyze()).violations).toEqual([]);
  });
}
