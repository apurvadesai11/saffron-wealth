// Budget period — v1 only exposes 'monthly' in the UI, but the data model
// supports non-monthly periods so quarterly/semi-annual/annual budgets can be
// added in a future release without a schema migration.
export type BudgetPeriod = 'monthly' | 'quarterly' | 'semi-annual' | 'annual';

// 'transfer' exists so a Monarch-imported transfer-between-accounts row (and
// its category) can be modeled without being mistaken for income or expense —
// every sum in lib/budget-utils.ts filters by strict equality on 'income'/
// 'expense', so a 'transfer' value is excluded automatically, no extra
// filtering needed.
export type CategoryType = 'expense' | 'income' | 'transfer';

export interface Category {
  id: string;
  name: string;
  type: CategoryType;
  color: string; // Tailwind bg-* class for visual indicator
}

export interface Transaction {
  id: string;
  description: string;
  amount: number;
  categoryId: string;
  type: CategoryType;
  date: string; // "YYYY-MM-DD"
  // Which account the money moved in/out of. Optional because pre-import
  // (manually added) transactions aren't tied to a specific Account.
  accountId?: string | null;
  merchant?: string | null;
  notes?: string | null;
}

export interface Budget {
  categoryId: string;
  // 0 is valid — marks the category as "Hidden from Budgets"
  amount: number;
  // v1 always 'monthly'; setting period here makes future non-monthly budgets
  // a data migration rather than a schema change
  period: BudgetPeriod;
}

export type AlertThreshold = 80 | 100;

export interface AlertRecord {
  categoryId: string;
  // Period-aware key so alert state generalises beyond monthly:
  //   monthly      → "2026-01"
  //   quarterly    → "2026-Q1"
  //   semi-annual  → "2026-H1"
  //   annual       → "2026"
  periodKey: string;
  threshold: AlertThreshold;
  firedAt: string; // ISO timestamp
}

// Color states for expense progress bars (< 80 green → ≥ 80 yellow → ≥ 100 red → > 100 deep-red)
export type ExpenseBarColor = 'green' | 'yellow' | 'red' | 'deep-red';

// Color states for income progress bars — inverse model (< 50 red → ≥ 50 orange → ≥ 80 yellow → ≥ 100 green)
export type IncomeBarColor = 'red' | 'orange' | 'yellow' | 'green';

export interface CashflowProjection {
  budgetedIncome: number;
  budgetedExpenses: number;
  // Rate-based per-category extrapolation to month-end (FR-21)
  projectedExpenses: number;
  // budgetedIncome − projectedExpenses
  projectedNet: number;
  // true when the projection falls back to static budget amounts (day 1 or no transactions — FR-24)
  isStaticProjection: boolean;
}

export type AuthEventType =
  | 'signup'
  | 'login_success'
  | 'login_failure'
  | 'password_change'
  | 'password_reset_requested'
  | 'password_reset_completed'
  | 'session_revoked'
  | 'google_oauth_signin'
  | 'oauth_account_linked'
  | 'hibp_unavailable'
  | 'email_change_requested'
  | 'email_change';

// Computed view model used by budget list UI components
export interface BudgetProgress {
  categoryId: string;
  categoryName: string;
  categoryType: CategoryType;
  budgetAmount: number;
  // Actual spend (expense) or received (income) for the current period
  spent: number;
  percent: number;
  barColor: ExpenseBarColor | IncomeBarColor;
  // true when budgetAmount === 0; UI shows "Hidden from Budgets" label instead of bar
  isHidden: boolean;
}

// ── Net Worth / Accounts ──────────────────────────────────────────────────
// Two-level account taxonomy. The top-level bucket determines whether an
// account adds to (asset) or subtracts from (liability) net worth — only the
// `debt` bucket is a liability. The concrete type→bucket mapping and the
// net-worth math live in lib/account-utils.ts.
// 'uncategorized' is a real bucket for display but contributes to no total:
// it holds accounts the import could not classify, so their owner can see and
// fix them. See lib/account-utils.ts's computeNetWorth.
export type AccountBucket =
  | 'cash' | 'investments' | 'retirement' | 'real_estate' | 'debt'
  | 'uncategorized';

export type AccountType =
  | 'cash'
  | 'brokerage' | 'rsu' | 'espp' | 'hsa'
  | 'traditional_ira' | 'roth_ira' | '401k' | 'roth_401k'
  | 'property'
  | 'credit_card' | 'loan_mortgage'
  // What guessAccountType returns when it recognizes nothing. Deliberately
  // not a default of 'cash': an unknown account silently counted as an asset
  // inflates net worth, which is the wrong direction for this app to fail in.
  | 'uncategorized';

