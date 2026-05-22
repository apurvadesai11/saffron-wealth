# Saffron Wealth

A personal-wealth app built on the Boglehead and FIRE philosophy: track what you have, track what you spend, and close the gap between financial intention and real-time awareness. Set monthly budgets, track spending with color-coded progress bars, and get contextual alerts before you overspend.

> **Status:** v0.2 — Monthly Budget module shipped on top of a production-grade auth foundation. Roadmap below covers net worth, investments, real estate, loans, projections, FIRE calculator, and retirement planning.

## Features

### Monthly Budget (shipped)
- **Pre-commitment budgeting** — Set monthly budget targets for income and expense categories
- **Auto-Set All** — Populate budgets from 12-month historical spending averages in one click
- **Color-coded progress bars** — Green/yellow/red/deep-red for expenses; inverse model for income tracking
- **Threshold alerts** — In-app notifications at 80% and 100% of expense budgets with remaining dollars and days; alerts auto-reset when a budget increase pushes spend back below the threshold
- **Transaction management** — Add, delete, and filter transactions (type, category, date range, amount range, search)
- **Month navigation** — Review budget performance for any past or future month
- **Cashflow projections** — Per-category spend-rate extrapolation to month-end (data model in place; UI tab available)

### Accounts & auth (shipped)
- Email/password registration and sign-in (Argon2id hashing, HIBP k-anonymity check, common-password blocklist)
- Google OAuth sign-in (manual OIDC flow, no Auth.js)
- Password reset via email (Resend) with 15-minute single-use tokens
- Profile management — name, email, password, profile picture (Vercel Blob in prod; EXIF stripped, re-encoded to WebP)
- Session management — sign out of one device or all devices
- Per-account exponential backoff on failed logins (Postgres advisory locked), IP rate limiting (Upstash sliding window with in-memory fallback)
- CSRF double-submit, secure cookie defaults, full audit log

### Roadmap
Net worth tracking · investment tracking · real estate tracking · loan tracking · net worth projections · FIRE calculator · retirement planning · persisting budgets and transactions to Postgres.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 15 (App Router, Server Components by default) |
| Language | TypeScript (strict mode) |
| UI | React 19, Tailwind CSS 3 |
| Database | PostgreSQL 16 via Prisma 5 |
| Password hashing | Argon2id (`@node-rs/argon2`) |
| Email | Resend (no-ops to console when unconfigured) |
| Rate limiting | Upstash Redis (in-memory fallback for dev) |
| File storage | Vercel Blob (prod) / `public/uploads/` (dev) |
| Image processing | `sharp` + `file-type` magic-byte sniff |
| Unit tests | Vitest + happy-dom + Testing Library |
| E2E tests | Playwright (Chromium) |
| CI | GitHub Actions |
| Deployment | Vercel (with cron jobs for session/audit-log sweeps) |

### Persistence model

Auth, sessions, OAuth accounts, profile data, password-reset tokens, failed logins, and audit events are persisted in Postgres. **Categories, transactions, budgets, and alert dismissals are still seeded from in-memory mock data** (`lib/mock-data.ts`) and reset on page reload — wiring those to Postgres is the next major piece of work.

## Project Structure

