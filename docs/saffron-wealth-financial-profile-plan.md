# Financial Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the user a place to declare the planning inputs that `User` lacks (income streams, age, retirement age, return / withdrawal / inflation assumptions, filing status, employer match, contribution targets), stored as dated, append-only versions.

**Architecture:** One new `FinancialProfile` table holding one row per saved version, with two child tables for the list-shaped inputs (income streams, contribution targets). A save inserts a whole new version, serialized per user by an advisory lock. A save that changes nothing is a no-op. The `/financial-profile` route is a Server Component that reads the current version and hands it to a client form. The form validates with the same pure parser the `PUT /api/financial-profile` route uses.

**Tech Stack:** Next.js 15 App Router, Prisma 5 / Postgres 16, React 19, Tailwind 3 theme tokens, Vitest + happy-dom + RTL, Playwright.

**Spec:** `docs/ROADMAP.md` §1 "Financial Profile", plus the decisions below, which were settled with the author before this plan was written.

> **Revised after the final review:** the age is stored as `anchoredAge` + `ageAnchoredAt`
> (migration `financial_profile_age_anchor`), not `ageAtEffective` against the version's date —
> see `docs/decisions/0014-age-anchored-to-its-own-date.md`. The task text below is the plan as
> executed and still names the original field.

## Decisions settled before planning

| Question | Decision |
|---|---|
| Where it lives | Its own route, `/financial-profile`, with a sidebar item between Net Worth and Profile. `/profile` stays identity and auth. |
| Field scope | Core + optional. Income is a **list of typed streams** (salary, bonus, RSUs, ESPP, rental, self-employment, interest/dividends, other), not one salary figure. |
| Age input | The user types their **current age**. It is stored with the save's timestamp and advanced from there (decision record 0014). |
| Versioning | Append-only snapshots: every changing save inserts a full version (decision record 0013). |

## Global Constraints

- Validation is hand-rolled, matching `lib/account-validation.ts`. No Zod.
- Money is `Decimal(14,2)` in Postgres and `number` on the wire. Convert with `.toNumber()` in the query layer. Percent columns are `Decimal(5,2)` and hold the percent as typed (`4.00` means 4%).
- Colours only through theme tokens (`text-fg-muted`, `bg-surface`, `text-danger-muted`, `bg-accent-solid` …). `components/__tests__/no-raw-colors.test.ts` enforces this.
- Every mutating route uses `withApiHandler({ csrf: true })` and returns `{ ok: true, data }` or `err(...)`.
- Schema changes are authored with `prisma migrate dev` against a **scratch** database, never the dev DB, and the SQL is committed.
- Synthetic data only in tests, fixtures and docs (public repo).
- Comments explain why, not what. A decision that takes more than a few lines to justify goes in `docs/decisions/`.

## Review Focus

1. **Re-saving an untouched form a year later.** The stored age is a year behind the derived one. A save with the derived age and nothing else changed must be a no-op, not a new version → Task 4 test `"treats the derived current age as unchanged"`.
2. **A percent typed with more precision than the column holds** (`3.255`). Postgres would round it on insert, so the next identical save would compare unequal and write a phantom version. The parser rounds to 2 dp → Task 3 test `"rounds percents to two decimals"`, Task 4 test `"a re-save of a 3-decimal percent is a no-op"`.
3. **A contribution target whose account was archived after the save.** The page must still show it (labelled archived), and re-saving must not be refused → Task 4 test `"accepts a target on an archived account the user owns"`, Task 5 test `"labels an archived account"`.
4. **Two tabs saving at once.** Both should land as consecutive versions, never a 500 from the `@@unique([userId, version])` backstop → Task 4 test `"serializes concurrent saves into consecutive versions"`.
5. **A retired user with no income streams.** Must be saveable with a $0 total. Adding an employer match with no salary is a field error, not a silent no-op → Task 3 tests `"accepts an empty income list"` and `"rejects an employer match without a salary stream"`.

---

