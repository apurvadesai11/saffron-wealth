# Saffron Wealth — Net Worth Tracker, Phases 2b & 3 Plan

**Status:** Planned, not yet built. **Phase 2a is shipped** (branch `feat/net-worth-accounts`,
uncommitted at time of writing) — see `docs/saffron-wealth-net-worth-phase1-plan.md` for Phase 1
and the "Phase 2a" section below for what Phase 2a actually delivered. This document covers the
two remaining phases and is decision-complete (no open questions) — ready to build.

---

## Context

The full Net Worth vision: upload Monarch history → derive accounts/categories/transactions →
chart net worth over time. Phases 1 and 2a are done. What's left:

- **Phase 2b — Monarch CSV transaction import.** A CSV upload on the Transactions page that
  parses a real Monarch export, upserts accounts + categories by name, and imports transactions
  into the Phase 2a tables.
- **Phase 3 — Net-worth-over-time graph.** A per-account Monarch **balance-history** import to
  backfill `AccountBalanceEvent`, plus a hand-rolled SVG line chart on the Net Worth page with
  3M/6M/YTD/1Y/3Y/5Y/10Y/MAX range filters.

Phases are independent (the graph doesn't need the transaction import) but are still built and
reviewed one at a time.

### Recap: Phase 2a (shipped)

Categories, Transactions, and Budgets are real Postgres now (`Category`, `Transaction`, `Budget`
models — soft-delete via `archivedAt` where applicable, `Decimal(14,2)` money). `AppProvider`
hydrates from the DB via `app/(app)/layout.tsx`; mutations (`addTransaction`, `deleteTransaction`,
`saveBudgets`) are async and hit real API routes. `CategoryType` is `'expense' | 'income' |
'transfer'` — `'transfer'` is excluded from every sum in `lib/budget-utils.ts` automatically via
strict equality checks, no special-casing needed elsewhere. `Transaction.id` is a string cuid.
`Transaction` already has `accountId`, `merchant`, `notes`, and `externalHash` columns
(`@@unique([userId, externalHash])`) — unused by Phase 2a's manual-entry path (all `null`), but
in place so Phase 2b needs no further migration.

### Monarch export schema — validated against the user's real file

Verified empirically against `…/Finance/Transactions_June_2026.csv` (7,314 rows), not just docs:

- **Transaction export = 9 columns:** `Date, Merchant, Category, Account, Original Statement,
  Notes, Amount, Tags, Owner`. `Owner` is undocumented by Monarch; in this file it was
  single-valued and `Tags` was empty — both ignorable for a single-user app, but the parser
  should tolerate the legacy 8-column export (no `Owner`) too.
- **Date = `YYYY-MM-DD`** (matches `Transaction.date`). Parse defensively anyway — format could
  drift or differ for other users/exports.
- **Amount = single signed decimal**, expense negative / income positive, no parentheses observed.
  → `type = amount < 0 ? 'expense' : 'income'`, store `abs(amount)`.
- **`Account` and `Category` are plain name strings** — no type, no institution column. Import
  upserts both by name.
- **Categories observed in the real file (52 total)** include `Transfer` (590 rows, both signs —
  confirms paired-row transfers), `Credit Card Payment`, `Balance Adjustments`, `Uncategorized`,
  plus normal spending categories (Groceries, Restaurants, Mortgage, ...).
- **Quoted fields contain commas** — confirmed. A naive `split(',')` breaks; a real CSV parser
  (RFC 4180 aware) is required.
- **16 distinct accounts** in the real file.
- **Balance-history export (Phase 3)** is a *separate* Monarch feature: per-account, `Date,
  Balance` (`YYYY-MM-DD`), **liabilities negative**, duplicate dates rejected by Monarch itself,
  no account column (one file per account, uploaded per-account on the Net Worth page).

**Implementation step 0 for both phases:** re-validate the header against whatever file is
actually uploaded and fail loudly on mismatch — don't assume the schema never drifts.

---

## Decisions (confirmed with the user this session — no longer open)

1. **Transfer-type categories:** `Transfer`, `Balance Adjustments`, **and `Credit Card
   Payment`** are all excluded from income/expense (imported with `type: 'transfer'`).
   All three represent money moving between the user's own accounts or a data correction,
   not real income or spending — counting a card payment as an expense would double-count
   it alongside the original purchase transactions that ran up the balance. Category-type
   inference (dominant transaction sign) is skipped for all three; they're routed to
   `type: 'transfer'` directly by name match.
2. **Auto-created account type:** best-guess from the account name via keyword matching (see
   Phase 2b transform section), falling back to `cash` when nothing matches. The user still
   reviews/corrects on the Net Worth page — this only reduces how much of the 16-account
   cleanup is needed.
3. **CSV parser: `papaparse`.** This is a deliberate, acknowledged exception to the app's
   no-dependency house style (no Zod, hand-rolled auth, hand-rolled chart) — CSV correctness
   (quoted fields, embedded newlines/commas, escaped quotes) is a well-known "don't reinvent
   this" problem for financial data import specifically, unlike, say, a line chart. Add
   `papaparse` + `@types/papaparse` as real dependencies when building Phase 2b.
4. **Import UX: preview, then confirm.** Given the file is ~7,300 rows, upload → parse →
   show a summary (new transactions, new accounts, new categories, duplicates skipped, date
   range) → user confirms → commit. Not one-shot.

### Still a judgment call (not asked directly — flagged here, default stated)

- **Negative balances in the Phase 3 balance-history import:** Monarch's export could show a
  historical dip (e.g. a brief overdraft or margin balance). Default: **allow negative values
  in imported `AccountBalanceEvent` rows** (clamping would misrepresent the actual historical
  net worth on the graph), but keep Phase 1's existing rule that an account's *current*
  `balance` field can't go negative — if the most recent imported point is negative, clamp
  the account's live balance to 0 and surface a note rather than silently mismatching the
  last chart point against the summary card. Revisit if this actually comes up in the user's
  data (rare in practice).

---

## Phase 2b — Monarch CSV transaction import

**Goal:** "Import from Monarch" on the Transactions page that ingests a transaction export into
the Phase 2a tables, sourcing accounts + categories from the file.

### Pipeline

1. **Upload** — button on `app/(app)/transactions/page.tsx` → multipart POST to
   `app/api/transactions/import/route.ts` (mirror `app/api/profile/picture/route.ts`:
   `runtime = "nodejs"`, size cap, CSRF, `req.formData()`).
2. **Parse** — `lib/csv.ts` wraps `papaparse` (header row → objects, `skipEmptyLines: true`).
3. **Validate header** — expect the 9 known columns; tolerate the legacy 8 (no `Owner`);
   require at minimum Date/Account/Amount/Category. Fail loudly with a clear message (and
   the actual header found) on mismatch.
4. **Transform each row:**
   - `date`: parse `YYYY-MM-DD` defensively (reuse the UTC-safe helpers from `lib/transactions.ts`,
     or extract them to a shared spot if needed).
   - `amount`: signed → `type = amount < 0 ? 'expense' : 'income'`, store `abs`. Defensively
     strip `$`/`,`/parentheses in case a different export variant uses them.
   - **Transfer routing:** if `Category` (case-insensitive) is `Transfer`, `Balance
     Adjustments`, or `Credit Card Payment` → `type = 'transfer'` regardless of sign,
     excluded from income/expense math. This set is a named constant (e.g.
     `TRANSFER_LIKE_CATEGORIES`) so adding another one later is a one-line change, not a
     code change.
   - **Upsert Category** by `(userId, name)`. For non-transfer categories, infer `type` from
     the category's dominant transaction sign across the import batch (tie/unknown →
     `expense`); auto-assign `color` round-robin from a fixed palette. `Transfer`/`Balance
     Adjustments`/`Credit Card Payment` categories get `type: 'transfer'` directly (skip
     sign inference).
   - **Upsert Account** by `(userId, name)`. New accounts: guess `type` from the name via
     keyword matching (case-insensitive substring), e.g. `"roth 401k"` → `roth_401k` (check
     before plain `"401k"`), `"401k"`/`"401(k)"` → `401k`, `"roth ira"` → `roth_ira`,
     `"ira"` → `traditional_ira`, `"hsa"` → `hsa`, `"espp"` → `espp`, `"rsu"` → `rsu`,
     `"mortgage"` → `loan_mortgage`, `"loan"` → `loan_mortgage`, `"credit card"`/card-network
     names → `credit_card`, `"brokerage"`/`"invest"` → `brokerage`, `"property"`/`"home"`/
     `"house"`/`"real estate"` → `property`, else → `cash`. Balance starts at 0 (the import is
     transaction history, not a balance snapshot — the user sets the real current balance on
     the Net Worth page; Phase 3's *separate* balance-history import is what actually backfills
     balances). Existing accounts matched by name are left alone (type/balance untouched).
   - **Dedup:** `externalHash = sha256(date|abs(amount)|account|merchant|originalStatement)`.
     `createMany({ skipDuplicates: true })` against the existing
     `@@unique([userId, externalHash])` constraint, so re-importing an overlapping date range
     is safe and idempotent.
   - Ignore `Owner`, `Tags`; keep `merchant` (from `Merchant`), `notes` (from `Notes`).