```
app/
  layout.tsx                 Root layout (fonts, metadata, <Providers>)
  providers.tsx              Client component shim wrapping AppProvider
  error.tsx                  Error boundary
  globals.css                Tailwind + theme variables (light mode only)
  (app)/                     Auth-gated route group
    layout.tsx               DB-backed session gate + sidebar/header chrome
    page.tsx                 Monthly Review (summary cards + tabbed budget/cashflow)
    transactions/page.tsx    Transactions list + filters + add form
    profile/page.tsx         Account, password, picture, sessions
  (auth)/                    Unauthenticated route group
    login, register, password-reset, password-reset/[token]
  api/
    auth/                    login, register, logout, logout-all, me, oauth/google/*, password-reset/*
    profile/                 read/update profile, change password, upload picture
    cron/                    sweep-sessions (daily), sweep-audit-events (weekly)
components/
  Sidebar, TopHeader, SummaryCards, MonthlyReviewWidget, MonthNavigator
  BudgetCategoryList, BudgetCategoryRow, BudgetProgressBar, BudgetEditModal
  CashflowCard, AlertBanner, AlertPanel, AlertsButton
  TransactionForm, TransactionList, TransactionFilters
  auth/                      AuthCard, GoogleSignInButton, PasswordStrengthHint,
                             ProfilePictureUploader, AvatarFallback, AuthFormError
lib/
  types.ts                   Domain types (Category, Transaction, Budget, alerts, projections)
  budget-utils.ts            Pure business logic (period bounds, spend calc, alerts, projections)
  app-context.tsx            React Context provider (seeded from mock-data)
  mock-data.ts               Seed categories, transactions, budgets
  use-alert-state.ts         Derived-state hook for the alert bell + widget
  nav-config.ts              Sidebar nav registry
  prisma.ts                  PrismaClient singleton
  auth/                      sessions, csrf, password, rate-limit, exponential-backoff,
                             hibp, blocklist, google-oauth, oauth-state, reset-tokens,
                             picture-storage, validation, audit-log, email, server
prisma/
  schema.prisma              User, Session, OAuthAccount, PasswordResetToken,
                             FailedLogin, AuthEvent
  migrations/                Versioned SQL migrations
proxy.ts                     Next.js Edge middleware (cookie shape check + CSRF cookie)
middleware.ts                Re-exports from proxy.ts
e2e/                         Playwright tests + worker-scoped auth fixture
docs/
  saffron-wealth-monthly-budget-prd.md   Product requirements & implementation log
scripts/
  fetch-blocklist.mjs        Refreshes lib/auth/blocklist-data.ts
CLAUDE.md                    In-depth project context for AI coding agents
```

## Getting Started

### 1. Postgres

Auth (sessions, users, password reset, OAuth, audit log) is backed by Postgres via Prisma. Start a local instance and create a database:

```bash
brew services start postgresql@16
createdb saffron_dev
```

(Any Postgres 14+ works — adjust the URL accordingly. Docker users can run `docker run -d --name saffron-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16` and use `postgresql://postgres:postgres@localhost:5432/postgres`.)

### 2. Env

```bash
cp .env.example .env
```

Edit `.env` as needed. At minimum `DATABASE_URL` must point at a reachable Postgres. The OAuth, Resend, Upstash, and Blob keys are optional for local development — features that need them no-op or error individually (e.g. password-reset emails print to the console instead of sending when `RESEND_API_KEY` is unset).

### 3. Install + push schema + run

```bash
npm install                # also installs the pre-push git hook
npx prisma db push         # creates tables on first run
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

You'll be redirected to `/login` — create an account at `/register`, then the (app) routes unlock.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server on :3000 |
| `npm run build` | Production build (runs `prisma generate`) |
| `npm run start` | Serve production build |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Run Vitest unit tests |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:e2e` | Run Playwright E2E tests (boots its own dev server on :3100; needs Postgres) |
| `npm run test:e2e:ui` | Playwright in UI mode |
| `npm run db:generate` | `prisma generate` |
| `npm run db:push` | Push schema changes to the local DB |
| `npm run db:migrate` | Create and apply a new migration |

A pre-push git hook runs `lint`, `typecheck`, and `test` before every push (installed automatically by `npm install`).

## Testing & CI

- **Unit tests** — Vitest, one test file per `lib/auth/*` module plus `lib/budget-utils.test.ts` and `proxy.test.ts`.
- **E2E** — Playwright spins up its own dev server on port 3100 (so it never collides with local dev on :3000) and uses a worker-scoped fixture that creates a real `User` + `Session` row and pre-sets the session cookie.
- **CI** — GitHub Actions runs lint → build → unit → e2e against a `postgres:16` service container on every push to `main` and every PR.

## Further reading

- `docs/saffron-wealth-monthly-budget-prd.md` — Monthly Budget PRD and chronological implementation log
- `CLAUDE.md` — In-depth architecture, auth subsystem, and conventions for AI coding agents
