# Saffron Wealth — Net Worth Tracker, Phase 1 Plan

**Status:** In progress · **Branch:** `feat/net-worth-accounts` · **Scope:** Phase 1 of a multi-phase Net Worth feature.

---

## Context

Saffron Wealth's product vision includes net-worth tracking, but nothing in that
direction existed in the code. Two facts shaped this work:

1. **The app had no real financial-data persistence in code.** Transactions,
   budgets, and categories are all mock data (`lib/mock-data.ts`) seeded into React
   Context and re-seeded on every reload. The committed Prisma schema was auth-only.
2. **The goal is to rely on this as a real personal-finance tool** with real data,
   so the feature must be built on real Postgres persistence.

### Database discovery (important)

While preparing the schema change we found an **abandoned financial-persistence
experiment living only in the dev database** (`saffron_dev`), never committed to
code: tables `Account` (1 row), `Category` (9 rows), `Budget` (0), `Transaction`
(0). It revealed prior design choices — money as `amountCents` (Int), **soft-delete
via `archivedAt`**, `Category.sortOrder`, and a single unified `Account` table that
transactions linked to. The current code referenced none of it.

**Decision (user):** clean slate — drop the 4 orphan tables (auth/users untouched)
and build Phase 1 fresh, while **adopting the prior `archivedAt` soft-delete
convention** because it also preserves history for the future graph.

The database is **`prisma db push`–managed** (no `_prisma_migrations` tracking; CI
uses `db push` too), so schema changes are applied with `db push`, not migration
files.

### Key architectural insight

The net worth number is just the sum of account balances (assets − liabilities). It
reads **only** from accounts, never from transactions. That lets Phase 1 be a clean,
isolated slice that adds the first real financial persistence **without touching the
existing mock budget/transaction system.**

### Phase roadmap

- **Phase 1 (this plan):** Persist Accounts (soft-delete) + append-only balance
  history. Net Worth page: current net worth + account management. **No graph.**
- **Phase 2 (later):** Monarch CSV import on the Transactions page — parse the
  export, create/link accounts + categories + transactions, migrate categories
  app-wide.
- **Phase 3 (later):** Net-worth-over-time graph (3M/6M/YTD/1Y/3Y/5Y/10Y/MAX),
  driven by the `AccountBalanceEvent` history captured starting now.

### Decisions locked

- Sequence into phases on real Postgres persistence.
- Accounts are managed **on the Net Worth page** (no separate Accounts page).
- **Graph is out of Phase 1** (defers the "where does history come from" question).
- **Two-level taxonomy**; asset vs liability derives from the top-level bucket.
- **Fixed curated type enum** (users add account instances, not new type definitions).
- **Log every balance change** (append-only) for the future graph.
- **Clean slate** on the orphan tables; **soft-delete (`archivedAt`)**;
  **`Decimal(14,2)` at rest → `number` on the wire.**

### Out of scope (Phase 1)

The graph; CSV import; any change to mock transactions/budgets/categories;
multi-currency (USD only); negative asset balances (see Simplifications).

---

## Data model — `prisma/schema.prisma` (applied via `db push`)

Follows existing conventions: `@default(cuid())` ids, `userId` + `user ... onDelete: Cascade`
+ `@@index([userId])`. `User` gains back-relations `accounts` and `accountBalanceEvents`.

```prisma
model Account {
  id          String    @id @default(cuid())
  userId      String
  name        String
  type        String                        // AccountType union, enforced in app layer
  institution String?
  balance     Decimal   @db.Decimal(14, 2)   // positive; liabilities = amount owed
  balanceAsOf DateTime  @default(now())       // "as of {date}"; bumped only on balance change
  archivedAt  DateTime?                       // soft-delete; hidden from net worth, history kept
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  user           User                  @relation(fields: [userId], references: [id], onDelete: Cascade)
  balanceHistory AccountBalanceEvent[]

  @@index([userId])
}

model AccountBalanceEvent {
  id         String   @id @default(cuid())
  userId     String                          // denormalized for per-user history queries
  accountId  String
  balance    Decimal  @db.Decimal(14, 2)
  recordedAt DateTime @default(now())

  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  account Account @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([accountId, recordedAt])            // future graph: ordered time series
}
```

