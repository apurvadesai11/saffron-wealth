# Saffron Wealth — Project Context

A context file for future Claude sessions working on Saffron Wealth. The repo
`README.md` covers the same ground at a higher level; this file goes deeper on
architecture, auth, conventions, and gotchas.

---

## Part 1 — Product

### Purpose

A **personal project** built to learn vibe coding and practice software-building
skills end-to-end. Stretch goal: build it well enough and securely enough that
the author can rely on it as their own primary personal-finance tool.

It's not a commercial product. Architectural decisions should weigh "good
learning + good craft" alongside (sometimes ahead of) "minimum viable scope."

### Mission

**Make it easy to manage and grow personal wealth.**

### Goal

Provide the tooling and insights to **achieve financial goals** — concrete
decisions, course-corrections, and visibility, not just dashboards.

### Philosophy

Rooted in two financial worldviews:

- **Boglehead philosophy** — low-cost passive investing, broad diversification,
  long time horizon, ignore short-term noise.
- **FIRE** (Financial Independence / Retire Early) — high savings rate, lifestyle
  inflation discipline, optimizing the gap between earn and spend so capital
  compounds.

When a product decision involves a tradeoff (e.g. complexity vs. signal,
short-term reward vs. long-term clarity), bias toward the choice a Boglehead /
FIRE-minded user would respect.

### Product surface (intended, full vision)

The app is intended to grow into an integrated personal-wealth platform:

- Net worth tracking (Phase 1 shipped; see below)
- Transaction management
- Budgets (shipped; see below)
- Cashflow reports
- Investment tracking
- Real estate tracking
- Loan tracking
- Net worth projections
- FIRE calculator
- Retirement planning

### What's shipped right now (v1 scope)

The first feature delivered against the vision is the **Monthly Budget** module.
PRD: `docs/saffron-wealth-monthly-budget-prd.md`.

The second is **Net Worth Phase 1** — accounts + the current net worth number.
Plan: `docs/saffron-wealth-net-worth-phase1-plan.md`. It is the **first real
financial-data persistence** in the app (see the table below) and is deliberately
scoped to exclude the net-worth-over-time graph and the Monarch CSV import,
which are later phases (named in the plan so the data model doesn't need to
change to support them).

User-visible v1 capabilities:

- **Pre-commitment monthly budgets** per income & expense category.
- **Auto-Set All Budgets** — populate every category from its 12-month
  historical average in one click; only shown when there are still unbudgeted
  categories.
- **Color-coded progress bars**
  - Expense: green (<80%) → yellow (≥80%) → red (≥100%) → deep-red (>100%).
  - Income (inverse model): red (<50%) → orange (≥50%) → yellow (≥80%) →
    green (≥100%).
- **Threshold alerts** at 80% and 100% of expense budgets, in-app only, behind
  a bell icon in the top nav. Each alert shows category, %, remaining $, and
  days left in month. Alerts reset automatically when a budget increase drops
  spend back below a previously-fired threshold (FR-19).
- **Monthly Review widget** with Budget / Cashflow tabs and a shared month
  navigator. Earned / Spent / Net summary cards pinned above tab content.
- **Transactions** screen (separate route) with add/delete, filter by type,
  category, date range, amount range, and free-text search.
- **Net Worth** screen (separate route, persisted) — Total Assets / Total
  Liabilities / Net Worth summary; accounts grouped by bucket (Cash,
  Investments, Retirement, Real Estate, Debt); add / edit (incl. changing
  type) / delete an account. No graph yet (Phase 3).
- **Profile** screen — name/email edit, password change, avatar upload, single
  & global sign-out.
- **Authentication** — full email/password + Google OAuth sign-in, password
  reset by email, session management.

### What's intentionally out of v1

