# Study-Bot

A research-backed studying platform. You upload your course materials, and
Study-Bot turns them into retrieval-based study sessions, spaced review
schedules, and a week-by-week plan built backwards from your exam date. Every
mechanic in the app — questions before notes, immediate elaborated feedback,
confidence ratings, mixed-up practice decks, errors that only resolve after
repeated correct recalls on different days — traces to a specific finding in
the learning-science literature. The what and the why, with citations, effect
sizes, and the boundary conditions where each technique is deliberately *not*
applied, is documented in **[docs/LEARNING_SCIENCE.md](docs/LEARNING_SCIENCE.md)**.

Stack: Next.js 14 (App Router) + TypeScript, PostgreSQL + Prisma, Zod,
NextAuth, Vitest + Playwright.

## Study modes

| Mode | What happens | Why |
|------|--------------|-----|
| `RETRIEVAL` | A deck of free-recall and MCQ questions generated from your materials (or deterministic templates without them), scored immediately with elaborated feedback. | Testing effect: retrieval beats restudy by ~50% at a week's delay (Roediger & Karpicke 2006). |
| `INTERLEAVED_PRACTICE` | The same retrieval loop, but prompts are round-robin mixed across objectives — never more than 2 consecutive from one objective. AI-generated decks are re-interleaved before the run starts. | Interleaving forces strategy *choice*, not just execution (Rohrer & Taylor 2007). It feels harder; that's the mechanism. |
| `EXAM_SIM` | Two phases: answer every question with no feedback, then a forced review phase where you score each answer. | Simulates test conditions and exercises self-monitoring. The only place feedback is delayed — and the review is mandatory so no MCQ ends without answer confirmation. |
| `ERROR_REPAIR` | A deck built from your unresolved error logs. Repair prompts test the correction without revealing it; confident misses are prioritized. An error resolves only after 2 correct retrievals on different days. | Hypercorrection + successive relearning: confidently-held errors are the most correctable — and the most likely to resurface without spaced re-testing (Butterfield & Metcalfe 2001; Rawson & Dunlosky 2011). |
| `WORKED_EXAMPLES` (new) | For procedural topics: a fully worked example (each step states the action *and* the licensing principle), then completion problems with the last step missing, then the last two, then a full near-transfer problem with a model answer. | Worked-example effect with backward fading (Sweller & Cooper 1985; Renkl 2002) — the right on-ramp for novices, faded off within the session to avoid expertise reversal. |

Every runnable session shares the same spine: optional pretest diagnostics for
never-studied objectives (quarantined from grading — wrong answers there are
the point), warm-up prompts for objectives that are due for review, timed
work/break cycles (`25_5`, `50_10`, `90_15`, ...), variant questions injected
after misses, and full resumability — progress persists after every attempt,
so a refresh or crash loses nothing.

## The feedback loop

- **Commit before reveal.** No answer, hint, or excerpt is shown before you
  submit an attempt. The no-leakage guardrail is enforced server-side and
  covered by an E2E test.
- **Model answers.** Generated prompts carry a model answer and key points,
  revealed once you've answered and *before* you self-score — you grade
  against a standard, not a feeling (never during the exam phase of
  `EXAM_SIM`). MCQ is graded by the server against the stored key.
- **Immediate elaborated feedback.** Misses get cited excerpts from your own
  uploaded materials, an explanation of the specific gap, a key takeaway, a
  mnemonic when warranted, and per-distractor rationales for MCQ. Feedback is
  persisted per attempt, so it survives refresh. Correct answers get brief
  reinforcement instead of the full apparatus.
- **Hypercorrection.** You rate confidence (1-5) before seeing the answer.
  Confident misses get the most emphatic correction, top priority in repair
  decks, and an SM-2 penalty so the objective resurfaces sooner. The
  end-of-session calibration dashboard shows your confidence-vs-accuracy gap.
- **Active correction.** A miss requires a correction rule in your own words,
  spawns a variant question later in the same session, and enters the
  cross-day repair pipeline. Optional self-explanation, generate-your-own
  example, and an answerable Socratic follow-up close the loop generatively.

## Spaced repetition and flashcards

Two SM-2-based schedulers:

- **Objective mastery** — per-objective ease/interval/repetitions updated from
  each run's accuracy, with confidence-weighted quality. Exam-aware: intervals
  compress as the exam approaches (daily review inside 3 days; ~20% of
  remaining days when further out, per Cepeda et al. 2008). Due objectives
  resurface automatically as warm-ups in your next run.
- **Flashcards** — decks you create, plus cards auto-generated from your
  errors (question on the front, correction-first on the back). Standard
  Again/Hard/Good/Easy grading with the same exam-aware compression; failed
  cards return in 10 minutes within the same sitting.

Sessions end with follow-up recommendations derived from the SM-2 due dates
of the objectives you just studied (falling back to accuracy brackets —
<70%: return in 1 and 2 days; 70-85%: 2 and 4; >85%: 3 and 6).

## Planning and calendar

The week planner (`/plan`) takes your exam date, objectives (or uploaded
documents), daily availability, and a break protocol, and schedules sessions
backwards from the exam — diagnostics and retrieval packs early, interleaved
mixes in the middle, exam sim + error repair near the end. Plans export as:

- **ICS download / webcal feed** — import into any calendar app.
- **Google Calendar sync** — one-way, idempotent publish with hash-based
  change detection, republish, and unpublish. OAuth tokens are encrypted at
  rest (AES-256-GCM). Connect at `/settings/calendar`.

## Course content and search