## File structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` + `prisma/migrations/<ts>_add_financial_profile/` | Three new models; back-relations on `User`, `Account` |
| `lib/types.ts` | `IncomeKind`, `PayFrequency`, `FilingStatus`, `IncomeStream`, `EmployerMatch`, `ContributionTarget`, `FinancialProfileInput`, `FinancialProfile` |
| `lib/financial-profile-utils.ts` | Pure: taxonomy constants and labels, `ageOn`, `totalAnnualIncome`, `isContributionEligible`, `toProfileInput`, `profileInputsEqual` |
| `lib/financial-profile-validation.ts` | Pure: `parseFinancialProfileBody`. Imported by the route **and** the client form |
| `lib/financial-profile.ts` | Server-only query layer: `getCurrentFinancialProfile`, `saveFinancialProfile` |
| `app/api/financial-profile/route.ts` | `PUT` only (like `/api/budgets`); the page reads via RSC |
| `app/(app)/financial-profile/page.tsx` | RSC: session, current profile, account options, derived age |
| `components/FinancialProfileClient.tsx` | Form state, client validation, save |
| `components/IncomeStreamsEditor.tsx`, `components/ContributionTargetsEditor.tsx` | Controlled list editors |
| `lib/nav-config.ts` | New nav item |
| `docs/decisions/0013-…`, `0014-…` | The two records |

---

### Task 1: Schema, migration, domain types, decision records

**Files:**
- Modify: `prisma/schema.prisma`, `lib/types.ts`, `docs/decisions/README.md`
- Create: `prisma/migrations/<timestamp>_add_financial_profile/migration.sql`, `docs/decisions/0013-financial-profile-append-only-versions.md`, `docs/decisions/0014-age-anchored-to-effective-date.md`

**Interfaces — Produces:**

```prisma
model FinancialProfile {
  id                    String   @id @default(cuid())
  userId                String
  version               Int
  effectiveAt           DateTime @default(now())
  ageAtEffective        Int
  targetRetirementAge   Int
  expectedRealReturnPct Decimal  @db.Decimal(5, 2)
  safeWithdrawalRatePct Decimal  @db.Decimal(5, 2)
  inflationPct          Decimal  @db.Decimal(5, 2)
  filingStatus          String?
  employerMatchPct      Decimal? @db.Decimal(5, 2)
  employerMatchLimitPct Decimal? @db.Decimal(5, 2)
  user                  User @relation(fields: [userId], references: [id], onDelete: Cascade)
  incomeStreams         FinancialProfileIncome[]
  contributionTargets   FinancialProfileContribution[]
  @@unique([userId, version])
}
model FinancialProfileIncome {        // id, profileId, sortOrder Int, kind String,
  // label String?, annualAmount Decimal(14,2), frequency String?; Cascade from profile; @@index([profileId])
}
model FinancialProfileContribution {  // id, profileId, accountId, sortOrder Int, annualAmount Decimal(14,2);
  // Cascade from profile and from Account; @@unique([profileId, accountId]); @@index([accountId])
}
```

`lib/types.ts`: the string unions are exactly the values listed in Task 2's constants. `IncomeStream { kind; label: string | null; annualAmount: number; frequency: PayFrequency | null }`, `EmployerMatch { matchPct: number; limitPct: number }`, `ContributionTarget { accountId: string; annualAmount: number }`, `FinancialProfileInput { age; targetRetirementAge; expectedRealReturnPct; safeWithdrawalRatePct; inflationPct; filingStatus: FilingStatus | null; employerMatch: EmployerMatch | null; incomeStreams: IncomeStream[]; contributionTargets: ContributionTarget[] }`, and `FinancialProfile = Omit<FinancialProfileInput, "age"> & { version: number; effectiveAt: string /* ISO */; ageAtEffective: number }`.