From the PRD:
- Cross-month budget carryover (rollover).
- Budget templates / recommended budgets.
- Goal-linked budget automation.
- Quarterly / semi-annual / annual budget periods (the **data model already
  supports these** — see `BudgetPeriod` in `lib/types.ts` and the period
  helpers in `lib/budget-utils.ts`; the UI just doesn't expose them yet).
- Push / email notifications for alerts (in-app only in v1).

### Persistence: what's real vs. mock

| Domain                                | Persisted? | Where                                              |
|--------------------------------------- |----------- |--------------------------------------------------- |
| Users, sessions, OAuth accounts        | ✅ Postgres | `prisma/schema.prisma` (`User`, `Session`, `OAuthAccount`) |
| Password reset tokens                  | ✅ Postgres | `PasswordResetToken` (stored only as SHA-256 hash) |
| Failed login attempts                  | ✅ Postgres | `FailedLogin`                                      |
| Audit events                           | ✅ Postgres | `AuthEvent`                                        |
| Profile pictures                       | ✅ Vercel Blob (prod) / `public/uploads/avatars` (dev) | `lib/auth/picture-storage.ts` |
| **Accounts**                            | ✅ Postgres | `Account` model (soft-deleted via `archivedAt`) — `lib/accounts.ts` |
| **Account balance history**             | ✅ Postgres | `AccountBalanceEvent` — append-only, one row per create + per balance change; not surfaced in UI yet (Phase 3 graph) |
| **Categories**                         | ✅ Postgres | `Category` (soft-deleted via `archivedAt`) — `lib/categories.ts` |
| **Transactions**                       | ✅ Postgres | `Transaction` — `lib/transactions.ts`              |
| **Budgets**                            | ✅ Postgres | `Budget` — `lib/budgets.ts`                        |
| **Alert dismissals**                   | ❌ In-memory | React state in `AppProvider` — resets on reload, low-stakes (just re-shows a dismissed alert) |

Net Worth Phase 1 + Phase 2a (this) cover all first-class financial data —
see "Architecture: Accounts / Net Worth" and "Architecture: financial-data
hydration" below. `MOCK_CATEGORIES` / `MOCK_TRANSACTIONS` / `MOCK_BUDGETS` in
`lib/mock-data.ts` still exist but are **test-fixture data only** now (used by
`renderWithApp` and the E2E fixture) — production never falls back to them
(the `(app)` layout always passes real, possibly empty, arrays). Monarch CSV
import (Phase 2b) and the net-worth-over-time graph (Phase 3) are the
remaining, fully-planned phases — see
`docs/saffron-wealth-net-worth-phase2-3-plan.md`.

---

## Part 2 — Technical

### Stack

| Layer            | Choice                                                                 |
| ---------------- | ---------------------------------------------------------------------- |
| Framework        | Next.js 15 (App Router, Server Components by default)                  |
| Language         | TypeScript (strict mode, `paths: { "@/*": ["./*"] }`)                  |
| UI               | React 19, Tailwind CSS 3 (no component library)                        |
| ORM / DB         | Prisma 5 on Postgres 16                                                |
| Password hashing | Argon2id via `@node-rs/argon2` (m=64MB, t=3, p=4)                      |
| Email            | Resend (no-ops to console when API key is absent)                      |
| Rate limiting    | Upstash Redis with in-memory fallback                                  |
| File storage     | Vercel Blob in prod; `public/uploads/avatars` in dev                   |
| Image processing | `sharp` (resize → 512×512 WebP, EXIF stripped) + `file-type` MIME-sniff |
| Unit tests       | Vitest + happy-dom + Testing Library                                   |
| E2E              | Playwright (Chromium, dedicated port 3100)                             |
| Deployment       | Vercel (cron jobs declared in `vercel.json`)                           |
| Lint             | ESLint flat config extending `next` + `next/core-web-vitals`           |

No state library (Zustand/Redux). No form library. No validation library
(Zod) — validation is hand-rolled in `lib/auth/validation.ts` to match the
existing house style in `TransactionForm` and `BudgetEditModal`.

### Top-level layout

```
app/
  layout.tsx               Root layout — fonts, metadata. No AppProvider here — see below.
  globals.css              Tailwind + theme vars (light mode only)
  error.tsx                Next.js error boundary
  (app)/                   Auth-gated route group
    layout.tsx             getSession() gate + fetches categories/transactions/budgets and
                            wraps children in AppProvider (financial-data hydration)
    page.tsx               Monthly Review (SummaryCards + MonthlyReviewWidget)
    transactions/page.tsx  Transactions list + filters + add form
    net-worth/page.tsx     Net Worth summary + account management (RSC; real Postgres)
    profile/page.tsx       Account / password / picture / sessions
  (auth)/                  Unauthed route group
    layout.tsx
    login/page.tsx
    register/page.tsx
    password-reset/page.tsx
    password-reset/[token]/page.tsx
  api/
    auth/{login,register,logout,logout-all,me}/route.ts
    auth/password-reset/{request,confirm}/route.ts
    auth/oauth/google/{start,callback}/route.ts
    profile/route.ts                  Read & PATCH profile
    profile/change-password/route.ts
    profile/picture/route.ts
    profile/__tests__/                Integration tests for /api/profile/*
    accounts/route.ts                 GET (list) + POST (create) — real Postgres
    accounts/[id]/route.ts            PATCH (update) + DELETE (soft-delete/archive)
    accounts/__tests__/                Integration tests for /api/accounts/*
    transactions/route.ts             POST (create) — real Postgres
    transactions/[id]/route.ts        DELETE
    transactions/__tests__/           Integration tests for /api/transactions/*
    budgets/route.ts                  PUT — batch upsert (one manual edit or Auto-Set All)
    budgets/__tests__/                Integration tests for /api/budgets/*
    cron/sweep-sessions/route.ts      Daily — expired sessions + reset tokens
    cron/sweep-audit-events/route.ts  Weekly — audit log retention
components/
  Sidebar.tsx, SidebarNavItem.tsx, TopHeader.tsx, SummaryCards.tsx
  MonthlyReviewWidget.tsx, MonthNavigator.tsx
  BudgetCategoryList.tsx, BudgetCategoryRow.tsx, BudgetProgressBar.tsx
  BudgetEditModal.tsx, CashflowCard.tsx
  AlertsButton.tsx, AlertBanner.tsx, AlertPanel.tsx
  TransactionForm.tsx, TransactionList.tsx, TransactionFilters.tsx
  NetWorthClient.tsx, NetWorthSummaryCards.tsx, AccountBucketGroup.tsx,
  AccountRow.tsx, AccountEditModal.tsx
  *.test.tsx                          RTL unit tests colocated with each component
  __tests__/test-utils.tsx            renderWithApp + category fixtures
  auth/
    AuthCard.tsx, AuthFormError.tsx, AvatarFallback.tsx,
    GoogleSignInButton.tsx, PasswordStrengthHint.tsx, ProfilePictureUploader.tsx
lib/
  types.ts                 Domain types — Category, Transaction, Budget, Account, etc.
  budget-utils.ts          Pure business logic — period bounds, spend calc, alerts, projections
  account-utils.ts         Pure business logic — bucket/type taxonomy, net-worth math
  account-validation.ts    Hand-rolled validators + body parsers for /api/accounts
  accounts.ts              Prisma query layer for Account/AccountBalanceEvent (server-only)
  categories.ts            Query layer: listCategories + seedDefaultCategories (no API route —
                            read via RSC hydration, written only at registration / Phase 2b import)
  transactions.ts          Query layer for Transaction (server-only); UTC-safe date <-> string helpers
  transaction-validation.ts  Hand-rolled validators + body parser for POST /api/transactions
  budgets.ts               Query layer: listBudgets + saveBudgets (batch upsert, server-only)
  budget-validation.ts     Hand-rolled validators + body parser for PUT /api/budgets
  db-errors.ts             InvalidReferenceError — cross-user FK reference caught by query layers
  app-context.tsx          AppProvider — hydrated from Postgres by app/(app)/layout.tsx (see below)
  mock-data.ts             Test-fixture data only (renderWithApp, E2E fixture) — not read in production
  use-alert-state.ts       Derives currently-active alerts (used by sidebar bell + widget)
  nav-config.ts            Sidebar nav item registry (icons + labels + routes)
  prisma.ts                PrismaClient singleton (avoids dev hot-reload leaks)
  auth/                    See "Auth subsystem" below
prisma/
  schema.prisma            Auth models + Account/AccountBalanceEvent + Category/Transaction/Budget
                            (db-push managed, no migration file — see Gotchas)
  migrations/20260430043115_init_auth/migration.sql
proxy.ts                   Next.js middleware (re-exported from middleware.ts)
proxy.test.ts              Unit tests for proxy
middleware.ts              `export { proxy as default, config } from "./proxy"`
e2e/                       Playwright tests + worker-scoped auth fixture (incl. sw_csrf cookie)
docs/saffron-wealth-monthly-budget-prd.md   Monthly Budget PRD + Implementation Log
docs/saffron-wealth-net-worth-phase1-plan.md   Net Worth Phase 1 plan (Accounts + page) — shipped
docs/saffron-wealth-net-worth-phase2-3-plan.md Phase 2b (Monarch import) + Phase 3 (graph) — planned, not built
scripts/fetch-blocklist.mjs   Refreshes lib/auth/blocklist-data.ts
.githooks/pre-push         Runs lint + typecheck + unit tests before every push
.github/workflows/ci.yml   GitHub Actions: lint, build, unit, e2e (Playwright)
vercel.json                Vercel cron schedule
```

### Architecture: routing + auth gate

Two cooperating layers protect `(app)/*`:

1. **`proxy.ts` (Edge middleware)** — Edge runtime can't run Prisma, so the
   middleware does a cheap **shape check** on the session cookie (regex against
   the base64url token pattern). If absent/malformed → redirect to `/login`
   with a `?next=` param. It also issues the **CSRF double-submit cookie**
   (`sw_csrf`) on auth pages, because Next.js 15 Server Components can read
   but not write cookies.

2. **`app/(app)/layout.tsx` (Server Component, `async`)** — Calls
   `getSession()` from `lib/auth/server.ts` inside a `try`/`catch`, treating
   any throw or `null` return as "no session" → `redirect("/login")`. This
   does the **real DB-backed validation**. A forged cookie that happens to
   match the regex passes the proxy but is rejected here. A transient DB
   outage logs users out (fail closed) rather than leaking pages. This
   double-gate is explicitly tested in `e2e/auth-middleware.spec.ts`
   (forged-cookie tests).

The matcher in `proxy.ts` lets through Next internals, `/api/auth/*`,
`/api/cron/*`, the favicon, and the `/saffron.*` brand image. Cron endpoints
self-authenticate via `CRON_SECRET` (Bearer header) so they don't need the
middleware.

Auth page paths (`/login`, `/register`, `/password-reset`, …) are matched but
not gated — the middleware just ensures the CSRF cookie is set before the page
renders.

### Architecture: financial-data hydration (`lib/app-context.tsx`)

`AppProvider` lives in `app/(app)/layout.tsx` now (there is no `app/providers.tsx`
— it was removed; `(auth)` pages never call `useApp()`, so wrapping only the
`(app)` tree is correct and avoids provisioning financial data for the login/
register/reset flows). The `(app)` layout is an `async` Server Component: it
fetches `listCategories` / `listTransactions` / `listBudgets` for the session
user in parallel and passes the results as `AppProvider`'s `seedCategories` /
`seedTransactions` / `seedBudgets` props — the client never re-fetches on
first paint.

State slices:

- `transactions`, `budgets` — hydrated from Postgres, then mutated locally on
  each successful API call (see below)
- `categories` — a plain prop, not stateful; there is no create/edit/delete UI
  for categories yet (only registration-time seeding and, later, Phase 2b's
  import upsert-by-name touch this table)
- `dismissedKeys` — unchanged: in-memory only, lifted to context so the
  sidebar `AlertsButton` and `MonthlyReviewWidget` share it

**Mutations are async and hit real API routes**, mirroring the
`NetWorthClient` pattern from Phase 1 (`readCsrfCookie()` + `CSRF_HEADER_NAME`,
branch on `!res.ok || !data.ok`, update local state from the response):

- `addTransaction` → `POST /api/transactions`
- `deleteTransaction` → `DELETE /api/transactions/[id]`
- `saveBudgets(entries)` → `PUT /api/budgets` — **always a batch**, even for a
  single manual edit, so there's one upsert call and one source of truth for
  the resulting list whether it's `MonthlyReviewWidget`'s `handleSave` (one
  entry) or `handleAutoSetAll` (many). There is no `setBudgets` setter exposed
  anymore — budgets can only change through `saveBudgets`.

**Test-only `offline` prop.** Component tests (`renderWithApp`) still need
mutations to update state *synchronously*, with no network — existing tests
assert on the result immediately after a click with no `waitFor`. Rather than
mock `fetch` everywhere, `AppProvider` takes an `offline?: boolean` prop
(always `true` via `renderWithApp`, never set in production) that makes
`addTransaction` / `deleteTransaction` / `saveBudgets` mutate local state
directly instead of calling the API. This is the same seed-prop pattern
already used for test fixture injection, just extended slightly — the branch
is unreachable in production because nothing else passes it.

`AppProvider`'s `seedCategories` / `seedTransactions` / `seedBudgets` fall back
to `MOCK_*` only when omitted entirely, which never happens in production (the
`(app)` layout always passes real arrays) — this fallback exists purely so a
stray test that forgets to seed doesn't crash, not as a feature.

### Architecture: alert logic

Alerts are **derived state**, not accumulated state. `lib/use-alert-state.ts`
runs `useMemo` over `(categories, budgets, transactions, dismissedKeys)` and
returns the set of currently-active alerts.

Implications:

- FR-19 reset (alert disappears when budget increase drops spend below
  threshold) is automatic — there's nothing to clear.
- The "alert fires once per month" guarantee is maintained by tracking
  **dismissed** keys (`${categoryId}-${periodKey}-${threshold}`), not
  **fired** keys. A budget edit that moves spend back across a threshold
  calls `clearDismissedThresholds()` so the alert is eligible to re-appear
  on a future cross.
- Replaced an earlier `useEffect` + accumulator pattern that triggered the
  React 19 `react-hooks/set-state-in-effect` lint and had a missing-dep bug.

### Architecture: forward-compatible budget periods

`BudgetPeriod = 'monthly' | 'quarterly' | 'semi-annual' | 'annual'`.

Only `monthly` is exposed in the UI today, but **all helpers in
`lib/budget-utils.ts` accept the full union**:

- `getPeriodBounds(date, period)` → `[start, end]`
- `getPeriodKey(date, period)` → `"2026-01"`, `"2026-Q1"`, `"2026-H1"`, `"2026"`
- Alert records key off this string, so adding quarterly support is an
  activation, not a schema migration.

`getHistoricalAverage` only implements `monthly` today — extending it is one
of the obvious "easy second slice" opportunities.

### Architecture: Accounts / Net Worth (`lib/accounts.ts`, `lib/account-utils.ts`)

Net worth is **only ever computed from accounts** — `computeNetWorth` in
`lib/account-utils.ts` never touches `transactions`. This keeps Net Worth
decoupled from the mock budget/transaction system; it's the one place in the
app with real per-user Postgres persistence for financial data.

**Two-level taxonomy.** Every `Account.type` (a fixed string enum enforced in
the app layer, not a DB enum — mirrors `CategoryType`/`BudgetPeriod`) belongs to
exactly one `AccountBucket`: `cash`, `investments`, `retirement`,
`real_estate`, `debt`. Only the `debt` bucket is a liability
(`isLiability(bucket)`); everything else is an asset. `computeNetWorth` sums
assets, sums liabilities, and subtracts — liabilities are stored as a positive
"amount owed" (a $5k card balance is `5000`, not `-5000`).

**Soft-delete, not hard-delete.** "Deleting" an account (`archiveAccount` in
`lib/accounts.ts`, called by `DELETE /api/accounts/[id]`) sets `archivedAt`
rather than removing the row. `listAccounts` filters `archivedAt: null`.
Balance history is preserved so a future net-worth-over-time graph can still
reflect an account that's since been archived. This convention was recovered
from an earlier, uncommitted persistence experiment found live in the dev
database (which used `archivedAt` on `Account`/`Category`) — adopted
deliberately to stay consistent with that prior design.

**Balance history is append-only and silent.** `AccountBalanceEvent` gets one
row when an account is created (opening balance) and one more **only when a
`PATCH` actually changes `balance`** — editing name/type/institution alone
does not append a row. Nothing in the UI reads this table yet; it exists
purely so Phase 3 (the net-worth-over-time graph) has real history to chart
instead of starting from zero. `AccountBalanceEvent.userId` is denormalized
(not just derived via `accountId`) to support per-user history queries without
a join, and to keep a future pivot to `SetNull`-on-delete (if the graph needs
to show since-deleted accounts) a config change rather than a migration.

**Money: `Decimal(14,2)` in Postgres, `number` on the wire.** `lib/accounts.ts`
converts every `Decimal` to a JS `number` via `.toNumber()` before it leaves
the query layer (`Prisma.Decimal` otherwise serializes to a JSON *string*,
which would silently break `.toFixed()` call sites). This keeps `Account`
consistent with the rest of the app's dollars-as-`number` money model, while
storing balances exactly (no float rounding) with far more headroom than the
`amountCents` `Int` convention from the same earlier experiment would have
allowed for large values like real estate or retirement balances.

**No `AppProvider` involvement.** Unlike budgets/transactions/categories,
accounts are **not** seeded into or read from the mock `AppProvider` context.
`app/(app)/net-worth/page.tsx` is a Server Component that calls `listAccounts`
directly and hands the result to the client component `NetWorthClient`, which
owns local state and mutates via `/api/accounts` — the same self-contained
persisted-page pattern as `app/(app)/profile/page.tsx`.

**Schema changes are applied via `db push`, not migrations.** The dev database
has no `_prisma_migrations` tracking (CI also runs `prisma db push`), so the
`Account`/`AccountBalanceEvent` models were added by editing
`prisma/schema.prisma` and running `db:push` directly — there is no
corresponding file under `prisma/migrations/`.

### Auth subsystem (`lib/auth/`)

This is the most production-grade part of the codebase. It exists partly as a
learning vehicle — the author wanted to actually understand session and
credential security rather than delegate it.

| File                                | What it does                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `server.ts`                         | `getSession()` — reads the session cookie name (`__Host-sw_session` in prod, `sw_session` in dev) and calls `readSession()`.    |
| `sessions.ts`                       | Create/read/revoke/rotate sessions. Stores only `SHA-256(rawToken)` in DB. 30-day TTL. Debounces `lastSeenAt` updates to 60s.   |
| `session-cookie.ts`                 | `setSessionCookie` / `clearSessionCookie` with `HttpOnly`, `Secure` (prod), `SameSite=Strict`.                                  |
| `password.ts`, `password-rules.ts`  | Argon2id hash/verify; min 12 / max 128 chars; `getDummyHash()` for uniform-timing login failure.                                |
| `csrf.ts`, `csrf-shared.ts`, `csrf-client.ts` | Double-submit CSRF: non-HttpOnly `sw_csrf` cookie + `x-sw-csrf` header, constant-time compare.                        |
| `rate-limit.ts`                     | Sliding-window 5/min via Upstash; in-memory fallback for dev (UNSAFE across serverless instances — set Upstash in prod).        |
| `exponential-backoff.ts`            | Per-account backoff table `[0,1,2,4,8,16,32,60]` seconds keyed on `emailNormalized`. Uses a `pg_advisory_xact_lock` to close concurrent-bypass race. |
| `hibp.ts`                           | Pwned Passwords k-anonymity check — sends only first 5 chars of SHA-1, never the full hash or plaintext. Fails open with audit event. |
| `blocklist.ts`, `blocklist-data.ts` | Common-password blocklist (refreshable via `scripts/fetch-blocklist.mjs`).                                                       |
| `validation.ts`                     | Hand-rolled email / name / register-body / login-body validators.                                                                |
| `reset-tokens.ts`                   | Password-reset tokens — 15min TTL, SHA-256-hashed at rest, single-use (`consumedAt`).                                            |
| `email.ts`                          | Resend wrapper. With no API key configured, logs the message to console (handy for local dev).                                  |
| `google-oauth.ts`, `oauth-state.ts` | Manual Google OIDC flow (no Auth.js). State nonce in short-lived cookie, constant-time compare on callback.                      |
| `picture-storage.ts`                | Validates uploaded image bytes via `file-type` magic-byte sniff (NOT trusting `Content-Type`), re-encodes through `sharp` (drops EXIF, normalizes orientation, 512×512 WebP), uploads to Vercel Blob or local dir. 5MB cap. |
| `audit-log.ts`                      | `recordAuthEvent()` — never throws, never blocks the auth flow on its own failure.                                              |
| `request-info.ts`                   | Best-effort `clientIp()` + `userAgent()` from headers.                                                                          |

API routes mirror this: login uses a single Postgres transaction holding an
advisory lock so the rate-limit + verify + record-failure sequence can't be
raced (`app/api/auth/login/route.ts`). Always runs an Argon2 verify even on
unknown emails, to keep timing uniform.

Cron sweeps (`vercel.json`):
- `0 3 * * *` — `/api/cron/sweep-sessions` — expired sessions + consumed/expired reset tokens (>30 days).
- `0 4 * * 0` — `/api/cron/sweep-audit-events` — retention (default 365 days, override via `AUDIT_RETENTION_DAYS`, min 30).

Both gated by `Authorization: Bearer ${CRON_SECRET}`.

### Testing

Two test runners, three scopes:

- **Vitest unit tests** (`npm test`) — `happy-dom` env; excludes `e2e/**`.
  `vitest.setup.ts` runs `@next/env`'s `loadEnvConfig()` so tests see
  `.env`/`DATABASE_URL` the same way Next.js does.

  Three categories of unit tests:
  1. **`lib/auth/*.test.ts`** — one file per primitive (blocklist, csrf,
     exponential-backoff, google-oauth, hibp, oauth-state, password,
     picture-storage, reset-tokens, sessions). Pure-logic; no DB.
  2. **`lib/budget-utils.test.ts`**, **`proxy.test.ts`** — pure-logic tests
     for the budget engine and the Edge middleware. The proxy test uses a
     hand-rolled `NextRequest` shim.
  3. **API route integration tests** in `app/api/{profile,accounts,transactions,budgets}/__tests__/` —
     e.g. `route.test.ts`, `id.test.ts` (or feature-specific names like
     `picture.test.ts`, `change-password.test.ts`). These call the actual
     route handlers with a constructed `NextRequest` against a real local
     Postgres. `next/headers`' `cookies()` is mocked per file via
     `vi.hoisted(...)` + `vi.mock(...)`; each directory has its own
     `helpers.ts` with `seedUser()` / `seedSession()` / `makeRequest({csrfToken})`
     (and, for accounts/transactions/budgets, a `seedCategory()`/similar) —
     cloned per directory rather than shared, matching the "one test file per
     primitive" bar. Network-dependent paths (HIBP, Vercel Blob) are mocked
     per test. Ownership/cross-user isolation gets its own test in every one
     of these files (seed two users, assert user A can't touch user B's row).
  4. **Component unit tests** colocated as `components/*.test.tsx` — RTL +
     `@testing-library/jest-dom`. `components/__tests__/test-utils.tsx`
     exports `renderWithApp(ui, { categories?, transactions?, budgets? })`
     which wraps the UI in `AppProvider` with the optional seed props and
     `offline` (always on for tests — see "Architecture: financial-data
     hydration"). Components that only fetch their own data directly
     (`NetWorthClient`) don't need `renderWithApp` and have no colocated test
     — their mutation flow is covered by E2E instead.

- **Playwright E2E** (`npm run test:e2e`) — boots the Next dev server on port
  3100 (intentionally NOT 3000, so local dev never gets disturbed). Real
  Chromium. Real Postgres. `playwright.config.ts` calls `loadEnvConfig()`
  itself so fixtures see `DATABASE_URL`. `e2e/fixtures.ts` creates a
  worker-scoped `User` row + real `Session` row and pre-sets the `sw_session`
  cookie in the browser `context` fixture, so smoke tests get an
  authenticated session without going through the login form.

  Files: `e2e/smoke.spec.ts` (app shell, nav, alerts popover, transaction
  filters, budget editing, transaction persistence across a reload);
  `e2e/net-worth.spec.ts` (account add/edit/delete); `e2e/auth-middleware.spec.ts`
  (gating — proxy redirect, forged shape-valid cookie rejected by the (app)
  layout). `e2e/fixtures.ts`'s worker-scoped user is seeded with real Postgres
  rows built from `MOCK_CATEGORIES`/`MOCK_TRANSACTIONS`/`MOCK_BUDGETS` (Phase
  2a made financial data real, so `smoke.spec.ts`'s assertions — a Netflix
  transaction, a budgeted Groceries category with enough history for "Use
  this →" — need to actually exist in the DB now, not just in a mock array).

- **CI** (`.github/workflows/ci.yml`) — single job. Spins up a `postgres:16`
  service container, sets `DATABASE_URL`, runs `prisma db push` once, then
  lint → build → unit tests → install Playwright → e2e. Uploads
  `playwright-report/` on failure.

- **`.githooks/pre-push`** — runs lint + typecheck + unit tests before every
  push. Activated automatically via the `prepare` script in `package.json`
  (`git config core.hooksPath .githooks`).

Coverage notes:
- Heavy on auth — every primitive has a test file.
- Budget logic has one big test file (`lib/budget-utils.test.ts`), including
  the `'transfer'`-category-exclusion cases added in Phase 2a.
- All `/api/{profile,accounts,transactions,budgets}/*` routes have integration
  tests against real Postgres.
- All Budget* and Transaction* components have unit tests, plus
  `SummaryCards`, `MonthNavigator`, `MonthlyReviewWidget`, `AccountRow`,
  `AccountEditModal`, `NetWorthSummaryCards`. Smoke E2E exercises the
  integrated flows (including a real page reload to prove persistence).
- Proxy is unit-tested in `proxy.test.ts` with a hand-rolled `NextRequest`
  shim and also E2E'd in `e2e/auth-middleware.spec.ts`.

Testing gotchas (learned the hard way — repeat at your peril):
- **`happy-dom` doesn't always fire form `submit` from a button click.**
  Use `fireEvent.submit(form)` directly. Since `TransactionForm`'s
  `handleSubmit` became `async` (Phase 2a — it awaits `addTransaction`), the
  `submitForm()` helper in `components/TransactionForm.test.tsx` wraps that
  `fireEvent.submit` in `await act(async () => {...})` and every call site
  awaits it, so the state update flushes before assertions run.
- **`vi.useFakeTimers()` deadlocks `user-event`** (which uses real
  `setTimeout` internally). When you need to pin `Date`, use
  `vi.useFakeTimers({ toFake: ["Date"] })` — see `MonthlyReviewWidget.test.tsx`.
- **`NextRequest` doesn't parse a `Cookie` header into `req.cookies`.** In
  tests, construct the request then call `req.cookies.set(name, value)`.
- **`content-length` is a forbidden Fetch header.** You can't fake an
  oversized upload without sending a real oversized body. The byte cap is
  redundantly enforced by `validateImageBuffer` in `lib/auth/picture-storage.ts`,
  which is unit-tested directly.

### Conventions & house style

- **Validation is hand-rolled.** No Zod. Match the style in
  `lib/auth/validation.ts` / `components/TransactionForm.tsx`.
- **No state library.** React Context + `useState` + `useMemo`. If you reach
  for one, surface that as a design conversation first.
- **Server Components by default**, `"use client"` only where needed
  (`app/providers.tsx`, interactive forms, `app/(app)/transactions/page.tsx`,
  `app/(app)/profile/page.tsx`, etc.).
- **Tailwind classes must appear as full strings.** Tailwind v3 purges classes
  that aren't present verbatim in source. `BudgetProgressBar` / `AlertBanner`
  store color classes in constant maps as full strings (e.g.
  `'bg-green-500'`), never assembled at runtime.
- **`data-state` attribute for components where styling IS the signal.**
  When color/style carries semantic meaning (over-budget, threshold hit,
  hidden), add a stable `data-*` attribute alongside the Tailwind classes
  and have tests assert against the attribute, not the class string. See
  `BudgetProgressBar` (`data-state="green|yellow|orange|red|deep-red|hidden"`),
  `BudgetCategoryRow` (`data-over-budget`, `data-hidden`, `data-category-type`),
  and `AlertBanner` (`data-threshold="80|100"`, plus `role="alert"`). Lets
  the UI reskin without invalidating tests.
- **`parseLocalDate` for `YYYY-MM-DD`.** `new Date("YYYY-MM-DD")` parses as
  UTC midnight and shifts the displayed day in negative timezones. The helper
  in `lib/budget-utils.ts` splits and constructs in local time.
- **Comments explain WHY, not WHAT.** See
  `lib/auth/exponential-backoff.ts:11-12`, `proxy.ts:3-12`,
  `lib/auth/picture-storage.ts:13-17` for the tone.
- **Errors never crash auth flows.** `recordAuthEvent` swallows internally.
  Audit-log failures must not block the user-visible response.
- **Token storage:** raw tokens go in cookies / email links; only SHA-256
  hashes go in the database (sessions, reset tokens). The CSRF cookie is the
  one exception — it's the cookie half of a double-submit pattern, so the
  plaintext is intentionally readable by client JS.
- **Light mode only.** The `globals.css` dark-mode block was deliberately
  removed (PRD Implementation Log → Cleanup Pass).
- **Two route groups: `(app)` and `(auth)`.** Both render under the same root
  layout, but `(app)` has an additional layout that runs `getSession()` and
  draws the Sidebar + TopHeader chrome.

### Gotchas & non-obvious decisions

- **`middleware.ts` is a one-liner that re-exports from `proxy.ts`.** The
  rename was deliberate (clearer name; "middleware" is reserved by Next).
- **`app/(app)/layout.tsx` fails closed.** Wrap the `getSession()` call in
  `try {} catch {}` and treat any throw as "no session." A DB outage should
  log users out, not leak protected pages.
- **`getSession` is wrapped in `React.cache`** — it's safe to call multiple
  times within the same RSC render; only one DB query fires.
- **`isPassthrough` in the proxy is doubled up with the matcher regex** on
  purpose — the matcher hasn't been reliable across all Next/Vercel versions.
- **The `(app)` layout sets `ml-14 sm:ml-56`** — that's the width of the
  fixed-position sidebar. Changing sidebar width requires updating both.
- **Mock data is tuned to show every bar color on first load** (PRD
  Implementation Log → Phase 1). Don't "normalize" the mock data to all-green
  without thinking about visual QA.
- **`CashflowCard` is fully implemented but not currently rendered on the
  main page.** It's available as a building block for the future Cashflow tab
  / Reports surface (PRD → Post-Phase Changes).
- **`getHistoricalAverage` averages over months that *had* spend**, not over
  all 12 months — mirrors how a user mentally estimates "what do I normally
  spend on this?" If you change this, update the PRD note that calls it out.
- **`prepare` script in `package.json`** installs the git hooks pointer
  automatically on `npm install`. New contributors get pre-push checks
  without any extra step.
- **The dev database has no `_prisma_migrations` table.** Schema changes are
  applied with `prisma db push`, not `prisma migrate dev` — the one existing
  migration file under `prisma/migrations/` was never actually tracked as
  applied. Follow the same convention for new schema changes (see
  `package.json`'s `db:push` script); don't run `migrate dev`, which would try
  to initialize migration tracking against a database that doesn't have it.
- **Before adding a Prisma model, check the live dev DB for tables that aren't
  in `schema.prisma`.** During the Net Worth Phase 1 build, the dev DB turned
  out to contain an uncommitted, abandoned financial-persistence experiment
  (`Account`/`Category`/`Budget`/`Transaction` tables using `amountCents` +
  `archivedAt` conventions) that predated any code referencing it. It was
  cleaned up (dropped, except the `archivedAt` soft-delete convention, which
  was intentionally adopted for the new `Account` model). If you hit an
  unexpected table again, treat it the same way: inspect before touching, and
  ask before dropping anything with real user data.
- **`Category.id` / `Transaction.id` are global primary keys, not scoped per
  user.** `e2e/fixtures.ts`'s worker-scoped seed learned this the hard way:
  reusing `MOCK_CATEGORIES`' fixed ids (`'housing'`, `'groceries'`, ...)
  verbatim across Playwright's parallel workers collided on the PK. The fix —
  let Prisma generate real ids per worker and build a `mock id → real id` map
  before inserting `MOCK_TRANSACTIONS`/`MOCK_BUDGETS`, which reference
  categories by the mock id. If a fixture setup throws before calling `use()`,
  Playwright never runs that fixture's teardown code (the cleanup after
  `use()`) — a worker user created during a failed seed is orphaned, not
  auto-removed. Check for `e2e-worker-*@example.test` / `manual-smoke-*` stray
  users in the dev DB after a failed E2E run.
- **`CategoryType` includes `'transfer'`**, not just `'expense'`/`'income'` —
  added for Monarch-imported transfer-between-accounts rows. Every sum in
  `lib/budget-utils.ts` filters by strict equality (`t.type === 'income'` /
  `'expense'`), so a `'transfer'` value is excluded automatically everywhere —
  no additional filtering was needed when this was added. There is no budget
  UI for transfer categories and none is planned; `buildBudgetProgressList`
  excludes them the same way it excludes any category with no `Budget` row.

### Environment variables

`.env.example` lives at the repo root — copy to `.env` and edit. The Postgres
URL is the only hard requirement for local dev; everything else degrades
gracefully:

| Var                                 | Required for                         | Without it                                |
|-------------------------------------|--------------------------------------|-------------------------------------------|
| `DATABASE_URL`                      | Auth (anything DB-backed)            | App won't boot the (app) routes.          |
| `GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI` | Google sign-in flow         | Google button errors when clicked.        |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Password-reset emails              | Logs the email body to console instead.   |
| `UPSTASH_REDIS_REST_URL/TOKEN`      | Cross-instance rate limiting         | Falls back to per-process in-memory map.  |
| `BLOB_READ_WRITE_TOKEN`             | Avatar upload in production          | Writes to `public/uploads/avatars/`.      |
| `CRON_SECRET`                       | Vercel Cron endpoints                | Cron requests 401.                        |
| `AUDIT_RETENTION_DAYS`              | Override default 365-day retention   | Defaults to 365 (min 30).                 |
| `NEXTAUTH_URL`                      | Google callback base URL in prod     | Derives base from request URL.            |

### When you add a new feature

A few likely places that need a touch:

- **New nav surface?** Append to `NAV_ITEMS` in `lib/nav-config.ts`. The
  sidebar renders from this; no Sidebar.tsx edit needed.
- **New protected page?** Drop it inside `app/(app)/` — gating is automatic
  via the layout.
- **New unauthed page?** Drop it inside `app/(auth)/` and add the path to
  `AUTH_PATHS` in `proxy.ts` if you want the middleware to recognize it
  explicitly.
- **New API route that mutates server state?** Validate CSRF with
  `validateCsrfFromRequest(req)` at the top. Look at
  `app/api/profile/route.ts` or `app/api/auth/login/route.ts` for the pattern.
  For tests, copy the harness from `app/api/profile/__tests__/route.test.ts`:
  `vi.hoisted` + `vi.mock("next/headers")` for the session cookie, and
  `helpers.ts` for `seedUser`/`seedSession`/`makeRequest`.
- **New auth primitive?** Add a sibling file in `lib/auth/` and a matching
  `*.test.ts`. The bar in this directory is "one test file per module."
- **New React component?** Colocate a `*.test.tsx` next to it. Use
  `renderWithApp` from `components/__tests__/test-utils.tsx` if the
  component reads `useApp()`; plain `render` from RTL otherwise. If color
  or styling encodes meaningful state, add a `data-state` (or similarly
  semantic `data-*`) attribute and assert on it.
- **Building the Monarch CSV import (Phase 2b)?** Categories/Transactions/
  Budgets are real Postgres now (Phase 2a) — `Category`/`Transaction`/`Budget`
  models, `lib/{categories,transactions,budgets}.ts` query layers,
  `lib/{transaction,budget}-validation.ts`. `Transaction.externalHash` (+
  `@@unique([userId, externalHash])`) already exists in the schema for
  import-dedup — Phase 2a's manual-entry path just never sets it (`null`),
  since Postgres treats distinct `NULL`s as non-equal so the constraint
  doesn't get in the way. The import still needs to *upsert* categories/
  accounts by name (not create blindly) and compute that hash per row. See
  `docs/saffron-wealth-net-worth-phase2-3-plan.md` for the full, decision-complete
  pipeline design (transform rules, transfer handling, dedup, account-type guessing).

### Quick reference

```
npm run dev                Start Next.js dev server (port 3000)
npm run build              prisma generate && next build
npm run start              Serve production build
npm run lint               ESLint
npm run typecheck          tsc --noEmit
npm test                   Vitest unit tests
npm run test:watch         Vitest in watch mode
npm run test:e2e           Playwright E2E (boots dev server on :3100)
npm run test:e2e:ui        Playwright in UI mode
npm run db:generate        prisma generate
npm run db:push            prisma db push  (dev; bypasses migrations)
npm run db:migrate         prisma migrate dev
```
