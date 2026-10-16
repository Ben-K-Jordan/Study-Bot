/**
 * Rows the HTTP API can't reach (or can't write fast enough), read and
 * written straight in the e2e database: link tokens (stored as a SHA-256
 * digest, so a test can't read the raw token from the row the app wrote), a
 * known question deck (the mock AI never writes one; see seedDeck), and a
 * long chat history (the chat routes allow 30 requests a minute).
 *
 * These need DATABASE_URL in the Playwright process, pointing at the
 * database the server uses. CI sets it for the whole job. Without it the
 * tests that need it skip with NEEDS_DATABASE.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect } from "@playwright/test";
import { assertE2eDatabase } from "./env";

const DATABASE_URL = process.env.DATABASE_URL;

export const hasDatabase = Boolean(DATABASE_URL);

/** Skip reason for tests that read or write rows directly. */
export const NEEDS_DATABASE =
  "Needs DATABASE_URL set to the server's e2e database, for rows the API can't reach (hashed link tokens, a seeded deck, a long chat history).";

/** Run `work` with a connection to the e2e database. */
async function withDatabase<T>(work: (db: Client) => Promise<T>): Promise<T> {
  const db = new Client({ connectionString: assertE2eDatabase(DATABASE_URL) });
  await db.connect();
  try {
    return await work(db);
  } finally {
    await db.end();
  }
}

async function query<Row>(sql: string, params: unknown[]): Promise<Row[]> {
  return withDatabase(async (db) => (await db.query(sql, params)).rows as Row[]);
}

// ---------------------------------------------------------------------------
// Link tokens (reset password, verify email)

export type TokenType = "PASSWORD_RESET" | "EMAIL_VERIFY";

/** A raw link token and the digest the app stores for it (src/lib/tokens.ts). */
function newTokenSecret(): { raw: string; digest: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, digest: createHash("sha256").update(raw).digest("hex") };
}

export interface TokenRow {
  id: string;
  /** Minutes until the link expires (negative once it has). */
  minutes_left: number;
  used: boolean;
}

/** The newest link token of `type` for the account, or undefined. */
export async function latestToken(email: string, type: TokenType): Promise<TokenRow | undefined> {
  const rows = await query<TokenRow>(
    // The columns are UTC timestamps without a zone, so compare them with
    // UTC "now" in SQL rather than reading them as local dates in Node.
    `SELECT t.id,
            EXTRACT(EPOCH FROM t.expires_at - timezone('utc', now()))::float / 60 AS minutes_left,
            t.used_at IS NOT NULL AS used
       FROM verification_tokens t JOIN users u ON u.id = t.user_id
      WHERE u.email = $1 AND t.type = $2
      ORDER BY t.created_at DESC
      LIMIT 1`,
    [email.toLowerCase(), type],
  );
  return rows[0];
}

/**
 * Give the token row a secret the test knows, as if the test had read the
 * email, and return the raw token for the link.
 */
export async function takeOverToken(id: string): Promise<string> {
  const { raw, digest } = newTokenSecret();
  await query("UPDATE verification_tokens SET token = $1 WHERE id = $2", [digest, id]);
  return raw;
}

/** Write a link token for the account, expiring in `expiresInMinutes` (negative: already expired), and return its raw value. */
export async function insertToken(email: string, type: TokenType, { expiresInMinutes = 60 } = {}): Promise<string> {
  const { raw, digest } = newTokenSecret();
  const inserted = await query(
    `INSERT INTO verification_tokens (id, user_id, token, type, expires_at, created_at)
     SELECT $1, u.id, $2, $3, timezone('utc', now()) + make_interval(mins => $4::int), timezone('utc', now())
       FROM users u WHERE u.email = $5
     RETURNING id`,
    [randomUUID(), digest, type, expiresInMinutes, email.toLowerCase()],
  );
  expect(inserted, `no account for ${email}`).toHaveLength(1);
  return raw;
}

/** When the account's email was verified, or null. */
export async function emailVerifiedAt(email: string): Promise<Date | null> {
  const rows = await query<{ email_verified: Date | null }>("SELECT email_verified FROM users WHERE email = $1", [
    email.toLowerCase(),
  ]);
  expect(rows, `no account for ${email}`).toHaveLength(1);
  return rows[0].email_verified;
}

// ---------------------------------------------------------------------------
// Chat history

/**
 * Store a chat history for the account in one go, oldest first, a second
 * apart. POST /api/chat/messages allows 30 requests a minute, so a history
 * long enough to page would otherwise take minutes to build.
 */