// Client-facing (serialized) account shape. The DB stores `balance` as a
// Decimal; the query layer converts it to a JS number and timestamps to ISO
// strings so the wire shape matches the rest of the app's money model.
export interface Account {
  id: string;
  name: string;
  type: AccountType;
  institution: string | null;
  // Dollars, in the bucket's natural direction: what you hold for an asset,
  // what you owe for a debt. EITHER SIGN IS VALID — an overdrawn asset and a
  // card carrying a statement credit are both real, and neither is clamped.
  // describeAccountBalance in lib/account-utils.ts owns the display
  // convention. See docs/decisions/0011-signed-contribution-at-write-time.md.
  balance: number;
  balanceAsOf: string;  // ISO — updated only when the balance changes
  // Left out of every net-worth figure — the cards, the bucket totals, and the
  // chart's whole history — while staying listed in its bucket.
  hiddenFromNetWorth: boolean;
  createdAt: string;    // ISO
  updatedAt: string;    // ISO
}

export interface NetWorthSummary {
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
}

// Accounts grouped under their bucket for display on the Net Worth page.
export interface AccountBucketGroup {
  bucket: AccountBucket;
  label: string;
  accounts: Account[];
  bucketTotal: number;
}

// Write shapes shared by the validation module, the query layer, and the client.
// Kept here (pure types) so neither has to import the server-only query module.
export interface AccountInput {
  name: string;
  type: AccountType;
  institution: string | null;
  balance: number;
}

// PATCH allows any subset of the create fields (but never an empty patch).
// `archivedAt` is a narrow bolt-on for Restore: the ONLY
// legal value is `null` (clearing it) — there is no PATCH-based way to
// archive an account, that stays DELETE-only (archiveAccount). Restoring is
// an explicit user action, which is the authority level the monotone-
// archiving ruling in lib/accounts.ts reserves for overriding an
// import-inferred archive. `hiddenFromNetWorth` is PATCH-only too: creating
// an account always counts it.
export type AccountPatch = Partial<AccountInput> & {
  archivedAt?: null;
  hiddenFromNetWorth?: boolean;
};

// --- Financial Profile -------------------------------------------------------
// Declared planning inputs. String unions enforced in the app layer (like
// AccountType), so a new kind or frequency needs no migration. Labels and type
// guards live in lib/financial-profile-utils.ts.

export type IncomeKind =
  | 'salary'
  | 'bonus'
  | 'rsu'
  | 'espp'
  | 'rental'
  | 'self_employment'
  | 'interest_dividends'
  | 'other';

// How a stream is paid. Informational: every calculation reads annualAmount.
export type PayFrequency =
  | 'weekly'
  | 'biweekly'
  | 'semimonthly'
  | 'monthly'
  | 'quarterly'
  | 'semiannual'
  | 'annual'
  | 'irregular';

export type FilingStatus =
  | 'single'
  | 'married_joint'
  | 'married_separate'
  | 'head_of_household'
  | 'qualifying_surviving_spouse';

export interface IncomeStream {
  kind: IncomeKind;
  label: string | null;
  annualAmount: number; // gross, before tax
  frequency: PayFrequency | null;
}

// The employer matches `matchPct`% of the user's contributions, up to
// `limitPct`% of salary.
export interface EmployerMatch {
  matchPct: number;
  limitPct: number;
}

export interface ContributionTarget {
  accountId: string;
  annualAmount: number;
}

// An account the contribution-target editor can show. `eligible: false` only
// ever appears on an account the current version already names and that has
// since been re-typed out of cash/investments/retirement — it is shown so the
// row can be seen and removed, never offered for a new target.
export interface ContributionAccountOption {
  id: string;
  name: string;
  type: AccountType;
  archived: boolean;
  eligible: boolean;
}

// The write shape: what the form sends and the parser returns. `age` is the
// user's current age; it becomes FinancialProfile's age anchor (see 0014).
// Percents are as typed (4 means 4%).
export interface FinancialProfileInput {
  age: number;
  targetRetirementAge: number;
  expectedRealReturnPct: number;
  safeWithdrawalRatePct: number;
  inflationPct: number;
  filingStatus: FilingStatus | null;
  employerMatch: EmployerMatch | null;
  incomeStreams: IncomeStream[];
  contributionTargets: ContributionTarget[];
}

