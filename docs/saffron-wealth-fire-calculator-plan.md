# FIRE Calculator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/fire` page that pre-fills a FIRE projection from Net Worth, Transactions and the Financial Profile, shows every assumption it used, replays real market history for pessimistic-to-optimistic scenarios to FI and to Coast FI, and lets the user override the inputs with sliders.

**Architecture:** The page is a Server Component. It reads the profile, the accounts and the **full** transaction history (not the 13-month AppProvider window), reduces them server-side to a small `FireInputs` object, and hands that to a client component. Everything slider-driven runs client-side in pure `lib/fire-*.ts` modules over an embedded table of annual real returns since 1871. Nothing is persisted. There are no API routes, no migration and no new npm dependency.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind 3 theme tokens, Vitest + happy-dom + RTL, Playwright. A one-off Python script (pandas + xlrd) converts the Shiller spreadsheet into TypeScript data.

**Spec:** `docs/ROADMAP.md` §4 "FIRE calculator", plus the decisions below, settled with the author before this plan was written.

## Decisions settled before planning

| Question | Decision |
|---|---|
| Where it lives | `/fire`, sidebar label "FIRE", in the first nav section after Transactions. Page heading "FIRE Calculator". |
| Scenario engine | **Historical sequences**: every complete rolling window of real US returns since 1871 (Shiller `ie_data.xls`). |
| Sliders vs history | **Recentre history**: keep each year's place in the boom/crash sequence, but shift the whole series so its long-run geometric mean equals the slider-implied real return. |
| Sliders | Nominal return, inflation, savings rate, safe withdrawal rate, stock allocation. The effective tax rate is also editable. |
| Allocation | One stock/bond split for the whole investable portfolio, cash included. Defaults to **100% stocks**. |
| FI portfolio | **Investable assets**: Cash + Investments + Retirement − credit-card debt. No property, no `loan_mortgage`; hidden, archived and uncategorized accounts are excluded. |
| Spending | Average monthly spend over the **whole** transaction history, each month restated in today's dollars (Shiller CPI, then the profile's inflation rate for months past the data). One-off big purchases are **amortized**: ≥ $5,000 in today's dollars and not recurring, spread over a 10-year life. |
| Income and savings | Income = **Financial Profile gross**. Savings = gross × (1 − effective tax rate) − spending. Employer match is added to contributions. The tax rate is pre-filled from data where possible and otherwise must be entered. |
| Savings-rate slider | **Coupled**: income is fixed, so a higher savings rate lowers spending, which lowers the FI number too. |
| Horizon | Accumulation to FI only. Drawdown, Social Security and taxes on withdrawal belong to roadmap #6. |
| Overrides | Ephemeral, with a "Reset to defaults" button. No saved scenarios. |

## Global Constraints

