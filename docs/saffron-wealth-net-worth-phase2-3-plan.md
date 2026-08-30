# Saffron Wealth — Net Worth Tracker, Phases 2b & 3 Plan (v2)

**Status:** Ready to build. Phases 1 and 2a are shipped and committed on branch
`feat/net-worth-accounts` (`ffd7eb9`, `ff67a38`).

**v2 supersedes v1.** v1's file-schema section was written from a June 2026 export that is no
longer on disk, and both of its schema assumptions turned out to be wrong. v2's "Validated file
facts" section below was measured against the user's **actual** current exports with a real CSV
parser. Where v1 and v2 disagree, v2 is correct. The material corrections:

| v1 assumed | Reality |
|---|---|
| Transaction export has 9 columns | **11** — adds `Reviewed` and `Id` |
| Dedup via `sha256(date\|amount\|account\|merchant\|statement)` | **`Id` is a stable unique Monarch PK** — use it |
| Balance history is **per-account**, 2 cols (`Date, Balance`), uploaded per account | **One global file**, 3 cols (`Date, Balance, Account`) |
| Balance history covers ~16 accounts | **35** — 19 of which never appear in transactions |
| Balance history is sparse | **Daily** — 34,248 rows |
| Series carry-forward = "most recent event ≤ D" | **Bug.** Carries closed accounts forever; see Ruling 3 |

---

## Context

The full Net Worth vision: import Monarch history → derive accounts/categories/transactions →
chart net worth over time. Phases 1 and 2a are done. What remains:

- **Phase 2b — Monarch transaction import.** CSV upload on the Transactions page that parses the
  real export, upserts accounts + categories by name, and imports transactions into the Phase 2a
  tables.
- **Phase 3 — Net-worth-over-time graph.** A global balance-history import that backfills
  `AccountBalanceEvent`, plus a hand-rolled SVG line chart on the Net Worth page with
  3M/6M/YTD/1Y/3Y/5Y/10Y/MAX range filters.

The two imports are independent code paths, but **Phase 3's import should be run first** by the
user in practice: it is the only source for the 19 investment/retirement accounts, and it supplies
the balance sign that makes account-type guessing reliable (Ruling 4). Neither import may *depend*
on the other having run — each must work standalone against an empty database.

---

## Validated file facts

Measured against the user's real exports on 2026-08-30 with Python's `csv` module (not `split(',')`).
Files live outside the repo, in Google Drive:

```
<a local folder outside this repo — path deliberately not recorded>
    Monarch_Transactions_<month>.csv
    Monarch_Balances_<month>.csv
```

**Never copy these into the repo.** `*.csv` is not gitignored. Test fixtures are small synthetic
files and belong in the repo; real exports do not.

### `Monarch_Transactions_<month>.csv`

- **7,576 data rows**, dates **2019-11-18 → 2026-08-30**.
- **11 columns:** `Date, Merchant, Category, Account, Original Statement, Notes, Amount, Tags,
  Owner, Reviewed, Id`
- `Id` — **non-empty on all 7,576 rows, all 7,576 distinct.** A stable Monarch primary key.
- `Reviewed` — values `''` or `'Reviewed'`. Ignore.
- `Owner` — always `'Shared'`. Ignore.
- `Tags` — empty on every row. Ignore.
- `Date` — `YYYY-MM-DD` on every row.
- `Amount` — plain signed decimal on every row; no `$`, no thousands commas, no parentheses.
  6,259 negative (expense), 1,317 positive (income). Keep the defensive strip anyway — it is
  three lines and other exports may differ.
- **16 distinct accounts**, all of which also appear in the balance file.
- **53 distinct categories.** All three transfer-like categories are present and confirm v1's
  Decision 1: `Transfer` (603 rows), `Credit Card Payment` (419), `Balance Adjustments` (9).
- **Quoted fields containing commas confirmed** — e.g. `Mortgage, Lakeside Home` and
  `1200 MAPLE STREET (Orig. $500,000.00) (...1111)`. A real CSV parser is mandatory.

### `Monarch_Balances_<month>.csv`