5. **Preview → confirm:** parsing (steps 2–4, minus the actual DB writes) returns a summary —
   new transaction count, new accounts (with guessed types) needing review, new categories,
   duplicates that will be skipped, date range covered. User confirms; the commit runs
   steps 4's writes in a batched `$transaction` (categories/accounts upserted first, then
   transactions).

### Tests

- `lib/csv.test.ts` — quoted fields, embedded commas, the 9-col + legacy-8-col headers,
  malformed header rejection.
- Transform unit tests — sign→type, `abs`, `Transfer`/`Balance Adjustments`/`Credit Card
  Payment` routing to `'transfer'`, dedup-hash stability, category-type inference,
  account-type keyword guessing (one case per keyword pattern).
- API integration — import a small fixture CSV → correct rows/accounts/categories with expected
  types; re-import the same file → all rows skipped as duplicates, counts reflect that.
- E2E — upload a tiny fixture, see the preview summary, confirm, see the imported rows.
- **Real-data verification step** (not an automated test): actually import the user's
  `Transactions_June_2026.csv` in dev and manually verify account list, category list,
  transaction count, that a second import of the same file changes nothing, and that
  `Transfer`/`Balance Adjustments`/`Credit Card Payment` don't move the Monthly Review
  income/expense totals.

---

## Phase 3 — Net-worth-over-time graph

