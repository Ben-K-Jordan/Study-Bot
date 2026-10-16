/**
 * Chat over a course's materials: the empty state with no materials, a
 * question answered by the mock AI (Markdown citations and numbered
 * sources), a question worded differently from the file still finding it,
 * Enter and Shift+Enter in the question box, focus staying in it, Retry
 * after a failed answer storing the question once, Delete chat history with
 * its confirmation, and older history loading above the newest 50 messages,
 * with Retry when a page fails.
 *
 * Chat stores messages against a users row, so the tests use the
 * `account` fixture (a real account each, which also gives each test its
 * own AI rate limit). The answer route's retrieval and source numbering
 * are covered by its unit tests (assistant-answer, chat-sources).
 */
import type { APIRequestContext, Page } from "@playwright/test";
import {
  test,
  expect,
  NEEDS_DATABASE,
  getJson,
  hasDatabase,
  insertChatMessages,
  loggedStatus,
  toasts,
  unique,
  uploadMaterial,
} from "./fixtures";

const NOTES = [
  "Recursion: a function that calls itself on a smaller input.",
  "A base case stops the recursion before the call stack overflows.",
  "Each recursive call gets its own frame on the call stack.",
].join("\n\n");

interface History {
  messages: { role: "user" | "assistant"; content: string }[];
  has_more: boolean;
  total: number;
}

const history = (api: APIRequestContext, course: string) =>
  getJson<History>(api, `/api/chat/messages?courseKey=${encodeURIComponent(course)}&limit=100`);

/** Store a chat message through the API. */
async function postMessage(api: APIRequestContext, course: string, role: "user" | "assistant", content: string) {
  const response = await api.post("/api/chat/messages", { data: { courseKey: course, role, content } });
  expect(response.status(), await response.text()).toBe(201);
}

/** A course with one uploaded file, so Chat offers it. */
async function courseWithMaterials(api: APIRequestContext): Promise<string> {
  const course = unique("E2E Chat");
  await uploadMaterial(api, { course, fileName: "recursion.txt", text: NOTES });
  return course;
}

const questionBox = (page: Page, course: string) =>
  page.getByRole("textbox", { name: `Ask about your ${course} materials` });

const asked = (page: Page) => page.getByRole("article", { name: "You asked" });
const answered = (page: Page) => page.getByRole("article", { name: "Study Bot answered" });

test("with no materials, Chat says what it needs and links to Upload materials", { tag: "@mobile" }, async ({ testUserPage: page }) => {
  await page.goto("/chat");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Chat");
  await expect(page.getByRole("heading", { level: 2, name: "No materials yet" })).toBeVisible();
  const upload = page.getByRole("main").getByRole("link", { name: "Upload materials" });
  await expect(upload).toHaveAttribute("href", "/plan/materials");
  await upload.click();
  await expect(page).toHaveURL("/plan/materials");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Materials");
});