- **34,248 data rows**, dates **2020-07-01 → 2026-08-30**.
- **3 columns:** `Date, Balance, Account` — one global file, *not* one file per account.
- **35 distinct accounts.** 16 overlap the transaction file **with byte-identical names** (zero
  mismatches), so name-keyed upsert is safe. The other **19 appear only here** and are the
  net-worth-dominant ones: `ACME, INC. 401(K) PLAN`, `GLOBEX, INC. 401(K) PLAN (...2222)`,
  `Traditional IRA (...3333)`, `Brokerage (...4444)`, `ACME STOCK PURCHASE (...5555)`,
  `INDIVIDUAL - Globex RSU (...6666)`, `ACME RESTRICTED UNIT (...*****7777)`, two HSAs,
  four historical brokerage/stock-plan accounts, and assorted closed accounts.
- **Daily granularity** — for the longest-running account, 2,251 of 2,252 inter-row gaps are
  exactly 1 day.
- **Liabilities are negative** — the mortgage sits at `-500,000.00`. Confirms v1's `abs()` rule
  for debt-bucket accounts.
- **Zero duplicate `(Account, Date)` pairs** in the real file. Dedup on that key still required
  for safe re-import.
- **23 accounts run to the final date; 12 stop early**, and 6 of those stop at a **non-zero**
  balance — including `Mortgage, Lakeside Home` at `-450,000.00` (2023-10-31) and
  `Stock Plan (ACM) -2525` at `+131,000.00` (2023-09-04). This is what breaks v1's carry-forward
  rule. See Ruling 3.
- Two rows are **not accounts at all**: `Individual innetwork medical deductible` and
  `Individual innetwork medical outofpocket` are Monarch insurance-progress trackers. See Ruling 5.

---

## Decisions

### Carried forward from v1 (unchanged, and confirmed by the real data)

1. **Transfer-like categories.** `Transfer`, `Balance Adjustments`, and `Credit Card Payment` all
   import as `type: 'transfer'`, excluded from income/expense math. Counting a card payment as an
   expense would double-count it against the purchases that ran up the balance. Category-type
   sign-inference is skipped for these three — they are routed by name match. Held in a named
   constant `TRANSFER_LIKE_CATEGORIES` so adding a fourth is a data change, not a code change.
2. **`papaparse` for CSV.** A deliberate, acknowledged exception to the app's no-dependency house
   style. CSV correctness (quoted fields, embedded commas/newlines, escaped quotes) is a
   well-known "don't reinvent this" problem, and the real file exercises exactly those cases.
   This exception does **not** extend to charting — see Global Constraint 6.
3. **Import UX: preview, then confirm.** 7,576 rows is too many to commit blind. Upload → parse →
   summary (new transactions, new accounts with guessed types, new categories, duplicates to be
   skipped, date range) → user confirms → commit.

### New rulings from schema validation (2026-08-30)

4. **Ruling 1 — dedup on Monarch's `Id`, not a content hash.** Store `externalHash = "mid:<Id>"`
   when the `Id` column is present and non-empty; fall back to
   `"sha:" + sha256(date|abs(amount)|account|merchant|originalStatement)` when it is absent. The
   prefix keeps the two key-spaces from ever colliding and self-documents which was used.
   *Why:* `Id` is stable across exports; the composite hash keys on `merchant`, which Monarch users
   routinely rename — a rename would silently re-import the row as new.
   *Cost if wrong:* if a future export reuses `Id`s across accounts, duplicates get skipped
   incorrectly. Mitigated by `@@unique([userId, externalHash])` being per-user already.

5. **Ruling 2 — validate the header by required-columns-present, ignore extras.** Require
   `Date`, `Amount`, `Account`, `Category`; treat `Merchant`, `Original Statement`, `Notes`, `Id`
   as optional-but-used; ignore any other column. Fail loudly (echoing the actual header found)
   only when a *required* column is missing.
   *Why:* v1's "expect exactly 9, tolerate 8" would have rejected the user's real 11-column file.
   Monarch has added columns twice; it will again.
   *Cost if wrong:* a genuinely malformed file with the right four headers gets further into the
   pipeline before failing. Row-level validation still catches it.