- **`type` is `String`**, not a DB enum — mirrors `CategoryType`/`BudgetPeriod` TS
  unions; the taxonomy lives in `lib/account-utils.ts`, so new types need no schema change.
- **Money = `Decimal(14,2)`** (exact cents, ~$1T headroom for property/retirement). The
  query layer converts to a JS `number` (`.toNumber()`) at the API boundary, because
  `Prisma.Decimal` serializes to a JSON *string* — the client-facing `balance` is a
  `number`, matching the app's money model.

---

## Taxonomy + net-worth math — `lib/types.ts` + `lib/account-utils.ts`

`lib/types.ts` adds the serialized shapes: `AccountBucket`, `AccountType`, `Account`
(`balance: number`, ISO date strings, no `archivedAt` on the wire), `NetWorthSummary`,
`AccountBucketGroup`, `AccountInput`, `AccountPatch`.

**Bucket → types:** Cash → `cash` · Investments → `brokerage, rsu, espp, hsa` ·
Retirement → `traditional_ira, roth_ira, 401k, roth_401k` · Real Estate → `property` ·
Debt → `credit_card, loan_mortgage`.

`lib/account-utils.ts` (pure, unit-tested — the only place net-worth math lives):
`BUCKET_ORDER`, `ACCOUNT_TYPES_BY_BUCKET`, `ACCOUNT_TYPE_TO_BUCKET`,
`ACCOUNT_BUCKET_LABELS`, `ACCOUNT_TYPE_LABELS`, `isValidAccountType`,
`getBucketForType`, `isLiability` (debt only), `computeNetWorth`,
`groupAccountsByBucket`. `computeNetWorth`: assets add, debt subtracts,
`netWorth = totalAssets − totalLiabilities`.

---

## Server query layer — `lib/accounts.ts` (server-only)

`mapAccount(row)` → `Decimal.toNumber()` + ISO strings.

- `listAccounts(userId)` — `where { userId, archivedAt: null }`, order by `createdAt`.
- `createAccount(userId, input)` — `$transaction`: create Account + opening `AccountBalanceEvent`.
- `updateAccount(userId, id, patch)` — ownership via `where { id, userId, archivedAt: null }`;
  `null` if not found; `$transaction` updates fields and, **only when `balance` changes**,
  sets `balanceAsOf = now` and appends one `AccountBalanceEvent`.
- `archiveAccount(userId, id)` — soft-delete: set `archivedAt = now` where not already
  archived; returns whether a row was affected. History is preserved.

---

## API routes — mirror `app/api/profile/route.ts`

Order: **session → CSRF → body parse → per-field validation → business logic**, in a
top-level `try/catch` → `500 INTERNAL_ERROR`. Success `{ ok:true, data }`; errors via
`err(code, message, status, fieldErrors?)`. GET = session only.

- `app/api/accounts/route.ts` — `GET` (list) · `POST` (create, 201).
- `app/api/accounts/[id]/route.ts` — `PATCH` (update; `null` → 404, doubling as ownership
  check) · `DELETE` (archive; false → 404). `params` is a Promise in Next 15 — `await` it.
- Validation: `lib/account-validation.ts` (hand-rolled; `parseCreateAccountBody` /
  `parseUpdateAccountBody`; update rejects an empty patch).

---

## Page + components

- `app/(app)/net-worth/page.tsx` — RSC, auto-gated by `(app)/layout.tsx`. Reads session,
  `listAccounts`, renders `<NetWorthClient initialAccounts={...} />`. `sw_csrf` is already
  set at login and readable client-side.
- `components/NetWorthClient.tsx` — owns account state + modal; derives summary/groups;
  mutates via `fetch` + `readCsrfCookie()` + `CSRF_HEADER_NAME` (profile pattern); empty state.
- `components/NetWorthSummaryCards.tsx` — Total Assets / Liabilities / Net Worth cards
  (template = `SummaryCards.tsx`); `data-net-worth-sign`.
