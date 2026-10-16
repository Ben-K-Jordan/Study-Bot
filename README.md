# Study Bot

Study Bot plans studying around real exam dates and turns your own lecture files into practice. A session asks one question at a time, gives feedback as soon as you answer, and logs every miss so it keeps coming back until you get it right on two different days. I built it for my own prelims and finals, so the defaults fit one student with several courses and dated exams.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/home-dark.png">
    <img src="docs/images/home-light.png" alt="Home: countdown cards for four exams, unresolved errors and low-mastery topics with Repair and Practice buttons, and today's Retrieval session with a Resume session button" width="900">
  </picture>
</p>

## What it does

- Plans a week of sessions for a course and exam inside your study hours, exports the plan as .ics or publishes it to Google Calendar, and previews new times before it moves a missed session.
- Runs sessions like short lessons: a start screen, one question per screen, then an end screen with accuracy, confidence results and follow-up dates. The modes are Retrieval, Interleaved practice, Exam simulation, Error repair and Worked examples.
- Gives feedback right after each answer. The server grades multiple choice; you score free recall against a model answer. Feedback cites numbered passages from your uploaded files when the search finds one, and says so when it doesn't.
- Logs each miss with a correction rule in your words and brings it back as a repair question, later in the session and in later ones, until you answer it correctly on two different days.
- Reviews topics and flashcards on an SM-2 schedule that tightens as the exam gets closer.
- Includes flashcards (with a deck built from your errors), study guides, chat over your files with cited sources, and a Progress page with mastery by topic, streaks, XP and achievements.
- Works from the keyboard: 1 to 4 pick, Q, W and E rate how sure you are, Enter submits and moves on, ? lists the rest. Answers save as you go, so a refresh mid-session loses nothing.

## Why it works

Each mechanic comes from a result in the learning research. [docs/LEARNING_SCIENCE.md](docs/LEARNING_SCIENCE.md) has the effect sizes, full references, and the cases where the app deliberately skips a technique.

- Practice testing beats rereading on delayed tests (Roediger & Karpicke 2006; Adesope, Trevisan & Sundararajan 2017). Sessions are questions, and the server holds back the answer key, model answer and sources until you commit to an answer.
- Immediate feedback that explains the error helps more than a bare right or wrong (Kulik & Kulik 1988; Van der Kleij, Feskens & Eggen 2015), and feedback aimed at the person can backfire (Kluger & DeNisi 1996). The feedback prompts stick to what was wrong and why.
- Confident errors get corrected well right after feedback (Butterfield & Metcalfe 2001) and then tend to return (Butler, Fazio & Marsh 2011). The app asks how sure you are before it reveals anything, flags a wrong answer marked Sure, and puts those first in Error repair.
- The best gap between reviews depends on how far off the test is (Cepeda et al. 2006, 2008). Intervals are capped by the days left, with daily review in the last three days.
- Durable learning takes correct answers spread over several sessions (Rawson & Dunlosky 2011), hence the two-different-days rule.
- Mixing related topics works better than practicing them in blocks when they are easy to confuse (Rohrer & Taylor 2007; Brunmair & Richter 2019), so Interleaved practice deals questions round-robin across one course's topics.
- A failed attempt before studying still helps later learning (Richland, Kornell & Kao 2009). New topics open with a pretest question that doesn't count toward accuracy.
- Students tend to be overconfident (Dunlosky & Rawson 2012). The end screen and Progress show how often you were right at each confidence level.

## Quick start

You need Node 20.19 or newer (`.nvmrc` says 22) and Docker, or your own PostgreSQL 16.

```sh
git clone https://github.com/Ben-K-Jordan/Study-Bot.git
cd Study-Bot
npm install
npm run setup
npm run dev
```

`npm run setup` copies `.env.example` to `.env`, generates `NEXTAUTH_SECRET` and `TOKEN_ENC_KEY`, starts PostgreSQL in Docker on port 5433, and applies the migrations and `prisma/manual-scripts/001_pgvector.sql`. It is safe to rerun and never overwrites a value you set. Without Docker, point `DATABASE_URL` at your own database and run `npx prisma migrate deploy`.

Open http://localhost:3000 and create an account. The defaults need no keys: a mock AI provider, email printed to the server log, and a fake Google Calendar. The mock provider is for development and tests, so sessions use built-in question templates and AI-written text is placeholder.

### Demo data

The seed only touches a database whose name contains `demo`, and it doesn't read `.env`:

```sh
docker compose exec db psql -U postgres -c "CREATE DATABASE studybot_demo"
export DATABASE_URL=postgresql://postgres:postgres@localhost:5433/studybot_demo
npx prisma migrate deploy
npm run db:seed-demo
npm run dev
```