- [ ] **Step 1:** Edit the schema; write the two records. 0013: append-only versions, the advisory lock, why a no-op save writes nothing, the rejected alternatives (single mutable row; per-field events). 0014: the age is stored as typed plus `effectiveAt`; derived age can lag the true age by under a year and never leads it; why birth date/year were rejected.
- [ ] **Step 2:** Author the migration on a scratch DB: `createdb saffron_migrate_check && DATABASE_URL=postgresql:///saffron_migrate_check npx prisma migrate dev --name add_financial_profile`.
- [ ] **Step 3:** Round-trip check: `dropdb saffron_migrate_check && createdb saffron_migrate_check && DATABASE_URL=postgresql:///saffron_migrate_check npx prisma migrate deploy && DATABASE_URL=… npx prisma migrate status` → "Database schema is up to date!" Then `dropdb saffron_migrate_check`.
- [ ] **Step 4:** Apply to the dev DB with `npm run db:deploy` (additive tables only), then run `npm run db:generate && npm run typecheck` → passes.
- [ ] **Step 5:** Commit.

### Task 2: Pure profile utilities

**Files:** Create `lib/financial-profile-utils.ts`, `lib/financial-profile-utils.test.ts`

**Interfaces — Produces:**
- `INCOME_KINDS: IncomeKind[]` = `salary, bonus, rsu, espp, rental, self_employment, interest_dividends, other`, with `INCOME_KIND_LABELS` ("Salary", "Bonus", "RSUs", "ESPP", "Rental income", "Self-employment", "Interest & dividends", "Other").
- `PAY_FREQUENCIES` = `weekly, biweekly, semimonthly, monthly, quarterly, semiannual, annual, irregular` + `PAY_FREQUENCY_LABELS`.
- `DEFAULT_FREQUENCY_BY_KIND: Record<IncomeKind, PayFrequency | null>`: salary→biweekly, bonus→annual, rsu→quarterly, espp→semiannual, rental→monthly, self_employment→irregular, interest_dividends→quarterly, other→null.
- `FILING_STATUSES` = `single, married_joint, married_separate, head_of_household, qualifying_surviving_spouse` + `FILING_STATUS_LABELS`.
- `isIncomeKind`, `isPayFrequency`, `isFilingStatus`: type guards.
- `CONTRIBUTION_BUCKETS: AccountBucket[] = ["cash", "investments", "retirement"]`; `isContributionEligible(type: AccountType): boolean`.
- `ageOn(p: { ageAtEffective: number; effectiveAt: string }, on: Date): number`: whole years elapsed, compared on UTC fields of both instants.
- `totalAnnualIncome(streams: Pick<IncomeStream, "annualAmount">[]): number`, via `roundToCent`.
- `toProfileInput(p: FinancialProfile, on: Date): FinancialProfileInput`: the version restated as input, with `age: ageOn(p, on)`.
- `profileInputsEqual(a, b: FinancialProfileInput): boolean`: order-sensitive on both lists (order is shown to the user, so a reorder is a change).