export async function insertChatMessages(
  email: string,
  courseKey: string,
  messages: readonly { role: "user" | "assistant"; content: string }[],
): Promise<void> {
  await withDatabase(async (db) => {
    const users = await db.query("SELECT id FROM users WHERE email = $1", [email.toLowerCase()]);
    expect(users.rows, `no account for ${email}`).toHaveLength(1);
    const userId = users.rows[0].id as string;
    for (const [i, message] of messages.entries()) {
      await db.query(
        `INSERT INTO chat_messages (id, user_id, course_key, role, content, created_at)
         VALUES ($1, $2, $3, $4, $5, timezone('utc', now()) - make_interval(secs => $6::int))`,
        [randomUUID(), userId, courseKey, message.role, message.content, messages.length - i],
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Seeded question decks

/**
 * One question for seedDeck. With AI_PROVIDER=mock the server never asks
 * the AI for a deck (src/services/run.ts skips the AI gateway in mock mode),
 * so every run gets template free-recall questions with no model answer and
 * no multiple choice. Tests that need those write a known deck into the run.
 */
export interface SeedQuestion {
  text: string;
  modelAnswer: string;
  keyPoints: readonly string[];
  /** Multiple choice: four choices and the zero-based index of the right one. */
  choices?: readonly string[];
  correct?: number;
  /** Why each choice tempts, one per choice; shown after a wrong pick. */
  rationales?: readonly string[];
}

/**
 * Replace a started run's template questions with `deck`, in both places the
 * server reads them, as scripts/seed-demo.ts does. The run must have exactly
 * `deck.length` questions. The server still grades the real choices and
 * reveals the real model answers.
 */
export async function seedDeck(runId: string, deck: readonly SeedQuestion[]): Promise<void> {
  await withDatabase(async (db) => {
    const found = await db.query("SELECT prompts FROM session_runs WHERE run_id = $1", [runId]);
    expect(found.rowCount, `run ${runId} isn't in DATABASE_URL's database; point it at the server's`).toBe(1);
    const stored = found.rows[0].prompts as { id: string; objective_id?: string }[];
    expect(stored).toHaveLength(deck.length);

    const prompts = deck.map((q, i) => ({
      id: stored[i].id,
      objective_id: stored[i].objective_id,
      text: q.text,
      // One difficulty for the whole deck, so adaptive difficulty never reorders it.
      difficulty: 2,
      format: q.choices ? "MCQ" : "FREE_RECALL",
      ...(q.choices ? { choices: q.choices, correctIndex: q.correct ?? 0 } : {}),
      meta: {
        model_answer: q.modelAnswer,
        key_points: q.keyPoints,
        ...(q.rationales ? { distractorRationales: q.rationales } : {}),
      },
    }));
    for (const [i, p] of prompts.entries()) {
      const meta = p.format === "MCQ" ? { ...p.meta, format: "MCQ", choices: p.choices, correctIndex: p.correctIndex } : p.meta;
      const updated = await db.query(
        "UPDATE session_run_prompts SET text = $1, difficulty = $2, meta = $3 WHERE run_id = $4 AND prompt_index = $5",
        [p.text, p.difficulty, JSON.stringify(meta), runId, i],
      );
      expect(updated.rowCount, `question ${i + 1} of run ${runId}`).toBe(1);
    }
    await db.query("UPDATE session_runs SET prompts = $1 WHERE run_id = $2", [JSON.stringify(prompts), runId]);
  });
}

/** Questions for seeded decks, about recursion. */
export const QUESTIONS = {
  /** Multiple choice; the right pick is "The base case". */
  baseCase: {
    text: "Which part of a recursive function stops the recursion?",
    choices: ["The base case", "The recursive call", "The return type", "The parameter list"],
    correct: 0,
    rationales: [
      "The base case returns without calling the function again.",
      "The recursive call is what keeps the recursion going.",
      "The return type says what comes back, not when the calls stop.",
      "The parameters carry the input, but nothing in them ends the calls.",
    ],
    modelAnswer: "The base case stops the recursion.",
    keyPoints: ["returns without recursing"],
  },
  /** Multiple choice; the right pick is "The base case is never reached". */
  overflow: {
    text: "What does a stack overflow in a recursive function usually mean?",
    choices: [
      "The function returned too early",
      "The input was already sorted",
      "The base case is never reached",
      "The compiler ran out of disk space",
    ],
    correct: 2,
    rationales: [
      "Returning early ends the calls, so the stack shrinks instead.",
      "Sorted input changes the work, not whether the calls end.",
      "Without a reachable base case the calls never stop.",
      "Disk space has nothing to do with the call stack.",
    ],
    modelAnswer: "The base case is never reached, so the calls never stop.",
    keyPoints: ["unreachable base case", "calls never stop"],
  },
  /** Free recall, with a model answer. */
  recursiveCase: {
    text: "Explain what the recursive case of a function does.",
    modelAnswer: "It calls the function again on a smaller input, moving toward the base case.",
    keyPoints: ["calls itself on a smaller input", "moves toward the base case"],
  },
  /** Free recall, with a model answer. */
  whyBaseCase: {
    text: "Why does every recursive function need a base case?",
    modelAnswer: "Without a base case the calls never stop and the stack overflows.",
    keyPoints: ["the calls must stop", "otherwise the stack overflows"],
  },
} satisfies Record<string, SeedQuestion>;