6. **Ruling 3 — an account contributes to the net-worth series only within
   `[firstEventDate, lastEventDate]`, and closed accounts import as archived.** Outside that
   window an account contributes **0**. Any account whose last balance event predates the file's
   max date is created with `archivedAt` set.
   *Why:* v1's unbounded carry-forward would put a phantom $450k mortgage and ~$150k of stale
   stock-plan balances into today's net worth, making the chart's "today" contradict the summary
   card — which v1's own verification step requires to match. Every *active* account exports
   daily, so "last event older than the file max" is a highly reliable closure signal. Phase 1's
   `archivedAt` soft-delete already excludes these from `listAccounts` while preserving their
   history for the graph — which is precisely why it was built that way.
   *Cost if wrong:* an account that is genuinely open but stopped syncing in Monarch drops out of
   net worth and lands archived. Visible and one click to fix in the UI, and re-importing a fresh
   export corrects it automatically.

7. **Ruling 4 — guess asset-vs-liability from the balance sign, then refine the type by keyword.**
   Sign first, keywords second (full ordered table in Task 5).
   *Why:* the mortgage is named `1200 MAPLE STREET (Orig. $500,000.00) (...1111)` — no
   debt keyword anywhere in it — while the *property* it secures is named `1200 maple`. Names
   alone cannot separate them; the sign can, trivially and always.
   *Cost if wrong:* a credit card at a $0 or credited balance on its first event could be read as
   an asset. Bounded: the user reviews guessed types in the preview step before committing.

8. **Ruling 5 — skip the two medical trackers; import everything else.** A named denylist
   `NON_ACCOUNT_NAMES` containing exactly `Individual innetwork medical deductible` and
   `Individual innetwork medical outofpocket` (case-insensitive, exact match).
   *Why:* they are insurance deductible/out-of-pocket progress counters, not balances, and would
   inflate assets. The other oddly-named rows (`Account`, `******3030`, `OMNICORP RSU`) are real
   accounts that all end at or near $0, so they are harmless to import and the user can archive
   them in the UI.
   *Cost if wrong:* a future export names a real account one of those two strings. Vanishingly
   unlikely, and the denylist is one line to amend.

### Rulings from the pre-flight cross-task scan (2026-08-30)

9. **Ruling 6 — `terrace` is not a property keyword.** The scan found that with `terrace` in the
   asset keyword list, a *transactions-first* import (Task 3, which has no balance sign) would type
   `1200 MAPLE STREET (Orig. $500,000.00) (...1111)` — the **mortgage** — as `property`, an
   asset. Task 5 would then decline to correct it (its "never overwrite a user-corrected type"
   rule), leaving an $500k liability counted as an $500k asset: a $1.0M net-worth error.
   *Why:* the keyword was a guess at one specific street name and buys nothing — the property
   account `1200 maple` is already an accepted miss below.
   *Cost if wrong:* a genuinely property-named account guesses as `cash`; one click to fix.

10. **Ruling 7 — Task 5 overwrites the type when the balance sign disagrees with the stored
    bucket.** If an existing account's bucket is an asset but its imported final balance is
    negative (or its bucket is `debt` but the final balance is positive), re-guess the type with
    the sign and overwrite. When the signs agree, never overwrite.
    *Why:* the institution's sign is ground truth; a keyword guess is not. This is the general
    safety net behind Ruling 6's specific fix.
    *Cost if wrong:* a user who deliberately typed a negative-balance account as an asset gets
    overridden on re-import. Judged far less likely than the mistype it prevents.

11. **Ruling 8 — `AccountBalanceEvent` needs a real `asOf` date column, and it must NOT be
    uniquely constrained with `accountId`.** The live schema has only
    `recordedAt DateTime @default(now())` — a write timestamp, not a balance-as-of date. Both plan
    versions assumed a `date` field that does not exist. Add
    `asOf DateTime @db.Date @default(now())` via `db:push` (the default backfills existing Phase 1
    rows correctly — a manually entered balance *was* as-of its entry date) and keep `recordedAt`
    as the audit trail. **Dedup in application code** (query the affected accounts' existing
    `(accountId, asOf)` pairs into a Set, filter before insert), not with `@@unique`.
    *Why a constraint is wrong:* Phase 1 legitimately appends a row on every balance change, so a
    user editing one account's balance twice in a day would violate `@@unique([accountId, asOf])`
    and get a 500 on a previously working action. Application-level dedup gets idempotent
    re-import without regressing Phase 1.
    *Cost if wrong:* a concurrent double-import could race past the Set check and duplicate rows.
    Single-user app, sequential imports behind a confirm step — accepted.

