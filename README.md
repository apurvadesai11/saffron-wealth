# Saffron Wealth

A personal-wealth app built on the Boglehead and FIRE philosophy: track what you have, track what you spend, and close the gap between financial intention and real-time awareness. Set monthly budgets, track spending with color-coded progress bars, track net worth across accounts, and get contextual alerts before you overspend.

> **Status:** v0.3 — Monthly Budget and Net Worth (Phases 1–3) shipped on a production-grade auth foundation. All first-class financial data is persisted to Postgres. Planning features (projections, FIRE calculator, retirement) are next — see [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Features

### Net Worth (shipped)
- **Total Assets / Total Liabilities / Net Worth** computed only from accounts, never from transactions
- **12 account types across 5 buckets** — Cash; Investments (Brokerage, RSU, ESPP, HSA); Retirement (Traditional IRA, Roth IRA, 401(k), Roth 401(k)); Real Estate (Property); Debt (Credit Card, Loan/Mortgage)
- **Add / edit / delete accounts**, including changing an account's type across the asset↔liability line (which re-signs its existing balance history)
- **Net-worth-over-time chart** — hand-rolled SVG, range selector for 3M / 6M / YTD / 1Y / 3Y / 5Y / 10Y / MAX
- **Append-only balance history** — `AccountBalanceEvent` distinguishes `asOf` (the balance's own date) from `recordedAt` (write time), so backfilled history and live edits coexist
- **Archived accounts** in a collapsed group, excluded from totals, with a Restore action (soft delete via `archivedAt`)
- **Monarch balance-history import** — one global CSV backfills every account's history, with a preview, in-file and cross-file dedup, and a "Type disagreements" block that surfaces stored-type-vs-imported-sign conflicts for the user to resolve rather than silently re-typing accounts

### Monthly Budget (shipped)
- **Pre-commitment budgeting** — Set monthly budget targets for income and expense categories
- **Auto-Set All** — Populate budgets from 12-month historical spending averages in one click
- **Color-coded progress bars** — Green/yellow/red/deep-red for expenses; inverse model for income tracking
- **Threshold alerts** — In-app notifications at 80% and 100% of expense budgets with remaining dollars and days; alerts auto-reset when a budget increase pushes spend back below the threshold
- **Monthly Review widget** — Budget / Cashflow tabs with a shared month navigator and Earned / Spent / Net summary cards pinned above the tab content
- **Month navigation** — Review budget performance for any past or future month

### Cashflow (shipped)
- **Budgeted income, budgeted expenses, and projected net** for the current month
- **Per-category spend-rate extrapolation** to month-end, with a sub-label that distinguishes a live projection from the plan alone

### Transactions (shipped)
- **Add and delete transactions**, filter by type, category, date range, amount range, and free-text search
- **Server-side paging and filtering** over a bounded hydration window, so the list scales past the import volume
- **Monarch transaction CSV import** — parses the real 11-column export, upserts accounts and categories by name, and dedups on Monarch's stable `Id` via `Transaction.externalHash`. Transfer-like rows (transfers, balance adjustments, credit-card payments) are routed by category name rather than amount sign, so moving your own money never lands in income or expense

### Accounts & auth (shipped)
- Email/password registration and sign-in (Argon2id hashing, HIBP k-anonymity check, common-password blocklist)
- Google OAuth sign-in (manual OIDC flow, no Auth.js)
- Password reset via email (Resend) with 15-minute single-use tokens
- Profile management — name, email, password, profile picture (Vercel Blob in prod; EXIF stripped, re-encoded to WebP)
- Session management — sign out of one device or all devices
- Per-account exponential backoff on failed logins (Postgres advisory locked), IP rate limiting (Upstash sliding window with in-memory fallback)
- CSRF double-submit, secure cookie defaults, full audit log

### Not yet built

Tracking is in good shape; **planning is one month deep**. The app can tell you where this month lands and nothing beyond that. Notably absent: investment holdings (accounts carry a balance only — no positions, cost basis, or asset allocation), loan amortization and payoff dates, a financial profile (salary, birth date, target retirement age), net-worth projections, a FIRE calculator, and retirement planning. Sequencing and rationale live in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 15 (App Router, Server Components by default) |
| Language | TypeScript (strict mode) |
| UI | React 19, Tailwind CSS 3 |
| Database | PostgreSQL 16 via Prisma 5 |
| Charts | Hand-rolled inline SVG (no charting library) |
| CSV parsing | `papaparse` (a deliberate exception to the no-dependency house style — real Monarch exports contain quoted fields with embedded commas) |
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

Every first-class domain is persisted in Postgres: users, sessions, OAuth accounts, profile data, password-reset tokens, failed logins, audit events, **accounts, account balance history, categories, transactions, and budgets**.

The one exception is **alert dismissals**, which live in React state in `AppProvider` and reset on reload — deliberately, since the cost of losing one is that a dismissed alert re-shows.

`lib/mock-data.ts` still exists but is **test-fixture data only** now, used by `renderWithApp` and the E2E fixture. Production never falls back to it: the `(app)` layout always passes real (possibly empty) arrays.

Money is stored as `Decimal(14,2)` in Postgres and converted to a JS `number` at the query-layer boundary, since `Prisma.Decimal` otherwise serializes to a JSON string and would silently break `.toFixed()` call sites downstream.

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
    transactions/page.tsx    Transactions list + filters + add form + CSV import
    net-worth/page.tsx       Net worth chart, summary, accounts by bucket
    profile/page.tsx         Account, password, picture, sessions
  (auth)/                    Unauthenticated route group
    login, register, password-reset, password-reset/[token]
  api/
    accounts/                list/create, [id] patch/archive, balance-history import
    transactions/            list/create, [id] delete, import
    budgets/                 read/upsert budgets
    auth/                    login, register, logout, logout-all, me, oauth/google/*, password-reset/*
    profile/                 read/update profile, change password, upload picture
    cron/                    sweep-sessions (daily), sweep-audit-events (weekly)
components/
  Sidebar, SidebarNavItem, TopHeader, SummaryCards, MonthlyReviewWidget, MonthNavigator
  BudgetCategoryList, BudgetCategoryRow, BudgetProgressBar, BudgetEditModal
  CashflowCard, AlertBanner, AlertPanel, AlertsButton
  TransactionForm, TransactionList, TransactionFilters, MonarchImportModal
  NetWorthClient, NetWorthChart, NetWorthSummaryCards, AccountBucketGroup,
  AccountRow, AccountEditModal, ArchivedAccountsGroup, BalanceHistoryImportModal
  auth/                      AuthCard, GoogleSignInButton, PasswordStrengthHint,
                             ProfilePictureUploader, AvatarFallback, AuthFormError
lib/
  types.ts                   Domain types (Category, Transaction, Budget, Account, alerts, projections)
  budget-utils.ts            Pure business logic (period bounds, spend calc, alerts, projections)
  account-utils.ts           Account taxonomy (type→bucket), net-worth math, balance formatting
  net-worth-history.ts       Balance events → net-worth-over-time series
  accounts.ts                Account query layer (Decimal→number at the boundary)
  categories.ts              Category query layer
  transactions.ts            Transaction query layer (server-side filter + page)
  budgets.ts                 Budget query layer
  csv.ts                     papaparse wrapper + header validation
  monarch-transform.ts       Pure row→domain transforms shared by both imports
  transaction-import.ts      Phase 2b import pipeline
  balance-history-import.ts  Phase 3 import pipeline
  *-validation.ts            Hand-rolled validation (account, budget, transaction)
  app-context.tsx            React Context provider (hydrated from Postgres)
  mock-data.ts               Test fixtures only — not a production fallback
  use-alert-state.ts         Derived-state hook for the alert bell + widget
  nav-config.ts              Sidebar nav registry
  db-errors.ts               Prisma error → user-facing message mapping
  prisma.ts                  PrismaClient singleton
  auth/                      sessions, csrf, password, rate-limit, exponential-backoff,
                             hibp, blocklist, google-oauth, oauth-state, reset-tokens,
                             picture-storage, validation, audit-log, email, server
prisma/
  schema.prisma              User, Session, OAuthAccount, PasswordResetToken,
                             FailedLogin, AuthEvent, Account, AccountBalanceEvent,
                             Category, Transaction, Budget
  migrations/                Versioned SQL migrations — the full schema. `migrate
                             deploy` on an empty database produces a working app
proxy.ts                     Next.js Edge middleware (cookie shape check + CSRF cookie)
middleware.ts                Re-exports from proxy.ts
e2e/                         Playwright tests + worker-scoped auth fixture
docs/
  ROADMAP.md                                    Now / Next / Later roadmap
  saffron-wealth-monthly-budget-prd.md          Monthly Budget PRD + implementation log
  saffron-wealth-net-worth-phase1-plan.md       Net Worth Phase 1 plan
  saffron-wealth-net-worth-phase2-3-plan.md     Net Worth Phases 2b & 3 plan
scripts/
  fetch-blocklist.mjs        Refreshes lib/auth/blocklist-data.ts
CLAUDE.md                    In-depth project context for AI coding agents
```

## Getting Started

### 1. Postgres

All application data is backed by Postgres via Prisma. Start a local instance and create a database:

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

### 3. Install + apply migrations + run

```bash
npm install                # also installs the pre-push git hook
npm run db:deploy          # applies prisma/migrations — creates every table
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

You'll be redirected to `/login` — create an account at `/register`, then the (app) routes unlock.

### 4. Load your data (optional)

Both imports live behind buttons in the UI and accept Monarch Money CSV exports:

- **Transactions** — Transactions page → import. Upserts accounts and categories by name.
- **Balance history** — Net Worth page → import. One global file (`Date, Balance, Account`) that backfills the chart.

Each import shows a preview before it writes, and both are safe to re-run: transactions dedup on Monarch's stable `Id`, and balance events dedup per account-and-date.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server on :3000 |
| `npm run build` | Production build (runs `prisma generate`) |
| `npm run start` | Serve production build |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run check:env` | Verify the env vars the source reads match `.env.example` |
| `npm test` | Run Vitest unit tests |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:e2e` | Run Playwright E2E tests (boots its own dev server on :3100; needs Postgres) |
| `npm run test:e2e:ui` | Playwright in UI mode |
| `npm run db:generate` | `prisma generate` |
| `npm run db:deploy` | Apply pending migrations (setup, CI, and deploy path) |
| `npm run db:migrate` | Author a new migration after editing `schema.prisma` |
| `npm run db:status` | Report whether `schema.prisma` has drifted from the migrations |
| `npm run db:push` | Force the schema on without a migration — **escape hatch only**; it is how five tables of drift went unnoticed |

A pre-push git hook runs `lint`, `typecheck`, and `test` before every push (installed automatically by `npm install`).

## Testing & CI

- **Unit tests** — Vitest. The bar is one test file per module in `lib/` and one colocated `*.test.tsx` per component. Where color or styling encodes meaningful state, components expose a semantic `data-*` attribute and tests assert on that rather than on Tailwind class strings, so the UI can be reskinned without invalidating tests.
- **E2E** — Playwright spins up its own dev server on port 3100 (so it never collides with local dev on :3000) and uses a worker-scoped fixture that creates a real `User` + `Session` row and pre-sets the session cookie.
- **CI** — GitHub Actions runs lint → build → unit → e2e against a `postgres:16` service container on every push to `main` and every PR. CI applies the schema with `prisma migrate deploy` and then runs `prisma migrate status`, so a model added to `schema.prisma` without a migration fails the build instead of surfacing at deploy time.

## Further reading

- [`docs/ROADMAP.md`](docs/ROADMAP.md) — What's shipped, what's next, and why in that order
- `docs/saffron-wealth-monthly-budget-prd.md` — Monthly Budget PRD and chronological implementation log
- `docs/saffron-wealth-net-worth-phase1-plan.md` — Net Worth Phase 1 (accounts + current net worth)
- `docs/saffron-wealth-net-worth-phase2-3-plan.md` — Net Worth Phases 2b & 3 (Monarch imports + over-time chart)
- `CLAUDE.md` — In-depth architecture, auth subsystem, and conventions for AI coding agents