- Colours only through theme tokens (`text-fg-muted`, `bg-surface`, `bg-accent-solid`, `text-danger-muted` …). `components/__tests__/no-raw-colors.test.ts` enforces this. Chart fills use existing `data-*` / `accent-*` tokens; add a token (with both themes) only if none fits.
- Tailwind classes appear as full strings. State that styling signals gets a `data-*` attribute, and tests assert on that attribute.
- Money is a JS `number` in dollars. Round totals with `roundToCent` and display them with `formatUsd` (`lib/money.ts`).
- **Percents vs fractions.** Levers, the profile and everything displayed use percent as typed (`5` means 5%). `lib/fire-simulation.ts` takes and returns fractions (`0.05`). The conversion happens in exactly one place: `lib/fire-levers.ts`.
- **All money in the projection is real (today's dollars).** Nominal figures exist only as the return slider's input.
- Month keys are `"YYYY-MM"` strings, built by slicing `"YYYY-MM-DD"` transaction dates. Never build a `Date` to find a transaction's month. `asOf`'s month comes from local calendar fields (period math is local; see `docs/decisions/0010-utc-persistence-local-period-math.md`).
- No new npm dependencies. No Prisma schema change. No API route: the page is read-only.
- Synthetic data only in tests, fixtures and docs (public repo).
- Comments explain why, not what. A decision that takes more than a few lines to justify goes in `docs/decisions/`.

## Review Focus

1. **A monthly rent or mortgage payment of $5,000 or more.** It recurs, so it must stay in regular spending and never be amortized. → Task 2 test `"keeps a big monthly rent in regular spending"`.
2. **An annual bill seen only once in a short history** (property tax in a 10-month export). It will be amortized, and that can't be fixed from the data alone, so it has to be visible. → Task 7 test `"lists each amortized purchase with its annualized amount"`.
3. **Spending above after-tax income** (negative savings). The savings slider must reach below 0%, the projection must report "not reached" and never `NaN`. → Task 4 test `"negative savings produce a negative savings rate"`, Task 5 test `"negative contributions never reach FI and never produce NaN"`.
4. **Already at or past the target retirement age.** Coast FI must read "Past your target age", with no division by a zero or negative exponent. → Task 4 test `"coastFiNumber is null at or past the target age"`, Task 5 test `"coast years are null when there are no years to target"`.
5. **A retired user with no income streams.** The savings rate is undefined, so the savings slider is disabled with a hint. There is no tax prompt: the tax rate defaults to 0, its slider is disabled with the same hint, and the assumptions panel calls it not applicable. The projection still runs, with contributions of −spending + employer match: a drawdown, not growth alone. → Task 4 test `"savings rate is null with no after-tax income"`, Task 8 test `"skips the tax prompt and disables the income sliders when there is no income"`, `defaultLevers` test `"defaults the tax rate to 0 when the profile declares no income, so there is nothing to ask for"`.

---

## File structure

| File | Responsibility |
|---|---|
| `scripts/build-market-history.py` | One-off: `ie_data.xls` → the two generated data files below |
| `lib/market-history-data.ts` | Generated: `ANNUAL_REAL_RETURNS`, `MARKET_HISTORY_SOURCE` (shipped to the client) |
| `lib/cpi-data.ts` | Generated: `MONTHLY_CPI` from 1970-01 (server-only; spending deflation) |
| `lib/types.ts` | New FIRE types (Task 1 Interfaces) |
| `lib/fire-spending.ts` | Pure: CPI restatement, recurrence test, spending baseline |
| `lib/fire-inputs.ts` | Pure: investable portfolio, take-home, payroll deductions, match, derived tax rate, `buildFireInputs` |
| `lib/fire-levers.ts` | Pure: default levers, percent↔fraction, coupled savings rate, FI / Coast FI numbers |
| `lib/fire-simulation.ts` | Pure: blend, recentre, windows, per-window FI and Coast FI years, percentile summary, bands |
| `components/FireChart.tsx` | SVG percentile-band chart (hand-rolled, like `NetWorthChart`) |
| `components/FireLeverSlider.tsx` | One labelled range input with a value readout and a modified marker |
| `components/FireAssumptions.tsx` | The assumptions panel |
| `components/FireScenarioTable.tsx` | Scenario rows for the FI or Coast FI view |
| `components/FireCalculatorClient.tsx` | Lever state, view toggle, empty states, composition |
| `app/(app)/fire/page.tsx` | RSC: session, reads, `buildFireInputs` |
| `lib/nav-config.ts` | New nav item |
| `e2e/fire.spec.ts` | End-to-end |
| `docs/decisions/0015…0017`, `docs/decisions/README.md`, `docs/ROADMAP.md`, `README.md`, `CLAUDE.md` | Records and docs |

---

### Task 1: Market history data

**Files:**
- Create: `scripts/build-market-history.py`, `lib/market-history-data.ts` (generated), `lib/cpi-data.ts` (generated)
- Modify: `lib/types.ts`
- Test: `lib/market-history-data.test.ts`

**Interfaces:**
- Produces (in `lib/types.ts`): `AnnualRealReturn { year: number; stocks: number; bonds: number }`, where each value is the calendar year's real total return as a fraction, and `MonthlyCpi { month: string /* "YYYY-MM" */; cpi: number }`.
- Produces: `ANNUAL_REAL_RETURNS: AnnualRealReturn[]` (ascending, contiguous), `MARKET_HISTORY_SOURCE: { name: string; url: string; retrieved: string /* YYYY-MM-DD */; lastMonth: string /* YYYY-MM */ }`, `MONTHLY_CPI: MonthlyCpi[]` (ascending, contiguous).

- [ ] **Step 1: The spreadsheet.** The author downloaded it from https://shillerdata.com/ to `~/Downloads/ie_data.xls` (Shiller's workbook, saved 2026-10-05, 1.6 MB). Read it in place. Never copy it into the repo or commit it.
- [ ] **Step 2: Write `scripts/build-market-history.py <path-to-xls>`.** It reads sheet `Data`. The header is **stacked over several rows**: the row whose first cell is `Date` (row index 7) is the bottom of the header, and the data starts on the next row (first date `1871.01`). Build each column's label by joining, with single spaces, its non-empty cells from the header rows above the data, skipping the workbook title that sits in column 0's top rows. Verified against the 2026-10 file: column 0 → `Date`, column 4 → `Consumer Price Index CPI`, column 9 → `Real Total Return Price` (stocks, a cumulative index), column 18 → `Real Total Bond Returns` (bonds, a cumulative index starting at 1.0). Find columns by label (bottom cell `Date`, bottom cell `CPI`, the full stacked labels for the two indices), not by position. If one is missing, exit non-zero and print the labels found, so a relabel fails loudly. Skip rows whose date cell isn't a number. Shiller dates are floats in which `1871.1` means **October**: month = `round((v − int(v)) × 100)`. Annual return for year `y` = `idx[Jan y+1] / idx[Jan y] − 1`, rounded to 6 dp, for every `y` that has both Januaries; with data through `2026.1`, that is 1871…2025. CPI runs monthly from 1970-01 to the last non-empty row (2026-10, preliminary), rounded to 3 dp. Each generated file opens with a "Generated by scripts/build-market-history.py; do not edit" header and the source attribution. The script's header comment documents the usage: `python3 -E scripts/build-market-history.py ~/Downloads/ie_data.xls`. It needs `pip3 install --user pandas xlrd`; this Mac's system pip 21 has no `--break-system-packages`, and `-I` would hide the user site-packages that pandas lives in.
- [ ] **Step 3: Run it**, then confirm that `git status` shows only the two generated files and the script.
- [ ] **Step 4: Write the sanity tests.** `"years are contiguous from 1871"`: first year 1871, each next = previous + 1, last ≥ 2025. `"every return is plausible"`: every value in (−0.6, 0.7). `"1931 was a crash"`: stocks for 1931 < −0.3. `"long-run stock CAGR is in the historical range"`: geometric mean of `1 + stocks` minus 1 is in [0.05, 0.08]. `"CPI months are contiguous and positive"`: first `1970-01`, consecutive months, every `cpi > 0`. `"source names the last month"`: `MARKET_HISTORY_SOURCE.lastMonth` matches the last CPI month.
- [ ] **Step 5: Run** `npx vitest run lib/market-history-data.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit** (`Add Shiller market history data for the FIRE calculator`).

### Task 2: Spending baseline

**Files:**
- Create: `lib/fire-spending.ts`, `docs/decisions/0016-fire-spending-baseline.md`
- Modify: `lib/types.ts`
- Test: `lib/fire-spending.test.ts`

**Interfaces:**
- Consumes: `MonthlyCpi`, `Transaction`.
- Produces (types): `AmortizedPurchase { date: string; description: string; amount: number; realAmount: number; annualized: number }`, `SpendingBaseline { annualSpending: number; regularAnnual: number; amortizedAnnual: number; months: number; fromMonth: string; toMonth: string; cpiThrough: string; amortized: AmortizedPurchase[] }`.
- Produces (functions): `BIG_PURCHASE_THRESHOLD = 5000`, `BIG_PURCHASE_LIFE_YEARS = 10`, `cpiFactor(fromMonth: string, toMonth: string, cpi: MonthlyCpi[], inflationPct: number): number`, `merchantKey(t: Pick<Transaction, "merchant" | "description">): string`, `isRecurringCharge(t: Transaction, expenses: Transaction[]): boolean`, `computeSpendingBaseline(transactions: Transaction[], asOf: Date, cpi: MonthlyCpi[], inflationPct: number): SpendingBaseline | null`.

Rules the signatures don't settle:
- Only `type === "expense"` counts. Transfers and income are ignored.
- Window: `toMonth` is the month before `asOf`'s month. `fromMonth` is the month after the earliest expense's month, because an import rarely starts on the 1st. When the earliest expense *is* on the 1st, or when dropping that month would leave no complete month, `fromMonth` is the earliest month itself. `months` counts calendar months in the window, including months with no spend. If `fromMonth > toMonth`, or there are no expenses, return `null`.
- `cpiFactor` = `CPI(to) / CPI(from)`. A month past the table extends its last value at `(1 + inflationPct/100)^(monthsPast/12)`. A month before the table clamps to its first value.
- Real amount = `amount × cpiFactor(txMonth, asOfMonth, …)`.
- `merchantKey` = `(merchant ?? description).trim().toLowerCase()`.
- Recurring = some *other* expense with the same `merchantKey`, an amount within ±25% of this one's, dated 25 to 400 days away. That covers monthly through annual bills.
- Big = real amount ≥ `BIG_PURCHASE_THRESHOLD` and not recurring. `annualized = realAmount / max(months / 12, BIG_PURCHASE_LIFE_YEARS)`.
- `regularAnnual = Σ(real non-big) / months × 12`. `annualSpending = regularAnnual + amortizedAnnual`. All values rounded to the cent. `cpiThrough` is the last month in the CPI table.

- [ ] **Step 1: Write the failing tests.** CPI table for the fixtures: `[{month:"2024-01",cpi:300},{month:"2025-01",cpi:309}]` padded monthly, or flat at 100 where the test says "flat".
  - `"cpiFactor inside the table"`: `2024-01 → 2025-01` = 1.03.
  - `"cpiFactor extends past the table at the profile rate"`: table ending at `2025-01` = 309, `2024-01 → 2025-07` at 4% → `toBeCloseTo(1.0503980, 6)`.
  - `"merchantKey falls back to the description"`: `{merchant:"  Costco ", …}` → `"costco"`; `{merchant:null, description:"Rent"}` → `"rent"`.
  - `"an annual insurance premium is recurring"`: $6,000 on 2024-03-10 and $6,300 on 2025-03-12, same merchant → `true`.
  - `"a one-off car is not recurring"`: a single $30,000 at "Dealer" → `false`.
  - `"a big buy at a frequent merchant is not recurring"`: $6,000 "Amazon" plus a $40 "Amazon" one year later → `false`.
  - `"keeps a big monthly rent in regular spending"`: flat CPI, $5,500 "Landlord" on the 3rd of every month from 2025-11 through 2026-09, asOf 2026-10-15 → `amortized` is empty and `regularAnnual` = 66,000.
  - `"amortizes a car over ten years"`: flat CPI, $3,000 "Landlord" on the 3rd of each month 2024-10 … 2026-10, plus $30,000 "Dealer" on 2025-06-20, asOf 2026-10-15 → `fromMonth` `"2024-11"`, `toMonth` `"2026-09"`, `months` 23, `regularAnnual` 36,000, `amortizedAnnual` 3,000, `annualSpending` 39,000, one `amortized` entry with `annualized` 3,000.
  - `"restates old months in today's dollars"`: CPI 100 in `2025-01`, 110 in `2026-10` (the table's last month), asOf 2026-10-15, a single $10,000 "Dealer" expense on 2025-01-01 (on the 1st, so its month stays in the window) → its `amortized` entry has `realAmount` 11,000.
  - `"excludes the current partial month"`: a $10,000 expense dated in `asOf`'s month leaves the result unchanged.
  - `"ignores transfers and income"`, and `"returns null with no expenses"`.
- [ ] **Step 2: Run** `npx vitest run lib/fire-spending.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `lib/fire-spending.ts` per the rules above.
- [ ] **Step 4: Run it again.** Expected: PASS.
- [ ] **Step 5: Write decision 0016** (full-history average in today's dollars; amortize rather than cap or trim, because cars recur over a lifetime; the recurrence test and why it compares amounts; known blind spot: an annual bill seen once in a short history). Add it to `docs/decisions/README.md`.
- [ ] **Step 6: Commit** (`Compute the FIRE spending baseline from full transaction history`).

### Task 3: FIRE inputs

**Files:**
- Create: `lib/fire-inputs.ts`, `docs/decisions/0017-fire-savings-from-profile-income.md`
- Modify: `lib/types.ts`
- Test: `lib/fire-inputs.test.ts`

**Interfaces:**
- Consumes: Task 2's `computeSpendingBaseline`, `SpendingBaseline`; `ageOn`, `totalAnnualIncome` (`lib/financial-profile-utils.ts`); `getBucketForType` (`lib/account-utils.ts`); `MonthlyCpi`.
- Produces (types): `InvestablePortfolio { total: number; cash: number; investments: number; retirement: number; creditCardDebt: number }`, where `creditCardDebt` is net owed (a statement credit makes it smaller), and `TakeHome { annual: number; months: number }`. Also:
  `FireInputs { asOf: string; age: number; targetRetirementAge: number; portfolio: InvestablePortfolio; spending: SpendingBaseline; grossIncome: number; cashIncome: number; takeHome: TakeHome | null; payrollDeductions: number; employerMatch: number; derivedTaxRatePct: number | null; profileRealReturnPct: number; profileInflationPct: number; profileSafeWithdrawalRatePct: number }`
  and `FirePageState = { state: "ready"; inputs: FireInputs } | { state: "no-profile" } | { state: "no-spending" }`.
- Produces (functions): `PAYROLL_ACCOUNT_TYPES: AccountType[] = ["401k", "roth_401k", "hsa", "espp"]`, `MATCH_ACCOUNT_TYPES: AccountType[] = ["401k", "roth_401k"]`, `CASH_INCOME_KINDS: IncomeKind[] = ["salary", "bonus", "rental", "self_employment", "other"]`, `computeInvestablePortfolio(accounts: Account[]): InvestablePortfolio`, `computeTakeHome(transactions: Transaction[], asOf: Date, fromMonth: string): TakeHome | null`, `payrollDeductions(profile: FinancialProfile, accountTypes: Map<string, AccountType>): number`, `employerMatchAmount(profile: FinancialProfile, accountTypes: Map<string, AccountType>): number`, `deriveEffectiveTaxRatePct(cashIncome: number, takeHome: TakeHome | null, payroll: number): number | null`, `buildFireInputs(args: { profile: FinancialProfile | null; accounts: Account[]; archivedAccounts: Account[]; transactions: Transaction[]; asOf: Date; cpi: MonthlyCpi[] }): FirePageState`.

Rules:
- Investable portfolio: active accounts only, skipping `hiddenFromNetWorth` and the `uncategorized` bucket. Cash, investments and retirement balances add. `credit_card` balances subtract (a negative card balance adds). `property` and `loan_mortgage` are left out.
- Take-home: income transactions in the last 12 complete months before `asOf`'s month, but not before `fromMonth`. `annual = Σ / months × 12`. Return `null` when `months < 6`.
- Payroll deductions: the profile's contribution targets on accounts whose type is in `PAYROLL_ACCOUNT_TYPES`. The type comes from active and archived accounts, since a target may point at an archived account.
- Match: `matchPct/100 × min(Σ targets on MATCH_ACCOUNT_TYPES, limitPct/100 × Σ salary streams)`, or 0 with no match.
- Derived tax: `1 − (takeHome.annual + payroll) / cashIncome`, as a percent rounded to 1 dp. Return `null` when `takeHome` is null, `cashIncome ≤ 0`, or the result falls outside [0, 60]. RSUs and interest/dividends are left out of `cashIncome` because they rarely land in checking.
- `buildFireInputs`: no profile → `no-profile`. Spending baseline `null` → `no-spending`. Otherwise `ready`. `age = ageOn(profile, asOf)`; `asOf` is serialized as `"YYYY-MM-DD"` from local fields.

- [ ] **Step 1: Write the failing tests.**
  - `"investable portfolio excludes home, mortgage, hidden and uncategorized"`: cash 10,000, brokerage 100,000, 401k 50,000, property 500,000, loan_mortgage 300,000, credit_card 2,000, hidden brokerage 40,000, uncategorized 5,000, and a second credit_card at −500 → `total` 158,500 and `creditCardDebt` 1,500.
  - `"match is capped at the limit"`: salary 150,000, match 50% up to 6%, 401k target 20,000 → 4,500. With a 5,000 target → 2,500. A `roth_401k` target counts. A `roth_ira` target doesn't. No match → 0.
  - `"payroll deductions count only paycheck accounts"`: 401k 20,000 + hsa 4,000 + roth_ira 7,000 → 24,000. A target on an archived 401k still counts.
  - `"derives the effective tax rate from cash income"`: cash income 150,000, take-home 90,000, payroll 24,000 → 24.0. A take-home of `null` → `null`. A result of 75% → `null`. A result below 0 → `null`.
  - `"take-home annualizes a short history and refuses a very short one"`: $6,000 income in each of the last 12 complete months → `{annual: 72000, months: 12}`. 8 months → annualized × 12/8. 4 months → `null`.
  - `"buildFireInputs reports what's missing"`: no profile → `{state:"no-profile"}`. A profile with no expenses → `{state:"no-spending"}`.
  - `"buildFireInputs excludes RSU income from cash income"`: salary 150,000 + rsu 50,000 → `grossIncome` 200,000, `cashIncome` 150,000.
- [ ] **Step 2: Run** `npx vitest run lib/fire-inputs.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `lib/fire-inputs.ts`.
- [ ] **Step 4: Run it again.** Expected: PASS.
- [ ] **Step 5: Write decision 0017** (income is profile gross; savings = gross × (1 − t) − spend; why not gross − spend, which counts taxes as savings; how the tax pre-fill is derived and why RSU and interest/dividend income are left out; no pre-fill outside [0, 60]). Add it to the decisions index.
- [ ] **Step 6: Commit** (`Assemble FIRE inputs from profile, accounts and transactions`).

### Task 4: Levers and derived outputs

**Files:**
- Create: `lib/fire-levers.ts`
- Test: `lib/fire-levers.test.ts`

**Interfaces:**
- Consumes: `FireInputs`.
- Produces: `FireLevers { nominalReturnPct: number; inflationPct: number; annualSpending: number; safeWithdrawalRatePct: number; stockAllocationPct: number; effectiveTaxRatePct: number | null }`.
  The state holds **spending**, not the savings rate. The savings-rate slider is a view of spending, so changing the tax rate leaves spending alone and recomputes the savings rate.
- Produces: `defaultLevers(inputs: FireInputs): FireLevers` (nominal = `((1 + real/100)(1 + infl/100) − 1) × 100`, rounded to 2 dp; spending = `inputs.spending.annualSpending`; allocation 100; tax = `derivedTaxRatePct`), `realReturn(levers): number` (a fraction: `(1 + n/100)/(1 + i/100) − 1`), `afterTaxIncome(inputs, levers): number`, `savingsRatePct(inputs, levers): number | null`, `spendingForSavingsRate(inputs, levers, pct: number): number`, `annualContribution(inputs, levers): number` (after-tax − spending + match), `fiNumber(levers): number` (spending ÷ SWR), `coastFiNumber(fi: number, realReturn: number, yearsToTarget: number): number | null`, `leverRanges(inputs: FireInputs, defaults: FireLevers): Record<"nominalReturnPct" | "inflationPct" | "savingsRatePct" | "safeWithdrawalRatePct" | "stockAllocationPct" | "effectiveTaxRatePct", { min: number; max: number; step: number }>` (nominal −2…15 step 0.1; inflation 0…10 step 0.1; savings `min(0, floor(default savings rate))`…90 step 1, so a negative derived rate is reachable; SWR 2.5…6 step 0.05; stocks 0…100 step 5; tax 0…60 step 0.5), and `leversEqual(a, b): boolean`.
  The income-dependent functions require `effectiveTaxRatePct` to be set. The client gates on `null` before calling them (Task 8).

- [ ] **Step 1: Write the failing tests.**
  - `"default nominal return reproduces the profile's real return"`: real 5, inflation 3 → nominal 8.15, and `realReturn` → `toBeCloseTo(0.05, 10)`.
  - `"savings rate is measured against after-tax profile income"`: gross 100,000, tax 25, spending 45,000 → 40.
  - `"savings slider moves spending"`: same inputs, 50% → 37,500.
  - `"contribution adds the match"`: after-tax 75,000 − 45,000 + match 3,000 → 33,000.
  - `"FI number is spending over the withdrawal rate"`: 40,000 at 4 → 1,000,000.
  - `"coastFiNumber discounts at the real return"`: 1,000,000, 0.05, 20 → `toBeCloseTo(376889.48, 2)`.
  - `"coastFiNumber is null at or past the target age"`: 0 years → `null`; −3 → `null`.
  - `"negative savings produce a negative savings rate"`: after-tax 75,000, spending 90,000 → −20.
  - `"savings rate is null with no after-tax income"`: gross 0 → `null`.
- [ ] **Step 2: Run** `npx vitest run lib/fire-levers.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `lib/fire-levers.ts`.
- [ ] **Step 4: Run it again.** Expected: PASS.
- [ ] **Step 5: Commit** (`Add FIRE levers and derived outputs`).

### Task 5: Historical simulation

**Files:**
- Create: `lib/fire-simulation.ts`, `docs/decisions/0015-fire-recentred-historical-sequences.md`
- Test: `lib/fire-simulation.test.ts`

**Interfaces:**
- Consumes: `AnnualRealReturn`.
- Produces: `blendReturns(history: AnnualRealReturn[], stockPct: number): number[]`, `recenterReturns(returns: number[], targetReal: number): number[]`, `horizonYears(age: number, targetRetirementAge: number): number` (= `min(70, max(40, target − age))`), `WindowResult { startYear: number; balances: number[] /* horizon + 1 */; yearsToFi: number | null; coastFiYears: number | null }`, `simulateWindows(input: { portfolio: number; contribution: number; fiNumber: number; yearsToTarget: number; horizon: number; returns: number[]; firstYear: number }): WindowResult[]`, `ScenarioLabel = "Best" | "Optimistic" | "Neutral" | "Pessimistic" | "Worst"`, `ScenarioRow { label: ScenarioLabel; years: number | null; startYear: number }`, `FireSummary { fi: ScenarioRow[]; coast: ScenarioRow[]; windowCount: number; firstStartYear: number; lastStartYear: number; reachedByTargetShare: number; coastNowShare: number; bands: { year: number; p10: number; p50: number; p90: number }[] }`, `summarize(results: WindowResult[], yearsToTarget: number): FireSummary`.

Algorithm:
- Blend: `w·stocks + (1 − w)·bonds`, rebalanced annually.
- Recentre in log space, so the series' **geometric** mean equals the target (an arithmetic shift would leave the median path about σ²/2 below what the user declared): `ln(1 + r′) = ln(1 + r) − mean(ln(1 + r)) + ln(1 + target)`.
- Complete windows only: start index `j` for every `j + horizon ≤ returns.length`.
- Step with mid-year contributions: `P[k+1] = P[k]·(1 + r) + C·√(1 + r)`.
- Years to FI: `0` if `P[0] ≥ F`. Otherwise it is the first `k` with `P[k+1] ≥ F`, plus `(F − P[k]) / (P[k+1] − P[k])`. If no year qualifies, `null`.
- Coast FI years: the first integer `k ≤ yearsToTarget` with `P[k] × Π(1 + r) over years k … yearsToTarget−1 ≥ F`, computed from prefix sums of `ln(1 + r)`. If none, `null`. If `yearsToTarget ≤ 0`, `null`.
- Summary: sort by years, with `null` last. Use the nearest-rank percentile (`ceil(p·n) − 1`). Best = min, Optimistic = p10, Neutral = p50, Pessimistic = p90, Worst = max. Each row carries the start year of the window at that rank. `fi` and `coast` are ranked independently. `reachedByTargetShare` = share with `yearsToFi ≤ yearsToTarget`. `coastNowShare` = share with `coastFiYears === 0`. `bands` holds p10/p50/p90 of `balances[k]` across windows, for every `k`.

- [ ] **Step 1: Write the failing tests.**
  - `"blends 60/40"`: stocks 0.10, bonds 0.02 → 0.068.
  - `"recentres to the target geometric mean and keeps the ratios"`: `[0.1, −0.1]` to 0.05 → `Π(1 + r′)` ≈ `1.05²` (1e-12), and `(1 + r′₀)/(1 + r′₁)` ≈ `1.1/0.9`.
  - `"interpolates years to FI"`: constant 0.05, P0 100,000, C 0, F 200,000 → `toBeCloseTo(14.2027, 3)`.
  - `"mid-year contributions at zero return"`: r 0, P0 0, C 10,000, F 50,000 → 5.
  - `"already FI"`: P0 ≥ F → 0.
  - `"negative contributions never reach FI and never produce NaN"`: r 0.05, P0 100,000, C −20,000, F 1,000,000 → `yearsToFi` `null`, and every balance is finite.
  - `"coast years at zero return"`: r 0, P0 100,000, C 10,000, F 200,000, target 30 → 10. Target 5 → `null`.
  - `"coast years are null when there are no years to target"`: `yearsToTarget` 0 → `null`.
  - `"uses complete windows only"`: 50 years of returns, horizon 40 → 11 results, start years `firstYear … firstYear + 10`.
  - `"horizon bounds"`: (30, 45) → 40; (25, 70) → 45; (16, 100) → 70.
  - `"summary ranks with nearest rank and nulls last"`: years 1…10 → Best 1, Optimistic 1, Neutral 5, Pessimistic 9, Worst 10. Replacing the 10 with `null` makes Worst `null`.
  - `"share reaching FI by the target age"`: years [5, 10, 15, null], target 10 → 0.5.
- [ ] **Step 2: Run** `npx vitest run lib/fire-simulation.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `lib/fire-simulation.ts`.
- [ ] **Step 4: Run it again.** Expected: PASS.
- [ ] **Step 5: Write decision 0015** (history over Monte Carlo; log-space recentring and why not arithmetic; complete windows rather than wrap-around, with the horizon bounds; mid-year contributions; accumulation only). Add it to the decisions index.
- [ ] **Step 6: Commit** (`Simulate FI and Coast FI over recentred historical windows`).

### Task 6: FIRE chart

**Files:**
- Create: `components/FireChart.tsx`
- Test: `components/FireChart.test.tsx`

**Interfaces:**
- Consumes: `FireSummary["bands"]`.
- Produces: `default function FireChart(props: { bands: FireSummary["bands"]; age: number; fiNumber: number; coastLine: number[] | null; view: "fi" | "coast" })`, plus the exported pure helpers `yDomain(bands, fiNumber, coastLine): [number, number]` and `bandPath(bands, x, y): string`.

The x axis is age (`age + year`). The y axis is real dollars, compact currency. The p10–p90 band is a filled area, p50 a line, and the FI number a horizontal rule labelled "FI number". In the Coast view, `coastLine[k] = coastFiNumber(F, r, T − k)` is drawn for `k ≤ T`. Width tracking via `ResizeObserver` and the `DEFAULT_WIDTH` fallback follow `components/NetWorthChart.tsx`. The SVG gets `role="img"` and an `aria-label` that summarizes the neutral path.

- [ ] **Step 1: Write the failing tests.** `"y domain covers the band and the FI line"` (FI above every p90 → upper bound ≥ FI); `"band path closes the area"` (the path starts with `M` and ends with `Z`); `"draws the coast line only in the coast view"` (`data-series="coast"` present only when `view="coast"`).
- [ ] **Step 2: Run** `npx vitest run components/FireChart.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** `components/FireChart.tsx`.
- [ ] **Step 4: Run it again.** Expected: PASS.
- [ ] **Step 5: Commit** (`Add the FIRE projection chart`).

### Task 7: Sliders, assumptions and scenario table

**Files:**
- Create: `components/FireLeverSlider.tsx`, `components/FireAssumptions.tsx`, `components/FireScenarioTable.tsx`
- Test: `components/FireLeverSlider.test.tsx`, `components/FireAssumptions.test.tsx`, `components/FireScenarioTable.test.tsx`

**Interfaces:**
- Consumes: `FireInputs`, `FireLevers`, `ScenarioRow`, `FireSummary`, `MARKET_HISTORY_SOURCE`.
- Produces:
  - `FireLeverSlider({ id, label, value, min, max, step, format: (v: number) => string, onChange: (v: number) => void, modified: boolean, disabled?: boolean, hint?: string })`. It renders a native `<input type="range">` with an associated `<label>`, plus the formatted value, and `data-modified`.
  - `FireAssumptions({ inputs, levers })`.
  - `FireScenarioTable({ rows, view: "fi" | "coast", age, asOfYear, horizon, windowCount, firstStartYear, lastStartYear, share })`.
  - `formatYears(years: number | null, horizon: number): string`, exported from `FireScenarioTable.tsx`: `null` → `"Not within {horizon} years"`; 0 → `"Now"`; otherwise `"{y} yrs {m} mo"` with months rounded, so 14.2027 → `"14 yrs 2 mo"`.

The assumptions panel is a `<dl>` with these rows. Each value is followed by its source in `text-fg-muted`:
1. Age and target retirement age (Financial Profile).
2. Investable portfolio and its four parts, plus "Excludes your home, mortgage, hidden, archived and uncategorized accounts".
3. Annual spending: "{months} months of history ({fromMonth} – {toMonth}), in today's dollars (CPI through {cpiThrough}, then {inflation}%/yr)", then regular + amortized, then a disclosure listing each amortized purchase (date, description, amount, `/yr`).
4. Gross income (Financial Profile), effective tax rate with its derivation or "entered by you", and after-tax income.
5. Employer match.
6. Savings rate and annual contribution.
7. Return: nominal, inflation, and the resulting real return.
8. Safe withdrawal rate → FI number.
9. Allocation, plus "History: Shiller, {firstStartYear}–{lastStartYear} starts, {windowCount} windows of {horizon} years, recentred to your real return".
10. "Not modeled": taxes on withdrawals, Social Security and pensions, fund fees, contributions rising with raises, the withdrawal phase (roadmap #6).

The scenario table has columns Scenario, Years, Age, Year, and "Like starting in" (start year). Above it: "{share}% of historical starts reach FI by your target age", or in the Coast view "{share}% are already Coast FI".

- [ ] **Step 1: Write the failing tests.**
  - Slider: `"reports a change as a number"` (`fireEvent.change` to "3.5" → `onChange(3.5)`); `"marks a modified lever"` (`data-modified="true"`); `"disabled slider shows its hint"`.
  - Table: `"formatYears"` (14.2027 → `"14 yrs 2 mo"`, 0 → `"Now"`, `null` with 40 → `"Not within 40 years"`); `"renders five scenarios in order"`; `"shows FI age and calendar year"` (age 35, years 14.2027, asOfYear 2026 → age `49`, year `2040`).
  - Assumptions: `"shows each source"` (portfolio total, spending, gross income and FI number all appear, formatted with `formatUsd`); `"lists each amortized purchase with its annualized amount"`; `"says when the tax rate was entered rather than derived"`.
- [ ] **Step 2: Run** `npx vitest run components/FireLeverSlider.test.tsx components/FireAssumptions.test.tsx components/FireScenarioTable.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the three components.
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit** (`Add FIRE sliders, assumptions panel and scenario table`).

### Task 8: Page, client and nav

**Files:**
- Create: `components/FireCalculatorClient.tsx`, `app/(app)/fire/page.tsx`
- Modify: `lib/nav-config.ts`
- Test: `components/FireCalculatorClient.test.tsx`

**Interfaces:**
- Consumes: everything above. Page: `getSession`, `getCurrentFinancialProfile`, `listAccounts`, `listArchivedAccounts`, `listTransactions(userId)` with **no** `from` (full history; this page doesn't read AppProvider's window), `MONTHLY_CPI`, `buildFireInputs`.
- Produces: `default function FireCalculatorClient(props: { page: FirePageState })`.

Behaviour:
- `no-profile`: a card reading "Add your Financial Profile to see your FIRE numbers" that links to `/financial-profile`.
- `no-spending`: "Add or import transactions to estimate your spending", linking to `/transactions`.
- `ready`, with `effectiveTaxRatePct === null`: a number input labelled "Effective tax rate (%)" and the line "We couldn't estimate this from your transactions." Results stay hidden until a value in [0, 60] is entered. There is no hidden default.
- `ready`: headline cards (FI number; investable portfolio and % of FI; neutral years to FI and FI age; Coast FI number and whether it's reached now). Then the six sliders, a "Reset to defaults" button (disabled when `leversEqual(levers, defaults)`), tabs "Years to FI" / "Coast FI" (`role="tab"`, `aria-selected`, `data-state`), the chart, the scenario table, and the assumptions panel.
- The simulation is memoized on levers: `blendReturns → recenterReturns(realReturn) → simulateWindows → summarize`.
- The savings slider is disabled, with the hint "No income in your Financial Profile", when `savingsRatePct` is `null`.
- Nav: `{ href: "/fire", label: "FIRE", icon: FireIcon }` after Transactions in the first section. The icon is a flame glyph in the existing 24×24 stroke style.

- [ ] **Step 1: Write the failing tests** with a synthetic `FireInputs` fixture: age 35, target 50, portfolio 300,000, spending 48,000, gross 150,000, derived tax 25, match 4,500, profile real 5 / inflation 3 / SWR 4.
  - `"pre-fills from the inputs"`: the FI number reads `formatUsd(1_200_000)`.
  - `"withdrawal-rate slider changes the FI number"`: change it to 3 → `formatUsd(1_600_000)`, and that slider has `data-modified="true"`.
  - `"savings slider lowers spending and the FI number"`: change it to 70 → FI number `formatUsd(33_750 / 0.04)`.
  - `"reset restores the defaults"`.
  - `"switches to the Coast FI view"`: the tab gets `aria-selected="true"` and a Coast FI scenario table appears.
  - `"asks for the tax rate when it can't be derived"`: `derivedTaxRatePct: null` → no FI number until 25 is typed.
  - `"disables the savings slider when there is no income"`: gross 0.
  - `"empty states link to the page that fixes them"`: `no-profile` → a link to `/financial-profile`; `no-spending` → a link to `/transactions`.
- [ ] **Step 2: Run** `npx vitest run components/FireCalculatorClient.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the client, the page and the nav item.
- [ ] **Step 4: Run** `npm test && npm run lint && npm run typecheck`. Expected: all pass. A failing nav or sidebar test is updated to include FIRE, not skipped.
- [ ] **Step 5: Commit** (`Add the FIRE calculator page`).

### Task 9: E2E and docs

**Files:**
- Create: `e2e/fire.spec.ts`
- Modify: `e2e/visual.spec.ts` (add `/fire` alongside the other screens), `docs/ROADMAP.md`, `README.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: the `authedUser` fixture (it is already seeded with `MOCK_TRANSACTIONS`), `saveFinancialProfile`, `createAccount`.

- [ ] **Step 1: Write `e2e/fire.spec.ts`.** Seed a profile with a **single `rsu` income stream**, so `cashIncome` is 0 and the tax prompt always appears; this keeps the spec independent of today's date relative to the fixed mock dates. Seed a brokerage account at 250,000 and a credit card at 2,000. Then: navigate via the "FIRE" nav link; type 25 into the tax field; the FI number is visible; focus the withdrawal-rate slider and press ArrowLeft, and the FI number text changes; "Reset to defaults" restores it; the Coast FI tab shows its table. `afterEach` deletes the profile versions and both accounts (the worker user is shared, as `e2e/financial-profile.spec.ts` notes).
- [ ] **Step 2: Run** `npx playwright test e2e/fire.spec.ts`. Expected: PASS.
- [ ] **Step 3: Docs.** ROADMAP: mark #4 shipped in the Shipped table and under "Next", and move "Where that leaves us" forward. README: the feature, plus a credit for the Shiller data. CLAUDE.md: the shipped list, the top-level layout tree, a new "Architecture: FIRE calculator" section (data flow, the percent/fraction boundary, real dollars, full-history read, decisions 0015–0017), and the E2E file list.
- [ ] **Step 4: Run** `npm run lint && npm run typecheck && npm test && npm run test:e2e`. Expected: all pass.
- [ ] **Step 5: Commit** (`Add FIRE calculator E2E and docs`).