Sign in as `demo@studybot.local` with `study-bot-demo`. You get four courses with exams 7 to 60 days out, plans, three weeks of finished sessions, flashcards, guides and a chat, dated relative to the day you seed. Rerunning the seed resets only that account.

### Real AI and Google Calendar

For real questions and feedback, set `AI_PROVIDER="openai"` and `OPENAI_API_KEY` in `.env` and restart. The model is `AI_MODEL_ANSWER` (`gpt-4o-mini` by default), and each account is capped at $1 a day and $10 a month unless you change the caps. Settings, under AI features, says which mode the server is in.

For Google Calendar, enable the Calendar API in Google Cloud, create a Web application OAuth client with the redirect URI `http://localhost:3000/api/integrations/google/callback` (`BASE_URL` plus that path), set `GOOGLE_PROVIDER="real"`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and connect from Settings. Tokens are stored encrypted with `TOKEN_ENC_KEY`.

## Screenshot tour

All from the demo account on the mock provider, so session questions are the built-in templates plus repair questions from the seeded history.

<p align="center">
  <img src="docs/images/answer-loop.gif" alt="Animation of one repair question: an answer is typed, Unsure is picked, the answer is submitted, the correction rule appears, Correct is chosen, the green feedback sheet slides up, and the next question loads" width="768">
</p>

The answer loop: answer, rate, submit, score yourself against your earlier correction rule, continue.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/session-start-dark.png">
  <img src="docs/images/session-start-light.png" alt="Start screen of an Interleaved practice session on four INFO 1300 topics: 10 questions (7 new, 1 due for review and 2 repair), 50 minutes planned, 80% target accuracy, and a Start session button" width="900">
</picture>

Every session opens by saying what it will ask.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/session-question-dark.png">
  <img src="docs/images/session-question-light.png" alt="A review question about grid template areas with a typed answer and Sure selected under How sure are you, and a Submit answer button" width="900">
</picture>

One question per screen, rated before anything is revealed.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/session-scoring-dark.png">
  <img src="docs/images/session-scoring-light.png" alt="A repair question about class and ID selectors with a wrong typed answer above the student's earlier correction rule, and Correct, Partly correct and Incorrect buttons" width="900">
</picture>

A repair question is scored against the correction rule you wrote the first time.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/session-feedback-dark.png">
  <img src="docs/images/session-feedback-light.png" alt="Feedback after a wrong answer marked Sure: the answer, the correction rule, a Confident error note, and a red Incorrect sheet with a Next question button" width="900">
</picture>

A wrong answer marked Sure gets the Confident error note. The numbered sources sit below it.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/session-end-dark.png">
  <img src="docs/images/session-end-light.png" alt="Session complete screen with 58% accuracy over 12 questions, a Confidence section with a chart of accuracy at Guessing, Unsure and Sure, and a suggested follow-up Retrieval session" width="900">
</picture>

The end screen compares confidence with results and spaces follow-ups by accuracy.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/plan-dark.png">
  <img src="docs/images/plan-light.png" alt="Plan page for INFO 1300 Prelim 2: a list of plans with days until each exam, progress through the plan, and dated sessions with their mode, topics and status, plus Reschedule sessions and Export calendar buttons" width="900">
</picture>

A plan lists sessions by day with mode, topics and status.

<table>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/study-dark.png">
        <img src="docs/images/study-light.png" alt="Study page recommending an Error repair session for 9 unresolved errors, with the five modes, a length picker and today's planned session">
      </picture>
      Study recommends the next session.
    </td>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/cards-review-dark.png">
        <img src="docs/images/cards-review-light.png" alt="Flashcard review with the answer shown and Again, Hard, Good and Easy buttons with their next intervals">
      </picture>
      Flashcard review.
    </td>
  </tr>
  <tr>
    <td>
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/chat-dark.png">
        <img src="docs/images/chat-light.png" alt="Chat answer about srcset and sizes with numbered citations and one source opened to show the quoted passage">
      </picture>
      Chat with one source opened.
    </td>
    <td>
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/progress-dark.png">
        <img src="docs/images/progress-light.png" alt="Progress page with mastery by topic for four courses, weakest first, with a Practice button on each topic">
      </picture>
      Progress, weakest topics first.
    </td>
  </tr>
  <tr>
    <td>
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/settings-dark.png">
        <img src="docs/images/settings-light.png" alt="Settings with sections for profile, study preferences, appearance, Google Calendar, AI features, data and account">
      </picture>
      Settings.
    </td>
    <td>
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/signin-dark.png">
        <img src="docs/images/signin-light.png" alt="Sign-in card with email and password fields, Forgot password, Create account and Sign in">
      </picture>
      Sign in.
    </td>
  </tr>
  <tr>
    <td align="center">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/home-phone-dark.png">
        <img src="docs/images/home-phone-light.png" alt="Home on a phone with an exam countdown card, today's session and a bottom navigation bar" width="300">
      </picture>
      <br>Home on a phone.
    </td>
    <td align="center">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="docs/images/session-feedback-phone-dark.png">
        <img src="docs/images/session-feedback-phone-light.png" alt="Feedback on a phone after a wrong answer marked Sure, showing the Confident error note, one numbered source and the student's correction above an Incorrect sheet" width="300">
      </picture>
      <br>Feedback on a phone.
    </td>
  </tr>