**Goal:** the chart originally envisioned for the Net Worth page, fed by real history.

### Balance-history import (the data source)

- Per-account upload on the Net Worth page (Monarch "Download balance history": `Date,
  Balance`, one file per account, uploaded from that account's row/edit view) →
  `app/api/accounts/[id]/balance-history/route.ts`.
- Reuse `lib/csv.ts` (papaparse). Transform: Monarch liability balances are **negative**; this
  app's debt-bucket accounts store **positive amount-owed** → for debt accounts store
  `abs(balance)`; asset accounts store as-is (see the negative-balance judgment call above).
  Create `AccountBalanceEvent` rows; **dedup by `(accountId, date)`** (Monarch itself rejects
  duplicate dates on its side, but re-imports of an overlapping range should still be safe
  here). Set the account's current `balance`/`balanceAsOf` to the latest imported row (clamped
  to 0 if negative, per the judgment call).

### Net-worth series computation (`lib/net-worth-history.ts`, pure + unit-tested)

- Input: all `AccountBalanceEvent`s for the user + each account's bucket (for sign).
- For each account, balance at date `D` = most recent event `≤ D` (carry-forward); `0` before
  its first event. At each sample date, sum signed balances (assets +, debt −) → one net-worth
  point.
- Return the full series (MAX); the client slices by range with `useMemo`.
- Heavily unit-tested: carry-forward correctness, accounts appearing partway through the
  series, debt sign, empty history, single-point history.

