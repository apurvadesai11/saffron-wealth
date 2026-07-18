// Budget period — v1 only exposes 'monthly' in the UI, but the data model
// supports non-monthly periods so quarterly/semi-annual/annual budgets can be
// added in a future release without a schema migration.
export type BudgetPeriod = 'monthly' | 'quarterly' | 'semi-annual' | 'annual';

export type CategoryType = 'expense' | 'income';

export interface Category {
  id: string;
  name: string;
  type: CategoryType;
  color: string; // Tailwind bg-* class for visual indicator
}

export interface Transaction {
  id: number;
  description: string;
  amount: number;
  categoryId: string;
  type: CategoryType;
  date: string; // "YYYY-MM-DD"
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
  | 'hibp_unavailable'
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
export type AccountBucket = 'cash' | 'investments' | 'retirement' | 'real_estate' | 'debt';

export type AccountType =
  | 'cash'
  | 'brokerage' | 'rsu' | 'espp' | 'hsa'
  | 'traditional_ira' | 'roth_ira' | '401k' | 'roth_401k'
  | 'property'
  | 'credit_card' | 'loan_mortgage';

// Client-facing (serialized) account shape. The DB stores `balance` as a
// Decimal; the query layer converts it to a JS number and timestamps to ISO
// strings so the wire shape matches the rest of the app's money model.
export interface Account {
  id: string;
  name: string;
  type: AccountType;
  institution: string | null;
  balance: number;      // dollars; positive — liabilities are the amount owed
  balanceAsOf: string;  // ISO — updated only when the balance changes
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
export type AccountPatch = Partial<AccountInput>;