</table>

## Tech stack

- Next.js 16 (App Router), React 19, TypeScript
- Tailwind CSS 4 and shadcn/ui on Radix, restyled to Material 3 colour roles; Google Sans Flex via Fontsource
- PostgreSQL 16 through Prisma 7, with optional pgvector embedding search
- next-auth 4 (email and password), zod on the API routes
- One AI gateway for every model call, with caching, spending caps, timeouts, a circuit breaker and a kill switch; OpenAI in real use, a mock provider offline
- A PostgreSQL job queue for embedding work (`npm run worker`)
- Vitest, Playwright and axe-core

## Project layout

```
src/app          pages and API routes; s/[sessionId] holds the session screens
src/components   shell, lesson (session building blocks), ui (shadcn), one folder per screen
src/services     plans, session runs, feedback, flashcards, progress
src/lib          spacing, mastery and question rules, AI gateway, search, jobs, auth, email
src/__tests__    Vitest tests; integration/ needs PostgreSQL
prisma           schema, migrations, manual-scripts/001_pgvector.sql
e2e              Playwright specs and helpers
scripts          setup, worker, seed scripts, screenshot harness
docs             LEARNING_SCIENCE.md and these screenshots
```

## Testing

- `npm run test:unit`: Vitest, no database.
- `npm run test:integration`: needs a migrated test database in `DATABASE_URL`, set in the shell because Vitest doesn't read `.env`. Without it those files skip.
- `npm run test:e2e`: Playwright starts its own server with the offline providers on `E2E_PORT` (default 3000, so pick another while `npm run dev` runs), against a database whose name contains `e2e`. It runs every spec on desktop Chrome and the `@mobile` ones on a Pixel 7; `@a11y` tests run axe with the WCAG A and AA rules through 2.2. Setup steps are in [e2e/README.md](e2e/README.md).
- `npm run lint` and `npm run typecheck`.

[CI](.github/workflows/ci.yml) runs on pushes and pull requests to `main`: lint, typecheck and build in one job, unit tests in another, then integration tests against a pgvector PostgreSQL service, then the e2e suite split into two shards, each with its own database and production build.

`npm run screenshots -- --base http://localhost:3000 --out <dir>` captures every page of the demo account in both themes at desktop and phone sizes. Options are listed at the top of `scripts/screenshots.ts`.

## Configuration

`.env.example` documents every variable. The ones that matter most:

- `DATABASE_URL`, plus `NEXTAUTH_URL` and `BASE_URL`, which must match the origin you browse to. If port 3000 is taken, Next moves to 3001 and sign-in breaks until they match.
- `AI_PROVIDER`, `OPENAI_API_KEY`, the `AI_*_COST_CAP_USD` caps, and `AI_DISABLED`.
- `GOOGLE_PROVIDER` (`fake` or `real`) with `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
- `EMAIL_PROVIDER` (`console` or `smtp`) with the `SMTP_*` settings. Without SMTP, a production server turns password reset off. Leave `REQUIRE_EMAIL_VERIFICATION` off until mail works.
- `ADMIN_USER_IDS` for the `/api/admin/*` endpoints, and `TRUSTED_PROXY_HOPS` when running behind a proxy.

`ALLOW_TEST_AUTH` makes the server trust an `X-User-Id` header. It is for the e2e suite only; never set it on a real server.

Rate limits and the AI circuit breaker live in memory, so run the app as one long-lived Node process (`npm run build`, then `npm start`).

## Design

[DESIGN.md](DESIGN.md) covers the colour roles, type scale, shapes, motion and components. The shell (Home, Plan, Study, Cards, Guides, Chat, Progress, Settings) follows Material 3 the way Google's own web apps do: white and pale blue-grey surfaces, one blue for actions, a navigation rail. A session or card review hides the shell and switches to a lesson layout modelled on Duolingo, with one question per screen, a thick progress bar, answer cards that press down, and a feedback sheet that slides up. The type changes too: the session screens turn Google Sans Flex's roundness axis from 0 to 100 and step the weight up, so the same family reads square in the shell and rounder in a session. Both modes have light and dark themes. In development, `/design` renders every token and component.

## Security

See [SECURITY.md](SECURITY.md) for reporting a problem.

## License

MIT. See [LICENSE](LICENSE).