### Chart (`components/NetWorthChart.tsx`, hand-rolled SVG — no dependency)

A single line + range toggles + hover tooltip, hand-rolled (no charting library) — the
research behind this (recorded from the original brainstorm): Recharts would add ~130KB
gzipped and React-19 peer-dependency friction to draw one line; this app already hand-rolls
its other data viz (budget bars, spending-by-category bars) and has a strong house-style bias
against new dependencies for anything with a clean, testable, self-contained implementation.
(Note this is the *opposite* conclusion from the CSV-parser decision above — charting is
subjective/interactive and cheap to hand-roll well; CSV correctness is objective/well-specified
and risky to get subtly wrong with real financial data. Both calls were made on their own
merits, not from a blanket dependency policy.)

- Scales map `{date, value}` → SVG coordinates; one `<path>` line; `ResizeObserver` for
  responsive width.
- Range buttons (3M/6M/YTD/1Y/3Y/5Y/10Y/MAX) set a state key →
  `series.filter(p => p.date >= cutoff)`.
- Hover: transparent overlay `<rect>`; pointer-X → nearest index → vertical guide + focus dot
  + a Tailwind tooltip; `Intl.NumberFormat`/`DateTimeFormat` for labels.
- `data-*` hooks for tests (styling encodes meaning, per house style).
- Rendered on `/net-worth` above the summary cards. The page (RSC) computes the series
  server-side from `lib/net-worth-history.ts` and passes it down — read-only, derived, no
  client-side recomputation of the raw event log.

### Tests

- `lib/net-worth-history.test.ts` — the series math (the load-bearing part: carry-forward,
  multi-account sums, sign handling).
- Balance-history import — parser reuse, debt-sign transform, per-date dedup, integration test.
- `NetWorthChart` component test — assert on computed geometry/derived values and range
  filtering (happy-dom can't do real SVG layout or pointer hit-testing, so don't try to assert
  pixel positions).
- E2E — import a small balance-history fixture, toggle a range, assert the chart and its
  points update.

---

## Verification (per phase)

- **2b:** unit tests for parser + transform + dedup + account-type guessing; integration
  import of a fixture CSV (including a duplicate-skip re-run); then the real-data smoke import
  of `Transactions_June_2026.csv` described above.
- **3:** series-math unit tests; import a real per-account balance-history file → the chart
  shows a multi-year line; range toggles slice correctly; net worth "today" matches the
  summary card computed independently by `lib/account-utils.ts`.
- Both phases: `npm run lint` + `typecheck` clean; DB-clean checks after test runs (no leftover
  rows) — same discipline as Phases 1 and 2a.

## Critical files

- **2b:** `lib/csv.ts` (+ test, wraps `papaparse`); `app/api/transactions/import/route.ts`; a
  transform/validation module (+ tests) covering sign→type, transfer routing, dedup-hash,
  category-type inference, account-type guessing; import UI (upload button + preview/confirm
  step) on `app/(app)/transactions/page.tsx`; `package.json` (+`papaparse`, `@types/papaparse`).
- **3:** `app/api/accounts/[id]/balance-history/route.ts`; `lib/net-worth-history.ts` (+ test);
  `components/NetWorthChart.tsx` (+ test); `app/(app)/net-worth/page.tsx` (render the chart);
  balance-history upload UI added to `components/NetWorthClient.tsx` (or a per-account
  sub-component).