12. **Ruling 9 — same-`asOf` events tiebreak on `recordedAt` descending.** Because Ruling 8
    permits multiple events per `(accountId, asOf)`, Task 6's "most recent event ≤ D" is ambiguous.
    The latest-written value for a date wins.
    *Cost if wrong:* an ordering flip on a same-day double edit; sub-dollar impact.

### Known, accepted imperfection

`1200 maple` (the property asset, positive balance, no keyword match) will be guessed as
`cash` rather than `property`. Left as-is: the preview step exists so the user corrects guesses
before committing, and hard-coding a street name into the keyword table would be worse — and per
Ruling 6, actively harmful.

---

## Global Constraints

These bind every task. Violations are review findings.

1. **Hand-rolled validation.** No Zod. Match `lib/auth/validation.ts`,
   `lib/transaction-validation.ts`, `lib/account-validation.ts`.
2. **Money.** `Decimal(14,2)` at rest in Postgres; converted to JS `number` via `.toNumber()`
   before leaving the query layer. `Prisma.Decimal` serializes to a JSON *string* and would
   silently break `.toFixed()` call sites. Liabilities store a **positive amount owed**.
3. **Query layers are server-only.** New DB access goes in `lib/*.ts` alongside
   `lib/{accounts,transactions,budgets,categories}.ts`, never in a component.
4. **Every mutating API route** calls `validateCsrfFromRequest(req)` first and is wrapped in a
   top-level `try`/`catch`. Multipart upload routes additionally set `runtime = "nodejs"` and a
   byte cap — mirror `app/api/profile/picture/route.ts`.
5. **Schema changes via `npm run db:push`**, never `prisma migrate dev`. The dev DB has no
   `_prisma_migrations` table.
6. **`papaparse` is the only new dependency permitted** (plus `@types/papaparse`). The chart is
   hand-rolled SVG — no Recharts, no charting library. Rationale in Decision 2 / Task 7.
7. **Tailwind classes appear as full verbatim strings.** Tailwind 3 purges anything assembled at
   runtime. Store color classes in constant maps as complete strings.
8. **`data-*` attributes where styling is the signal.** Tests assert on the attribute, not the
   class string. Precedent: `BudgetProgressBar`, `BudgetCategoryRow`, `AlertBanner`.
9. **Dates.** `YYYY-MM-DD` strings parse via the UTC-safe helpers in `lib/transactions.ts` for
   storage, and `parseLocalDate` from `lib/budget-utils.ts` for display. Never
   `new Date("YYYY-MM-DD")` — it parses as UTC midnight and shifts the day in negative timezones.
10. **Tests colocated.** `lib/foo.ts` → `lib/foo.test.ts`; `components/Foo.tsx` →
    `components/Foo.test.tsx`. API routes get `__tests__/` with their own `helpers.ts`
    (`seedUser`/`seedSession`/`makeRequest`), cloned per directory, not shared.
11. **Every API test file includes a cross-user isolation test** — seed two users, assert user A
    cannot read or mutate user B's rows.
12. **Comments explain WHY, not WHAT.** Tone reference: `lib/auth/exponential-backoff.ts:11-12`,
    `proxy.ts:3-12`.
13. **`npm run lint`, `npm run typecheck`, and `npm test` must all pass** before a task reports
    DONE. State the actual command output in the report.

---

## Task 1 — `lib/csv.ts`: papaparse wrapper + header validation

**Files:** `lib/csv.ts` (new), `lib/csv.test.ts` (new), `package.json`

Add `papaparse` and `@types/papaparse` as real dependencies (`npm install`).

Export:

- `parseCsv<T>(text: string): { rows: Record<string,string>[]; header: string[] }` — wraps
  `Papa.parse` with `{ header: true, skipEmptyLines: true }`. Trims the BOM if present
  (the real files are UTF-8; be defensive about `utf-8-sig`).
- `validateHeader(header: string[], required: string[]): void` — throws a `CsvHeaderError`
  (exported) whose message names the missing columns **and echoes the actual header found**.
  Comparison is case-insensitive and whitespace-trimmed. Extra columns are ignored (Ruling 2).