// One saved version. The age is stored as an anchor — an age the user typed
// and when it was true — which can be older than the version itself. Derive
// the current age with ageOn(); never read anchoredAge as if it were today's.
export type FinancialProfile = Omit<FinancialProfileInput, 'age'> & {
  version: number;
  effectiveAt: string; // ISO timestamp
  anchoredAge: number;
  ageAnchoredAt: string; // ISO timestamp
};

// ── Market history (FIRE calculator) ──────────────────────────────────────
// Shiller's U.S. history, embedded by scripts/build-market-history.py in
// lib/market-history-data.ts and lib/cpi-data.ts.

// One calendar year of real (inflation-adjusted) total return, as fractions
// (0.07 is 7%), because lib/fire-simulation.ts works in fractions, not the
// percents the levers and profile use.
export interface AnnualRealReturn {
  year: number;
  stocks: number;
  bonds: number;
}

// The raw CPI index level for a month ("YYYY-MM", the same key shape the rest
// of the app uses), not an inflation rate.
export interface MonthlyCpi {
  month: string;
  cpi: number;
}

// A one-off purchase that computeSpendingBaseline spread over its useful life
// instead of counting in the month it happened (see decision 0016).
// `amount` is what was paid, `realAmount` the same purchase in today's dollars,
// and `annualized` the yearly slice of `realAmount` that enters the baseline.
export interface AmortizedPurchase {
  date: string; // "YYYY-MM-DD"
  description: string;
  amount: number;
  realAmount: number;
  annualized: number;
}

// Annual spending in today's dollars, measured over the whole usable
// transaction history. `fromMonth`/`toMonth` ("YYYY-MM") bound the complete
// months that were averaged and `months` is how many they span; `cpiThrough`
// is the last month of the CPI table the restatement used.
export interface SpendingBaseline {
  annualSpending: number;
  regularAnnual: number;
  amortizedAnnual: number;
  months: number;
  fromMonth: string;
  toMonth: string;
  cpiThrough: string;
  amortized: AmortizedPurchase[];
}

// ── FIRE calculator inputs ────────────────────────────────────────────────
// What lib/fire-inputs.ts reduces the profile, accounts and transaction
// history to, so the page can hand the client one object.

// What can be drawn on to fund retirement: cash, investments and retirement
// accounts, net of credit-card debt. A home and its mortgage are left out
// because living in the house is not a withdrawal. `creditCardDebt` is net
// owed, so a statement credit makes it smaller and can take it below zero.
export interface InvestablePortfolio {
  total: number;
  cash: number;
  investments: number;
  retirement: number;
  creditCardDebt: number;
}

// What lands in the bank each year after tax and payroll deductions: income
// transactions annualized over the `months` complete months measured.
export interface TakeHome {
  annual: number;
  months: number;
}

// Everything the FIRE page starts from. Percents are as typed in the profile
// (5 means 5%) and `asOf` is "YYYY-MM-DD". `grossIncome` is every declared
// stream except interest and dividends, which the historical returns already
// reinvest; `excludedPassiveIncome` is how much that left out. `cashIncome`
// leaves out the kinds that rarely land in checking, and is what
// `derivedTaxRatePct` is measured against — see
// docs/decisions/0017-fire-savings-from-profile-income.md.
export interface FireInputs {
  asOf: string;
  age: number;
  targetRetirementAge: number;
  portfolio: InvestablePortfolio;
  spending: SpendingBaseline;
  grossIncome: number;
  excludedPassiveIncome: number;
  cashIncome: number;
  takeHome: TakeHome | null;
  payrollDeductions: number;
  employerMatch: number;
  derivedTaxRatePct: number | null;
  profileRealReturnPct: number;
  profileInflationPct: number;
  profileSafeWithdrawalRatePct: number;
}

// The sliders on the FIRE page, in percent as typed (5 means 5%). The state is
// spending, not the savings rate: the savings-rate slider is a view of
// spending, so changing the tax rate leaves spending alone and moves the
// savings rate. `effectiveTaxRatePct` is null when the transactions could not
// derive one and the user has not set it. See lib/fire-levers.ts.
export interface FireLevers {
  nominalReturnPct: number;
  inflationPct: number;
  annualSpending: number;
  safeWithdrawalRatePct: number;
  stockAllocationPct: number;
  effectiveTaxRatePct: number | null;
}

// The page shows the calculator only when it has a profile and a spending
// history to build on; otherwise it says which one is missing.
export type FirePageState =
  | { state: 'ready'; inputs: FireInputs }
  | { state: 'no-profile' }
  | { state: 'no-spending' };