- [ ] **Step 1: Failing tests**: `ageOn` (`35` saved `2026-10-31T12:00Z` → `35` on `2027-10-31T11:59Z`, `36` on `2027-10-31T12:00Z`, `45` ten years on; saved on `2028-02-29` → still 35 on `2029-02-28`, 36 on `2029-03-01`); `totalAnnualIncome([{0.1},{0.2}]) === 0.3`; `isContributionEligible("roth_ira") === true`, `("credit_card") === false`, `("property") === false`; `profileInputsEqual` true for identical inputs, false when one stream's label differs, false when two streams swap order; `DEFAULT_FREQUENCY_BY_KIND` has a key for every `INCOME_KINDS` entry.
- [ ] **Step 2:** `npx vitest run lib/financial-profile-utils.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run → PASS. **Step 5:** Commit.

### Task 3: Body parser

**Files:** Create `lib/financial-profile-validation.ts`, `lib/financial-profile-validation.test.ts`

**Interfaces — Consumes:** Task 2 guards, `ParseResult<T>` from `lib/account-validation.ts`. **Produces:** `parseFinancialProfileBody(body: unknown): ParseResult<FinancialProfileInput>` plus exported limits: `AGE_MIN = 16`, `AGE_MAX = 100`, `RETURN_MIN = -10`, `RETURN_MAX = 20`, `SWR_MAX = 10` (exclusive min 0), `INFLATION_MIN = -5`, `INFLATION_MAX = 20`, `MATCH_PCT_MAX = 200`, `MATCH_LIMIT_MAX = 100` (both exclusive min 0), `AMOUNT_MAX = 999_999_999_999.99`, `LABEL_MAX = 80`, `MAX_INCOME_STREAMS = 20`, `MAX_CONTRIBUTION_TARGETS = 50`.

Field-error keys (the UI renders against these): `age`, `targetRetirementAge`, `expectedRealReturnPct`, `safeWithdrawalRatePct`, `inflationPct`, `filingStatus`, `employerMatch`, `employerMatch.matchPct`, `employerMatch.limitPct`, `incomeStreams`, `incomeStreams.<i>.kind|label|annualAmount|frequency`, `contributionTargets`, `contributionTargets.<i>.accountId|annualAmount`. A missing required number reads "Required."; a non-number reads "Enter a number."

- [ ] **Step 1: Failing tests**: a valid full body round-trips (labels trimmed, `""` label → `null`); non-object → `ok: false`; `age: 35.5` → `fieldErrors.age`; `age: 15` and `101` rejected; `targetRetirementAge` below `age` **accepted** (already retired); `"rounds percents to two decimals"` (`3.255` → `3.26`) and amounts to cents; `safeWithdrawalRatePct: 0` rejected; `employerMatch` absent/null → `null`; `{ matchPct: 50 }` alone → `fieldErrors["employerMatch.limitPct"]`; `"rejects an employer match without a salary stream"` → `fieldErrors.employerMatch`; `"accepts an empty income list"`; 21 streams → `fieldErrors.incomeStreams`; stream `annualAmount: 0` → `fieldErrors["incomeStreams.0.annualAmount"]`; bad kind/frequency keyed by index; `frequency: null` accepted; duplicate `accountId` → error on the **second** row's `accountId`; `filingStatus: "married"` rejected.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. **Step 5:** Commit.

### Task 4: Query layer + `PUT /api/financial-profile`

**Files:** Create `lib/financial-profile.ts`, `app/api/financial-profile/route.ts`, `app/api/financial-profile/__tests__/helpers.ts` (cloned from `app/api/accounts/__tests__/helpers.ts`, `PUT` added to `method`), `app/api/financial-profile/__tests__/route.test.ts`

**Interfaces — Produces:**
- `getCurrentFinancialProfile(userId: string): Promise<FinancialProfile | null>`: highest version, children by `sortOrder`.
- `saveFinancialProfile(userId: string, input: FinancialProfileInput, now = new Date()): Promise<{ profile: FinancialProfile; changed: boolean }>`. Steps: (1) Look up the target accounts by `{ id: { in }, userId }`, including archived ones. A missing account throws `InvalidReferenceError("contributionTargets.<i>.accountId", "Choose one of your accounts.")`; an ineligible type throws the same field with "Contribution targets can only point at cash, investment, or retirement accounts." (2) In `prisma.$transaction`, `$executeRaw` `pg_advisory_xact_lock(hashtext('financial-profile:' || userId))` (the `$executeRaw` reason is in `lib/auth/exponential-backoff.ts`). (3) Read the latest version. If `profileInputsEqual(toProfileInput(latest, now), input)`, return `{ profile: latest, changed: false }`. (4) Otherwise create `version: (latest?.version ?? 0) + 1`, `effectiveAt: now`, `ageAtEffective: input.age`, nested children with `sortOrder` = index.
- Route: `PUT` with `withApiHandler({ logLabel: "api/financial-profile PUT", csrf: true })`. Bad JSON → 400 `BAD_REQUEST`. Parse failure → 400 `VALIDATION_FAILED` with `fieldErrors`. `InvalidReferenceError` → 400 `VALIDATION_FAILED` `{ [field]: message }`. Success → 200 `{ ok: true, data: { profile, changed } }`.

- [ ] **Step 1: Failing tests** (real Postgres; `next/headers` mocked as in the accounts route test): 401 unauthenticated; 403 without CSRF; 400 bad JSON; 400 with `fieldErrors.age`; first save → `version: 1, changed: true`, children persisted in order; a changed second save → `version: 2` and **both** rows still in the DB with version 1's values intact; identical re-save → `changed: false`, still one row; `"treats the derived current age as unchanged"` (call `saveFinancialProfile` with `now` a year after version 1 and `age + 1` → `changed: false`); `"a re-save of a 3-decimal percent is a no-op"`; a target on another user's account → 400 `fieldErrors["contributionTargets.0.accountId"]`; a target on a `credit_card` account → 400, same key; `"accepts a target on an archived account the user owns"`; `"serializes concurrent saves into consecutive versions"` (`Promise.all` of two differing saves → versions `{1, 2}`, both 200); isolation (user B's save leaves user A's version count and values untouched).
- [ ] **Step 2:** `npx vitest run app/api/financial-profile` → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS. **Step 5:** Commit.

### Task 5: List editors

**Files:** Create `components/IncomeStreamsEditor.tsx` + `.test.tsx`, `components/ContributionTargetsEditor.tsx` + `.test.tsx`

**Interfaces — Produces:**
- `IncomeDraft { key: string; kind: IncomeKind; label: string; annualAmount: string; frequency: PayFrequency | "" }`; `IncomeStreamsEditor({ rows, errors, onChange }: { rows: IncomeDraft[]; errors: Record<string, string>; onChange: (rows: IncomeDraft[]) => void })`. Row controls are labelled `Income <n> type`, `Income <n> label`, `Income <n> annual amount`, `Income <n> frequency`, plus a `Remove income <n>` button and a `+ Add income` button. The footer shows "Total annual income" via `totalAnnualIncome` over rows whose amount parses.
- `ContributionDraft { key: string; accountId: string; annualAmount: string }`; `ContributionAccountOption { id: string; name: string; type: AccountType; archived: boolean }`; `ContributionTargetsEditor({ rows, accounts, errors, onChange })`. Controls are labelled `Contribution <n> account`, `Contribution <n> annual amount`, `Remove contribution <n>`, `+ Add contribution target`.
- Both render `errors["<prefix>.<i>.<field>"]` under the control as `text-xs text-danger-muted`, matching `AccountEditModal`.

- [ ] **Step 1: Failing tests.** Income: add → a salary row with frequency `biweekly`; changing kind to bonus moves an untouched default frequency to `annual` but keeps one the user picked; remove drops the row; total sums only parseable rows; a row error renders. Contributions: with no eligible accounts, shows "Add a cash, investment, or retirement account on Net Worth" with a link to `/net-worth` and no add button; `"labels an archived account"` as "<name> (archived)"; an account picked in row 1 is not offered in row 2; add is disabled once every account is used.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement with `key`s from a module-level counter. **Step 4:** PASS. **Step 5:** Commit.

### Task 6: Page, client form, nav item

**Files:** Create `app/(app)/financial-profile/page.tsx`, `components/FinancialProfileClient.tsx` + `.test.tsx`. Modify `lib/nav-config.ts`.

**Interfaces — Consumes:** Tasks 2–5. **Produces:** `FinancialProfileClient({ initialProfile, initialAge, accounts }: { initialProfile: FinancialProfile | null; initialAge: number | null; accounts: ContributionAccountOption[] })`.

- Page: `getSession` → `Promise.all([getCurrentFinancialProfile, listAccounts, listArchivedAccounts])`. Options are the eligible active accounts plus any archived account the current version references (`archived: true`). `initialAge = profile ? ageOn(profile, new Date()) : null`; the age is derived on the server so it doesn't shift during hydration.
- Form sections (cards in `bg-surface rounded-2xl shadow-sm p-6`): **About you** (Current age, Target retirement age, Filing status with "Not specified"); **Income** (editor); **Assumptions** (Expected real return %, Safe withdrawal rate %, Inflation % — empty placeholders, no pre-filled defaults, because an undeclared default is exactly what this feature exists to remove); **Savings** ("Employer match: __% of your contributions, up to __% of salary", both blank = none; contribution targets editor).
- Header: `h1` "Financial Profile", a subtitle, and a meta line: "Not saved yet" or "Version N · saved <date>". The date is formatted in the browser with `suppressHydrationWarning`, since server and browser time zones can differ.
- Submit: build the body (blank → `undefined`, unparsable → `NaN`, both match fields blank → `employerMatch: null`), run `parseFinancialProfileBody`, and on failure show errors without fetching. Otherwise `PUT` with the CSRF header. On `!res.ok || !data.ok`, merge `fieldErrors` and show the message. On success, set the profile and show "Saved as version N." or "No changes to save." Catch → "Network error." The form is not reset from the response.
- Nav: `{ href: "/financial-profile", label: "Financial Profile", icon: <sliders glyph> }` between Net Worth and Profile.

- [ ] **Step 1: Failing tests** (`vi.stubGlobal("fetch", …)`): "Not saved yet" when `initialProfile` is null; fields prefilled from `initialProfile`, with age from `initialAge`; a blank age shows "Required." and fetch is not called; a valid submit sends `PUT /api/financial-profile` whose JSON matches the parsed input and shows "Saved as version 1."; `changed: false` → "No changes to save."; a server `fieldErrors["contributionTargets.0.accountId"]` renders under that row; a rejected fetch → "Network error.".
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** `npx vitest run components` → PASS (includes `no-raw-colors`). **Step 5:** Commit.

### Task 7: E2E + visual screen

**Files:** Create `e2e/financial-profile.spec.ts`. Modify `e2e/visual.spec.ts`.

- [ ] **Step 1:** One serial test: create an eligible account via `createAccount(authedUser.id, …)`. Sidebar link → `/financial-profile` with `aria-current="page"`. Fill age 34, retirement 50, return 5, SWR 3.5, inflation 2.5. Add a salary (90000) and RSUs (20000). Add a contribution to the account. Save → "Saved as version N". Reload → values persist. Change inflation → "Saved as version N+1". Save again → "No changes to save.". Versions are read from the page, so the spec doesn't care which versions exist already.
- [ ] **Step 2:** In `visual.spec.ts`, add a `"financial profile"` screen next to `"profile"`.
- [ ] **Step 3:** `npm run test:e2e -- e2e/financial-profile.spec.ts e2e/net-worth.spec.ts e2e/smoke.spec.ts` → PASS. **Step 4:** Commit.

### Task 8: Docs and full verification

**Files:** Modify `docs/ROADMAP.md` (move #1 to Shipped and note what it unblocks; bump the date and version to v0.4), `README.md` (feature section, "Not yet built" sentence, docs list), `CLAUDE.md` (persistence table, top-level layout, a short "Architecture: Financial Profile" section pointing at 0013/0014), `package.json` version `0.4.0`.

- [ ] **Step 1:** Edit the docs.
- [ ] **Step 2:** `npm run lint && npm run typecheck && npm test && npm run check:env` → all pass. Then `npm run build` → succeeds.
- [ ] **Step 3:** Commit.

---

## Deliberately not in this plan

- `getFinancialProfileAsOf(userId, date)`, the reader that makes old versions useful. Net worth projections (#3) is its first consumer and adds it there. The data it needs exists from version 1.
- A version-history UI.
- Deriving savings rate or an earned/passive income split. That's #3/#4 arithmetic over these inputs, and `IncomeKind` already carries what the split needs.