**Tests (`lib/csv.test.ts`):**
- Quoted field containing a comma parses as one value (use `Mortgage, Lakeside Home`).
- Quoted field containing an escaped quote.
- Embedded newline inside a quoted field.
- The real 11-column transaction header validates against the 4 required columns.
- A legacy 8-column header (no `Owner`/`Reviewed`/`Id`) also validates.
- A header missing `Amount` throws `CsvHeaderError`, and the message contains both `Amount` and
  the actual header string.
- BOM-prefixed first header cell still matches.
- `skipEmptyLines` — trailing blank line produces no row.

---

## Task 2 — `lib/monarch-transform.ts`: row → domain transforms

**Files:** `lib/monarch-transform.ts` (new), `lib/monarch-transform.test.ts` (new)

Pure functions, no DB, no I/O. This is the load-bearing logic for both imports.

Export:

- `TRANSFER_LIKE_CATEGORIES` — `['transfer', 'balance adjustments', 'credit card payment']`
  (lowercase; compare case-insensitively after trim).
- `NON_ACCOUNT_NAMES` — the two medical trackers from Ruling 5.
- `parseAmount(raw: string): number` — signed decimal; defensively strips `$`, thousands commas,
  and wrapping parentheses (parens ⇒ negative). Throws on unparseable input.
- `classifyTransaction(categoryName, amount)` → `{ type: 'expense'|'income'|'transfer', amount: number }`
  where the returned amount is `Math.abs`. Transfer-like category names win over sign (Ruling/Decision 1).
- `inferCategoryType(categoryName, amountsForThatCategory: number[])` →
  `'expense'|'income'|'transfer'`. Transfer-like names return `'transfer'` without inspecting
  amounts. Otherwise the dominant sign across the batch wins; a tie or an empty array returns
  `'expense'`.
- `buildExternalHash({ id, date, amount, account, merchant, originalStatement })` → string.
  Returns `` `mid:${id}` `` when `id` is a non-empty string; otherwise
  `` `sha:${sha256(...)}` `` over `date|abs(amount)|account|merchant|originalStatement` joined
  with `|` (Ruling 1). Use `node:crypto`.