Upload PDFs and notes into three namespaces: the Course Knowledge Base (feeds
question generation and post-answer feedback), the Practice Bank (import your
own MCQ/short-answer/coding questions), and the Study Science KB (the research
library backing the app's own policies — seed it with `npm run
db:seed-research`). Upload and processing are separate, resumable steps;
processed chunks are searched with PostgreSQL full-text search (no external
services), with optional embedding-based hybrid search behind
`HYBRID_SEARCH_ENABLED` (embedding jobs run on the background worker). All
generated questions and feedback cite the exact chunks they came from.

## Getting started

Prerequisites: Node 20.19+ (see `.nvmrc`), PostgreSQL.

```bash
npm install
cp .env.example .env   # then set DATABASE_URL (and NEXTAUTH_SECRET)
npx prisma generate
npx prisma migrate dev
npm run dev            # http://localhost:3000
```

The app runs with no external services by default: `AI_PROVIDER=mock` uses
deterministic prompt templates, `GOOGLE_PROVIDER=fake` stubs calendar sync,
and `EMAIL_PROVIDER=console` logs email to stdout.

### Environment variables

`.env.example` documents all of them; the ones that matter most:

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | PostgreSQL connection string. |
| `NEXTAUTH_SECRET` / `NEXTAUTH_URL` | Yes (prod) | NextAuth session signing + canonical URL. Generate the secret with `openssl rand -base64 32`. |
| `BASE_URL`, `NEXT_PUBLIC_APP_URL` | Yes (prod) | App base URL used in links, ICS, and OAuth callbacks. Defaults to `http://localhost:3000`. |
| `AI_PROVIDER` | No | `mock` (default) or `openai`. Question generation, feedback, worked examples, plan generation, and study guides use the AI gateway; the mock provider keeps everything runnable offline. |
| `OPENAI_API_KEY` | When `AI_PROVIDER=openai` | Provider credential. |
| `AI_MODEL_ANSWER`, `AI_MODEL_EMBED` | No | Model IDs for generation and embeddings (defaults: `gpt-4o-mini`, `text-embedding-3-small`). |
| `AI_DAILY_COST_CAP_USD`, `AI_MONTHLY_COST_CAP_USD`, `AI_DISABLED` | No | Per-user spend caps and an emergency kill switch. |
| `TOKEN_ENC_KEY` | For Google sync (required in prod) | 32-byte key (64 hex or 44 base64 chars) for AES-256-GCM encryption of OAuth tokens. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_PROVIDER` | For Google sync | OAuth credentials; `GOOGLE_PROVIDER=fake` for test/CI, `real` for production. |
| `CRON_SECRET`, `ADMIN_USER_IDS` | No | Shared secret for internal/cron endpoints; comma-separated user IDs allowed into `/admin`. |
| `EMAIL_PROVIDER`, `SMTP_*`, `VAPID_*` | No | Email reminders (console or SMTP) and web-push notifications. |
| `HYBRID_SEARCH_ENABLED` | No | Enables embedding-augmented search (requires the worker and an embedding-capable provider). |
| `JOB_WORKER_CONCURRENCY`, `JOB_POLL_INTERVAL_MS` | No | Background worker tuning. |
| `ALLOW_TEST_AUTH` | Never in prod | Trusts the `X-User-Id` header as identity for testing. Auth is NextAuth; the header fallback only works outside production or with this flag explicitly set. |

### Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` / `npm run build` / `npm start` | Next.js dev server / production build / serve. |
| `npm test` | All Vitest tests. |
| `npm run test:unit` | Unit tests only — no database needed. |
| `npm run test:integration` | Integration tests — needs PostgreSQL (`DATABASE_URL`). |
| `npm run test:e2e` | Playwright E2E — needs PostgreSQL + browsers (`npx playwright install --with-deps chromium` first time). |
| `npm run worker` | Background job worker (embedding batches; polls `job_queue` with `SKIP LOCKED`). |
| `npm run db:migrate` / `db:push` / `db:generate` | Prisma migrations / schema push / client generation. |
| `npm run db:seed-research` | Seed the Study Science KB with the research library. |
| `npm run lint` | ESLint. |
| `npm run assets:build` / `assets:check` | Optimize design assets and enforce size budgets (auto-runs before build). |

### Running tests

```bash
npm run test:unit

DATABASE_URL="postgresql://postgres:postgres@localhost:5432/studybot_test" npm run test:integration

DATABASE_URL="postgresql://postgres:postgres@localhost:5432/studybot_e2e" npm run test:e2e
```

CI (`.github/workflows/quality-gate.yml`) runs typecheck, unit, integration
(with a PostgreSQL service container), and headless E2E.

## Project layout

```
src/app/         Routes: home, /plan, /s/:sessionId (session runner),
                 /flashcards, /guides, /learn, /settings, /api/*
src/services/    Domain logic: run, feedback, plan, content, publish,
                 spaced-repetition, flashcards, reflow, ...
src/lib/         Core libraries: prompts, mastery (SM-2), spacing,
                 validation, ai/ (gateway + prompt registry), jobs, calendar
prisma/          Schema + migrations
scripts/         worker, seeders, asset pipeline
docs/            LEARNING_SCIENCE.md — the research foundation
```

## Further reading

If you want to know *why* the app behaves the way it does — why it won't show
you the answer before you commit, why interleaved sessions feel worse than
blocked ones, why an error you fixed yesterday comes back tomorrow — read
[docs/LEARNING_SCIENCE.md](docs/LEARNING_SCIENCE.md). It covers each principle
with primary citations, the concrete feature that implements it, and the
boundary conditions where the app intentionally does the opposite (immediate
feedback everywhere except exam simulation, spacing abandoned for compression
in the final days before an exam, worked examples faded out to avoid the
expertise-reversal effect).
