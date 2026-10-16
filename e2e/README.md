# e2e tests

Playwright tests against a running Study Bot. They use the offline providers (mock AI, fake Google Calendar, console email), and the test runner never reads `.env`.

## Run them

1. Start Postgres (`npm run db:up`) and make an e2e database. Its name must contain `e2e`, so the suite can't run against your development data.

   ```sh
   docker exec study-bot-db-1 psql -U postgres -c "DROP DATABASE IF EXISTS studybot_e2e WITH (FORCE)"
   docker exec study-bot-db-1 psql -U postgres -c "CREATE DATABASE studybot_e2e"
   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/studybot_e2e npx prisma migrate deploy
   ```

2. Install the browser once: `npx playwright install chromium`.

3. Pick a port that nothing else uses (`npm run dev` already has 3000) and run:

   ```sh
   # Build, then test against `next start`, like CI
   CI=true E2E_PORT=3300 DATABASE_URL=postgresql://postgres:postgres@localhost:5433/studybot_e2e npx playwright test

   # Or test against `next dev`. Next allows one dev server per folder,
   # so stop any other `npm run dev` in this checkout first.
   E2E_PORT=3300 DATABASE_URL=postgresql://postgres:postgres@localhost:5433/studybot_e2e npx playwright test
   ```

   The config starts the server with the right settings (`AI_PROVIDER=mock`, `GOOGLE_PROVIDER=fake` with placeholder Google ids, `ALLOW_TEST_AUTH=true`, and the URLs for the port) and stops it afterwards. `next` still reads `.env` for anything the config doesn't set.

### Against a server you started

To run the suite many times without rebuilding, start `next start` yourself and set `E2E_REUSE_SERVER=1`. The suite then only checks that the server answers. Give the test runner the same `DATABASE_URL` as the server: a few tests write rows the API can't reach (see below) and skip without it.

```sh
npm run build   # once, with the env below
AI_PROVIDER=mock GOOGLE_PROVIDER=fake EMAIL_PROVIDER=console OPENAI_API_KEY=dummy \
GOOGLE_CLIENT_ID=e2e-fake-client.apps.googleusercontent.com GOOGLE_CLIENT_SECRET=e2e-fake-secret \
NEXTAUTH_SECRET=e2e-test-secret TOKEN_ENC_KEY=0000000000000000000000000000000000000000000000000000000000000000 \
ALLOW_TEST_AUTH=true CI=true NEXTAUTH_URL=http://localhost:3300 BASE_URL=http://localhost:3300 \
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/studybot_e2e \
npx next start -p 3300

E2E_PORT=3300 E2E_REUSE_SERVER=1 DATABASE_URL=postgresql://postgres:postgres@localhost:5433/studybot_e2e npx playwright test
```

`CI=true` on the server is what lets a production build accept the test header. Leave it off the test runner here, which would otherwise switch to CI behaviour (2 workers, a retry, the GitHub reporter). The placeholder Google ids show the Google Calendar controls; with `GOOGLE_PROVIDER=fake` nothing reaches Google.

Rate limits live in the server's memory. Each test sends its own made-up client address, so the per-address limits on sign-in and sign-up don't cross between tests; restarting the server resets them all.

## Projects and tags

| Project | What it runs |
| --- | --- |
| `setup` | `auth.setup.ts`: creates the e2e account through `POST /api/auth/signup` and signs in on `/auth/signin`. Saves the session to `e2e/.auth/<port>/user.json` (ignored by git) and keeps it while it still works. |
| `chromium` | Every spec on Desktop Chrome, signed in as the e2e account. |
| `mobile` | Tests tagged `@mobile`, on a Pixel 7 (Chromium), signed in the same way. |

Tags: `@mobile` (also run on the phone layout), `@a11y` (runs axe with the WCAG 2.0, 2.1 and 2.2 A and AA rules). Filter with `--grep @a11y`, a project with `--project=chromium`, or one file by naming it.

CI splits the suite into two shards (`--shard=1/2` and `--shard=2/2`), each with its own database and server.

## Writing tests

Import `test`, `expect` and every helper from `./fixtures`, never from `@playwright/test`. The comment at the top of `fixtures.ts` says which fixture to use when:

- `page` and `request` are the shared e2e account. Give every test its own data, usually a `unique(...)` course name, so tests run in parallel.
- `testUser` and `testUserPage` are a fresh identity per test (through the `X-User-Id` test header), for screens that show the whole account and for tests that need their own AI rate limit.
- `account` is a real account of the test's own, for anything that changes or deletes an account, and for Chat.
- `seedSession` gives a session whose run holds a known deck (multiple choice, model answers), which the mock AI never writes.

The helpers live in `support/`: `api.ts` (sessions, runs, plans, materials, guides, decks), `time.ts` (calendar days in the suite's zone), `page.ts` (`hydrated`, `openMenu`, `toasts`, `pick`, `settled`, `openWhen`), `lesson.ts` (the session screen's locators), `auth.ts` (sign-in and Settings) and `db.ts` (link tokens, seeded decks and chat history, written straight to the database; these tests need `DATABASE_URL` and skip without it).

Locate by role and label, assert with web-first `expect`, and never sleep. Wait for a server-rendered control to hydrate (`hydrated(locator)`) before typing into it or clicking it right after a page load. Run axe with `expectNoAxeViolations(page, "the state")`, which waits for loading states and animations first. The fixtures fail a test on any console error; allow an expected one with `test.use({ allowConsoleErrors: [loggedStatus(404)] })`.

Reports: the list reporter locally; in CI the GitHub reporter and an HTML report in `playwright-report/e2e-<port>`. Traces (first retry), screenshots and videos (failures) go to `test-results/e2e-<port>`.