- `guessAccountType(name: string, balance?: number): AccountType` — Ruling 4. Algorithm:
  1. If `balance !== undefined && balance < 0` → **liability branch:** name contains
     `'orig. $'` (Monarch's loan marker) or `'mortgage'` or `'loan'` → `'loan_mortgage'`;
     else → `'credit_card'`.
  2. Otherwise **asset branch** — first match wins, in this exact order (the order matters:
     `roth 401k` must beat `401k`, `health savings` must beat `savings`, `rsu` must beat
     `individual`):

     | # | name contains (lowercased) | → type |
     |---|---|---|
     | 1 | `roth 401`, `roth401` | `roth_401k` |
     | 2 | `401(k)`, `401k` | `401k` |
     | 3 | `roth ira` | `roth_ira` |
     | 4 | `traditional ira` | `traditional_ira` |
     | 5 | `ira` | `traditional_ira` |
     | 6 | `hsa`, `health savings` | `hsa` |
     | 7 | `restricted unit`, `rsu` | `rsu` |
     | 8 | `stock plan`, `stock purchase`, `espp` | `espp` |
     | 9 | `brokerage`, `individual`, `invest` | `brokerage` |
     | 10 | `property`, `real estate`, `house` | `property` |
     | 11 | `credit card`, `sapphire`, `visa`, `discover`, `bankamericard`, `mastercard`, `amex`, `american express`, `citi`, `circle card`, `red card` | `credit_card` |
     | 12 | `checking`, `banking`, `savings`, `cash` | `cash` |
     | 13 | *(no match)* | `cash` |

  3. When `balance` is undefined (transaction-only accounts), run the asset branch but let rule 11
     produce `credit_card` as it naturally does.

**Tests:** one case per keyword row above (13+ cases), plus: negative balance + `Orig. $` →
`loan_mortgage`; negative balance + `Sapphire Preferred` → `credit_card`; positive balance +
`ACME, INC. 401(K) PLAN` → `401k`; `INDIVIDUAL - Globex RSU` → `rsu` (not `brokerage`);
`Health savings investments - HSA` → `hsa` (not `cash`); `Advantage Savings` → `cash`;
`1200 maple` → `cash` (documented accepted miss — assert it so a future change is deliberate);
all three transfer-like names route to `'transfer'` on both signs; `parseAmount` on
`-200.00`, `$1,234.56`, `(45.00)`; `buildExternalHash` prefers `mid:` and is stable across calls.

---

## Task 3 — `POST /api/transactions/import`: preview + commit

**Files:** `app/api/transactions/import/route.ts` (new),
`app/api/transactions/__tests__/import.test.ts` (new), `lib/transactions.ts` (extend),
`lib/categories.ts` (extend), `lib/accounts.ts` (extend)

`runtime = "nodejs"`. CSRF-validated. Multipart `req.formData()`. **10 MB cap** (the real file is
976 KB; the cap is a guard, not a target). Top-level try/catch.

Two modes on one route, switched by a `mode` field in the form data:

- `mode=preview` — parse + transform, **no writes**. Returns
  `{ ok: true, summary: { totalRows, newTransactions, duplicateRows, newAccounts: [{name, guessedType}], newCategories: [{name, inferredType}], dateRange: {from, to} } }`.
- `mode=commit` — same pipeline, then writes inside a single `prisma.$transaction`:
  1. Upsert categories by `(userId, name)`, assigning `type` from `inferCategoryType` and a
     `color` round-robin from a fixed palette.
  2. Upsert accounts by `(userId, name)` with `guessAccountType(name)` (no balance available
     here — balance stays `0`; Phase 3's import or the user sets the real one).
     **Existing accounts matched by name are left untouched** — never overwrite a type or balance
     the user has already corrected.
  3. `createMany({ data, skipDuplicates: true })` for transactions, relying on
     `@@unique([userId, externalHash])`.
  Returns the same summary shape plus `{ imported, skipped }`.

Category-type inference needs the whole batch, so transform in two passes: collect amounts per
category name, then build rows.

**Tests:** a small synthetic fixture CSV (commit it under `app/api/transactions/__tests__/fixtures/`)
exercising quoted commas, one transfer row, one income row, one expense row, and one row that
duplicates another. Assert: preview writes nothing; commit creates the expected
transactions/accounts/categories with expected types; **re-committing the same file imports 0 and
skips all**; missing-required-column file returns a 400 naming the column; oversized body rejected;
absent/invalid CSRF rejected; **cross-user isolation** (user A's import creates nothing visible to
user B).

---

## Task 4 — Import UI on the Transactions page

**Files:** `components/MonarchImportModal.tsx` (new), `components/MonarchImportModal.test.tsx`
(new), `app/(app)/transactions/page.tsx` (extend), `e2e/monarch-import.spec.ts` (new)

- "Import from Monarch" button on the Transactions page opens the modal.
- File picker (`accept=".csv,text/csv"`) → `mode=preview` POST → render the summary: counts, date
  range, a table of new accounts with their guessed types, new categories with inferred types, and
  the duplicate-skip count.
- "Confirm import" → `mode=commit` → success state showing `imported`/`skipped`, then refresh the
  page data. "Cancel" closes without writing.
- Loading and error states. Errors surface the API message verbatim (the header-mismatch message is
  the useful one).
- Follow the `readCsrfCookie()` + `CSRF_HEADER_NAME` fetch pattern from `NetWorthClient.tsx`.
- `data-*` hooks for test assertions per Global Constraint 8.

**Tests:** component test with a mocked `fetch` covering preview → confirm → success, and the error
path. E2E uploading a tiny fixture via `setInputFiles`, asserting the preview summary appears, then
confirming and asserting the imported rows render.

---

## Task 5 — `POST /api/accounts/balance-history`: global balance import

**Files:** `app/api/accounts/balance-history/route.ts` (new),
`app/api/accounts/__tests__/balance-history.test.ts` (new), `lib/accounts.ts` (extend)

Note the route path: **global, not `[id]`-scoped** — the export is one file covering all accounts
(v1 had this wrong). `runtime = "nodejs"`, CSRF, 20 MB cap (real file is 1.7 MB), top-level
try/catch. Same `mode=preview` / `mode=commit` shape as Task 3.

Required columns: `Date`, `Balance`, `Account`.

Pipeline:

1. Drop rows whose `Account` is in `NON_ACCOUNT_NAMES` (Ruling 5). Count them for the summary.
2. Group rows by account name. For each: `firstDate`, `lastDate`, and the final balance.
3. `fileMaxDate` = max `Date` across all retained rows.
4. Per account, upsert by `(userId, name)`:
   - `type` = `guessAccountType(name, finalBalanceSigned)` (Ruling 4 — sign available here).
   - `balance` = `Math.abs(finalBalance)` for debt-bucket accounts, else `finalBalance` clamped
     to `0` if negative (Phase 1's rule that a live asset balance is non-negative).
   - `balanceAsOf` = that account's `lastDate`.
   - `archivedAt` = set (import timestamp) when `lastDate < fileMaxDate`, else `null` (Ruling 3).
   - **Existing accounts:** update `balance`/`balanceAsOf` from the import. Do **not** overwrite a
     `type` the user may have corrected — *except* when the balance sign disagrees with the stored
     type's bucket (asset bucket + negative final balance, or `debt` bucket + positive final
     balance), in which case re-guess with the sign and overwrite (Ruling 7).
5. **Schema prerequisite (Ruling 8):** add `asOf DateTime @db.Date @default(now())` to
   `AccountBalanceEvent` in `prisma/schema.prisma` and apply with `npm run db:push`. Keep
   `recordedAt` as the audit timestamp. Add `@@index([accountId, asOf])`. Do **not** add
   `@@unique([accountId, asOf])` — it would break Phase 1's legitimate same-day double balance edit.
6. Insert `AccountBalanceEvent` rows for every retained CSV row: `asOf` = the CSV `Date`;
   `balance` stored as `Math.abs(raw)` for debt-bucket accounts, raw value otherwise (negative
   asset balances are allowed in history — clamping would misrepresent the real historical net
   worth). `userId` denormalized. **Dedup in application code:** load existing `(accountId, asOf)`
   pairs for the affected accounts into a `Set`, filter the batch against it before insert.
7. Batch the inserts — 34,248 rows must not be 34,248 round trips. Chunk `createMany` at ~5,000.

Preview summary: `{ accountsFound, newAccounts: [{name, guessedType, archived}], existingAccounts, eventRows, skippedNonAccountRows, dateRange }`.

**Tests:** synthetic fixture with 3 accounts — one asset running to the file max, one debt
(negative balances), one closed early at a non-zero balance. Assert: debt balances stored positive;
`asOf` matches the CSV `Date` (not the insert time); the early-stopping account is created
**archived**; a medical-tracker row is skipped and counted; re-import writes zero new events
(application-level dedup); `balanceAsOf` matches each account's last date; an existing account's
user-corrected `type` survives re-import when the sign agrees; an existing asset-typed account
whose imported final balance is negative **is** re-typed (Ruling 7); a Phase 1-style same-day
double balance edit still succeeds (Ruling 8 regression test); chunking handles >5,000 rows; CSRF;
cross-user isolation.

---

## Task 6 — `lib/net-worth-history.ts`: the series math

**Files:** `lib/net-worth-history.ts` (new), `lib/net-worth-history.test.ts` (new)

Pure, no DB. **This is the highest-risk logic in Phase 3** — Ruling 3 lives here.

```ts
export interface NetWorthPoint { date: string; value: number }

export function computeNetWorthSeries(
  events: { accountId: string; asOf: string; balance: number; recordedAt: string }[],
  accounts: { id: string; type: AccountType }[],
): NetWorthPoint[]
```

Algorithm:

1. Group events by `accountId`, sort each group by `asOf` ascending, tiebreaking equal `asOf` by
   `recordedAt` ascending so the latest-written value for a date is the one carried (Ruling 9).
2. Per account record `firstDate` and `lastDate` (min/max `asOf`) — its **contribution window**.
3. Sample dates = the sorted unique union of every event `asOf`.
4. For each sample date `D`, per account: `0` when `D < firstDate` **or `D > lastDate`**
   (Ruling 3); otherwise the balance of the most recent event `≤ D` (carry-forward *within* the
   window only).
5. Signed contribution: `isLiability(getBucketForType(type)) ? -balance : balance` — reusing
   `lib/account-utils.ts`, not reimplementing the taxonomy.
6. Sum per date → one `NetWorthPoint`. Return the full MAX series; the client slices by range.

Performance: 2,252 sample dates × 35 accounts. Walk each account's events with a moving index
rather than re-scanning per date — an O(dates × accounts) sweep, not O(dates × events).

**Tests:** carry-forward inside the window; **zero after `lastDate`** (the Ruling 3 regression
test — assert a closed account with a non-zero final balance contributes nothing to a later date);
zero before `firstDate`; an account appearing partway through; debt sign subtracts; a debt account
closing raises net worth; empty event list → `[]`; single event → one point; two accounts with
disjoint windows; sample-date union is sorted and deduplicated; **two events sharing one `asOf`
resolve to the later `recordedAt`** (Ruling 9).

---

## Task 7 — `components/NetWorthChart.tsx`: hand-rolled SVG line chart

**Files:** `components/NetWorthChart.tsx` (new), `components/NetWorthChart.test.tsx` (new)

No charting library (Global Constraint 6). The reasoning, recorded so it isn't relitigated:
Recharts would add ~130 KB gzipped plus React-19 peer friction to draw one line; this app already
hand-rolls its other data viz (budget bars). This is the *opposite* call from `papaparse`, and
deliberately so — charting is subjective, interactive, and cheap to hand-roll well; CSV
correctness is objective, well-specified, and risky to get subtly wrong on financial data.

- Props: `series: NetWorthPoint[]`.
- Range toggles `3M | 6M | YTD | 1Y | 3Y | 5Y | 10Y | MAX` → state key → `useMemo` filter
  `series.filter(p => p.date >= cutoff)`. Cutoffs computed from the series' **last date**, not
  `Date.now()`, so the chart is deterministic and testable.
- Scales map `{date, value}` → SVG coords. `ResizeObserver` for responsive width.
- One `<path>`. Y domain includes 0 when the series crosses it.
- Hover: transparent overlay `<rect>`; pointer-X → nearest index → vertical guide + focus dot +
  Tailwind tooltip. `Intl.NumberFormat` / `Intl.DateTimeFormat` for labels.
- Empty/single-point series render an explicit empty state, not a broken path.
- `data-*` hooks: `data-range` on the active toggle, `data-point-count` on the chart root.

**Tests:** happy-dom cannot do SVG layout or pointer hit-testing — **assert on derived values and
geometry math, never pixel positions.** Cover: range filtering changes `data-point-count`
correctly for each toggle; the active toggle carries `data-range`; empty series renders the empty
state; single-point series does not throw; the generated path `d` string has one command per
filtered point.

---

## Task 8 — Wire the chart and the upload into the Net Worth page

**Files:** `app/(app)/net-worth/page.tsx` (extend), `components/NetWorthClient.tsx` (extend),
`components/BalanceHistoryImportModal.tsx` (new, or fold into `NetWorthClient`),
`e2e/net-worth-history.spec.ts` (new)

- The page is an RSC: fetch the user's `AccountBalanceEvent` rows + accounts, call
  `computeNetWorthSeries` **server-side**, pass the series down. The chart is read-only derived
  data — no client-side recomputation of the raw event log.
- Render `NetWorthChart` above the summary cards.
- "Import balance history" button → modal → preview/confirm against Task 5's route, same pattern
  as Task 4.
- After a successful import, refresh so chart + summary cards both update.

**Tests:** E2E — import a small balance-history fixture, assert the chart appears, toggle a range,
assert `data-point-count` changes. Then the cross-check that matters: **net worth "today" from the
chart's last point equals the summary card** computed independently by `lib/account-utils.ts`.

---

## Verification

Per task: `npm run lint`, `npm run typecheck`, `npm test` clean; new tests actually assert
behaviour (no `expect(true)`).

End of Phase 2b: import the real `Monarch_Transactions_<month>.csv` in dev. Verify 16 accounts,
53 categories, ~7,576 transactions; a second import of the same file changes nothing; and
`Transfer` / `Balance Adjustments` / `Credit Card Payment` do **not** move the Monthly Review
income/expense totals.

End of Phase 3: import the real `Monarch_Balances_<month>.csv` in dev. Verify 33 accounts
created (35 minus the 2 medical trackers), 12 of them archived; the chart draws a ~6-year line;
range toggles slice correctly; and the chart's final point matches the Net Worth summary card —
specifically that the Lakeside mortgage and the ZUO stock plans are **absent** from today's number.

Both phases: no leftover test rows in the dev DB after the suites run.
