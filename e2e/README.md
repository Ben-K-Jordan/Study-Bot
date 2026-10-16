# e2e tests

Playwright tests against a running Study Bot. They use the offline providers (mock AI, fake Google Calendar, console email) and never read `.env`.

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

   The config starts the server with the right settings (`AI_PROVIDER=mock`, `GOOGLE_PROVIDER=fake`, `ALLOW_TEST_AUTH=true`, and the URLs for the port) and stops it afterwards.

### Against a server you started

To run the suite many times without rebuilding, start `next start` yourself and set `E2E_REUSE_SERVER=1`. The suite then only checks that the server answers.

```sh
npm run build   # once, with the env below
AI_PROVIDER=mock GOOGLE_PROVIDER=fake EMAIL_PROVIDER=console OPENAI_API_KEY=dummy \
NEXTAUTH_SECRET=e2e-test-secret TOKEN_ENC_KEY=0000000000000000000000000000000000000000000000000000000000000000 \
ALLOW_TEST_AUTH=true CI=true NEXTAUTH_URL=http://localhost:3300 BASE_URL=http://localhost:3300 \
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/studybot_e2e \
npx next start -p 3300

E2E_PORT=3300 E2E_REUSE_SERVER=1 npx playwright test
```

`CI=true` on the server is what lets a production build accept the test header.

## Projects and tags

| Project | What it runs |
| --- | --- |
| `setup` | `auth.setup.ts`: creates the e2e account through `POST /api/auth/signup` and signs in on `/auth/signin`. Saves the session to `e2e/.auth/<port>/user.json` (ignored by git) and keeps it while it still works. |
| `chromium` | Every spec on Desktop Chrome, signed in as the e2e account. |
| `mobile` | Tests tagged `@mobile`, on a Pixel 7 (Chromium), signed in the same way. |

Tags: `@mobile` (also run on the phone layout), `@a11y` (runs axe). Filter with `--grep @a11y`, a project with `--project=chromium`, or one file by naming it.

## Writing tests

Import `test` and `expect` from `./fixtures`, never from `@playwright/test`. The fixtures fail a test on any console error, and offer `makeAxeBuilder()`, a fresh `testUser` identity per test (through the `X-User-Id` test header), a disposable real `account` for tests that change or delete an account, and data helpers (`createSession`, `finishSession`, `createPlan`, `uploadMaterial`, `unique`). The comment at the top of `fixtures.ts` says when to use which. Give every test its own data, usually a `unique(...)` course name, so tests run in parallel. Locate by role and label, assert with web-first `expect`, and never sleep.

Reports: the list reporter locally; in CI the GitHub reporter and an HTML report in `playwright-report/e2e-<port>`. Traces (first retry), screenshots and videos (failures) go to `test-results/e2e-<port>`.