- `components/AccountBucketGroup.tsx` — bucket section (label + total; `data-bucket`).
- `components/AccountRow.tsx` — name, type label, institution, `$balance`, "as of …";
  `data-liability`; edit/delete.
- `components/AccountEditModal.tsx` — add/edit modal (template = `BudgetEditModal.tsx`);
  name, type `<select>` grouped by bucket via `<optgroup>` (editable), institution, balance.
- Nav: append `{ href: "/net-worth", label: "Net Worth", icon }` to `NAV_ITEMS` in
  `lib/nav-config.ts` (inline SVG via `createElement` + shared `iconProps`).

---

## Tests

- **Unit:** `lib/account-utils.test.ts` (taxonomy completeness, `isLiability`,
  `computeNetWorth`, grouping) and `lib/account-validation.test.ts` (field validators +
  body parsers). *(Both written and green.)*
- **API integration** (`app/api/accounts/__tests__/`, real Postgres, `vi.mock("next/headers")`):
  401/403/400; VALIDATION_FAILED field errors; POST creates account + exactly one balance
  event; two-user isolation; PATCH name-only adds no history; PATCH balance change appends one
  event; PATCH type change persists (incl. asset↔liability flip); PATCH/DELETE another user's
  id → 404; **DELETE soft-deletes** — account disappears from GET but its row + balance history
  remain.
- **Component** (plain `render`): `NetWorthSummaryCards`, `AccountRow` (`data-liability`),
  `AccountEditModal` (validation, `<optgroup>`s, `onSave`, edit-mode prefill).
- **E2E** (`e2e/net-worth.spec.ts`): nav to `/net-worth`; add / edit-balance / delete flows.
  **Fixture fix:** add a readable `sw_csrf` cookie to `e2e/fixtures.ts` (`httpOnly:false`,
  token-pattern value) so real mutations don't 403.

---

## Decisions & simplifications

- Accounts are **standalone**, not in `AppProvider` (which is the mock system).
- **Soft-delete (`archivedAt`)**, matching the app's prior convention; preserves history.
- **`balanceAsOf`** backs "as of {date}", bumped only on balance change.
- Liabilities stored as positive "amount owed"; aggregation subtracts.
- **`balance >= 0`** — no negative asset balances in Phase 1 (deliberate).
- **USD only.**
- **`db push`**, not migration files (repo convention).
- Update the CLAUDE.md persistence table (Accounts → ✅ Postgres).

---

## Verification (end-to-end)

1. **DB:** orphan tables dropped; `Account` + `AccountBalanceEvent` created; users preserved. *(Done.)*
2. **Static:** `npm run lint`, `npm run typecheck` clean.
3. **Unit + integration:** `npm test` green (esp. balance-history + soft-delete + isolation assertions).
4. **E2E:** `npm run test:e2e` green; `net-worth.spec.ts` passes (proves the CSRF fixture fix).
5. **Manual** (`npm run dev`, sign in): "Net Worth" in sidebar → add brokerage ($10k) + credit
   card ($2k) → Net Worth $8,000.00 (Assets $10,000.00 / Liabilities $2,000.00) → edit card
   balance, confirm number + "as of" update → **reload, confirm persistence** → delete an
   account, confirm it disappears while its history row remains in the DB.

---

## Critical files

- `prisma/schema.prisma` — Account (soft-delete) + AccountBalanceEvent + User back-relations. *(Done.)*
- `lib/types.ts` — account types. *(Done.)*
- `lib/account-utils.ts` (+ test) — taxonomy + net-worth math. *(Done, green.)*
- `lib/account-validation.ts` (+ test) — validators + parsers. *(Done, green.)*
- `lib/accounts.ts` — query layer + history append + soft-delete. *(To build.)*
- `app/api/accounts/route.ts`, `app/api/accounts/[id]/route.ts` (+ `__tests__/`). *(To build.)*
- `app/(app)/net-worth/page.tsx` + the 5 components (+ tests). *(To build.)*
- `lib/nav-config.ts` — Net Worth nav item. *(To build.)*
- `e2e/fixtures.ts` (sw_csrf) + `e2e/net-worth.spec.ts`. *(To build.)*