test("a question gets an AI-written answer with numbered sources", { tag: "@mobile" }, async ({ account }) => {
  const { page, api } = account;
  const course = await courseWithMaterials(api);
  await page.goto("/chat");
  const box = questionBox(page, course);
  await expect(page.getByRole("heading", { level: 2, name: `No questions about ${course} yet` })).toBeVisible();

  await test.step("Shift+Enter adds a line, Enter asks, and focus stays in the box", async () => {
    await box.click();
    await page.keyboard.type("What is recursion?");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("What does the base case do?");
    await expect(box).toHaveValue("What is recursion?\nWhat does the base case do?");
    await expect(asked(page)).toHaveCount(0);

    await page.keyboard.press("Enter");
    await expect(asked(page)).toHaveText(["What is recursion?\nWhat does the base case do?"]);
    await expect(box).toHaveValue("");
    await expect(box).toBeFocused();
  });

  await test.step("the answer renders its citation as a link to numbered source 1", async () => {
    const answer = answered(page);
    await expect(answer).toContainText("AI-written");
    // Headings run day (h2), reply (h3), then the reply's own sections (h4)
    await expect(answer.getByRole("heading", { level: 3, name: "Study Bot" })).toBeVisible();
    await expect(answer.getByRole("heading", { level: 4, name: "Sources (1)" })).toBeVisible();
    const citation = answer.getByRole("link", { name: "Source 1: recursion.txt" });
    await expect(citation).toHaveText("1");
    await expect(answer).not.toContainText("[1]");
    // A labelled group, not a landmark: a long chat would list dozens of them
    await expect(answer.getByRole("region")).toHaveCount(0);
    const source = answer.getByRole("group", { name: "Sources (1)" }).getByRole("button", { name: "Source 1: recursion.txt" });
    await expect(source).toHaveAttribute("aria-expanded", "false");

    await citation.click();
    await expect(source).toHaveAttribute("aria-expanded", "true");
    await expect(source).toBeFocused();
    await expect(page.getByRole("status").filter({ hasText: "Answer ready." })).toBeAttached();
  });

  await test.step("the question and answer are stored once", async () => {
    const stored = await history(api, course);
    expect(stored.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    await page.reload();
    await expect(asked(page)).toHaveCount(1);
    await expect(answered(page)).toHaveCount(1);
  });
});

test("a question worded differently from the file still finds it", async ({ account }) => {
  const { api } = account;
  const course = await courseWithMaterials(api);
  const ask = async (question: string) => {
    const response = await api.post("/api/assistant/answer", { data: { question, course_name: course } });
    expect(response.status(), await response.text()).toBe(200);
    return (await response.json()) as { kind: string; sources: { title: string | null }[] };
  };

  // The notes never say "need", so a search for every word finds nothing; most of the words still match
  const covered = await ask("Why does each recursive call need its own frame on the stack?");
  expect(covered.kind).toBe("answer");
  expect(covered.sources.map((s) => s.title)).toEqual(["recursion.txt"]);

  // A question the notes don't touch still gets the plain notice
  const uncovered = await ask("What is the capital of France?");
  expect(uncovered.kind).toBe("notice");
  expect(uncovered.sources).toEqual([]);
});

test.describe("when an answer fails", () => {
  // The simulated failure is a 503, which Chromium logs as a failed resource.
  test.use({ allowConsoleErrors: [/status of 503/] });

  test("Retry asks again without storing the question twice", async ({ account }) => {
    const { page, api } = account;
    const course = await courseWithMaterials(api);
    // The first answer request fails before it reaches the server.
    await page.route(
      "**/api/assistant/answer",
      (route) => route.fulfill({ status: 503, json: { error: "Answer not generated. Retry.", code: "AI_UNAVAILABLE" } }),
      { times: 1 },
    );
    await page.goto("/chat");
    await questionBox(page, course).fill("What is recursion?");
    await page.getByRole("button", { name: "Ask" }).click();

    const failed = page.getByRole("alert").filter({ hasText: "Answer not generated." });
    await expect(failed).toContainText("The server didn't respond. Retry in a minute.");
    await expect(asked(page)).toHaveText(["What is recursion?"]);

    await failed.getByRole("button", { name: "Retry" }).click();
    await expect(answered(page)).toBeVisible();
    await expect(failed).toHaveCount(0);
    await expect(asked(page)).toHaveText(["What is recursion?"]);

    const stored = await history(api, course);
    expect(stored.total).toBe(2);
    expect(stored.messages.map((m) => [m.role, m.role === "user" ? m.content : "answer"])).toEqual([
      ["user", "What is recursion?"],
      ["assistant", "answer"],
    ]);
    await page.reload();
    await expect(asked(page)).toHaveText(["What is recursion?"]);
    await expect(answered(page)).toHaveCount(1);
  });
});

test("Delete chat history asks first, then empties the course's chat", async ({ account }) => {
  const { page, api } = account;
  const course = await courseWithMaterials(api);
  await postMessage(api, course, "user", "What does a call stack hold?");
  await postMessage(api, course, "assistant", "One frame for each call that hasn't returned yet.");
  await page.goto("/chat");
  await expect(asked(page)).toHaveText(["What does a call stack hold?"]);

  const remove = page.getByRole("button", { name: "Delete chat history" });
  const dialog = page.getByRole("alertdialog", { name: `Delete all ${course} chat messages?` });

  await test.step("Escape cancels and returns focus to the button", async () => {
    await remove.click();
    await expect(dialog).toContainText("This deletes 2 messages. Your materials stay.");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(remove).toBeFocused();
    await expect(asked(page)).toHaveCount(1);
  });

  await test.step("Delete messages empties the chat and puts focus in the question box", async () => {
    await remove.click();
    await dialog.getByRole("button", { name: "Delete messages" }).click();
    await expect(dialog).toBeHidden();
    await expect(toasts(page)).toContainText("Chat history deleted");
    await expect(page.getByRole("heading", { level: 2, name: `No questions about ${course} yet` })).toBeVisible();
    await expect(questionBox(page, course)).toBeFocused();
    await expect(remove).toHaveCount(0);

    expect((await history(api, course)).total).toBe(0);
    await page.reload();
    await expect(page.getByRole("heading", { level: 2, name: `No questions about ${course} yet` })).toBeVisible();
  });
});

test("older messages load above the newest 50", async ({ account }) => {
  // 52 messages: written straight to the database, since the chat routes allow 30 requests a minute.
  test.skip(!hasDatabase, NEEDS_DATABASE);
  const { page, api } = account;
  const course = await courseWithMaterials(api);
  await insertChatMessages(
    account.email,
    course,
    Array.from({ length: 26 }, (_, i) => [
      { role: "user" as const, content: `Question ${i + 1} about recursion` },
      { role: "assistant" as const, content: `Answer ${i + 1} about recursion` },
    ]).flat(),
  );
  expect((await history(api, course)).total).toBe(52);

  await page.goto("/chat");
  const questions = (from: number) => Array.from({ length: 27 - from }, (_, i) => `Question ${from + i} about recursion`);
  // The newest page holds 50 messages: questions 2 to 26 and their answers.
  await expect(asked(page)).toHaveText(questions(2));
  await expect(answered(page)).toHaveCount(25);

  const older = page.getByRole("button", { name: "Load older messages" });
  await older.click();
  await expect(asked(page)).toHaveText(questions(1));
  await expect(answered(page)).toHaveCount(26);
  await expect(older).toHaveCount(0);
});

test.describe("when older messages fail", () => {
  // The simulated failure is a 400 (SWR doesn't retry it), which Chromium logs as a failed resource.
  test.use({ allowConsoleErrors: [loggedStatus(400)] });

  test("Retry loads the page that failed, and only that page", async ({ account }) => {
    test.skip(!hasDatabase, NEEDS_DATABASE);
    const { page, api } = account;
    const course = await courseWithMaterials(api);
    // 102 messages: three pages, so a Retry that also loaded the next page would show
    await insertChatMessages(
      account.email,
      course,
      Array.from({ length: 51 }, (_, i) => [
        { role: "user" as const, content: `Question ${i + 1} about recursion` },
        { role: "assistant" as const, content: `Answer ${i + 1} about recursion` },
      ]).flat(),
    );
    let olderRequests = 0;
    await page.route(/\/api\/chat\/messages\?.*before=/, async (route) => {
      olderRequests++;
      if (olderRequests === 1) await route.fulfill({ status: 400, json: { error: "Bad request" } });
      else await route.continue();
    });

    await page.goto("/chat");
    const questions = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, i) => `Question ${from + i} about recursion`);
    await expect(asked(page)).toHaveText(questions(27, 51));

    await page.getByRole("button", { name: "Load older messages" }).click();
    const failed = page.getByRole("alert").filter({ hasText: "Older messages didn't load." });
    await expect(failed).toBeVisible();
    // The failure takes the button's place, so nothing stays stuck on "Loading older messages…"
    await expect(page.getByRole("button", { name: /older messages/ })).toHaveCount(0);

    await failed.getByRole("button", { name: "Retry" }).click();
    await expect(asked(page)).toHaveText(questions(2, 51));
    await expect(failed).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Load older messages" })).toBeEnabled();
    expect(olderRequests).toBe(2);
  });
});
