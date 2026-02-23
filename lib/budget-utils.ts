import {
  Budget,
  BudgetPeriod,
  Category,
  Transaction,
  AlertRecord,
  AlertThreshold,
  ExpenseBarColor,
  IncomeBarColor,
  CashflowProjection,
  BudgetProgress,
} from './types';

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

// Parse an ISO date string ("YYYY-MM-DD") as a local date, avoiding the
// UTC-midnight-to-local-day-shift that new Date("YYYY-MM-DD") causes.
function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

// ---------------------------------------------------------------------------
// Period bounds & keys
// ---------------------------------------------------------------------------

/**
 * Returns the inclusive [start, end] dates of the period that contains `date`.
 * Monthly is fully implemented for v1. Quarterly/semi-annual/annual are
 * structurally complete stubs ready for future activation.
 */
export function getPeriodBounds(date: Date, period: BudgetPeriod): [Date, Date] {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed

  switch (period) {
    case 'monthly': {
      const start = new Date(year, month, 1);
      const end = new Date(year, month + 1, 0); // day 0 of next month = last day of this month
      return [start, end];
    }
    case 'quarterly': {
      // TODO: activate for quarterly budget support
      const quarterStartMonth = Math.floor(month / 3) * 3;
      const start = new Date(year, quarterStartMonth, 1);
      const end = new Date(year, quarterStartMonth + 3, 0);
      return [start, end];
    }
    case 'semi-annual': {
      // TODO: activate for semi-annual budget support
      const halfStartMonth = month < 6 ? 0 : 6;
      const start = new Date(year, halfStartMonth, 1);
      const end = new Date(year, halfStartMonth + 6, 0);
      return [start, end];
    }
    case 'annual': {
      // TODO: activate for annual budget support
      const start = new Date(year, 0, 1);
      const end = new Date(year, 12, 0);
      return [start, end];
    }
  }
}

/**
 * Returns a string key for the period containing `date`, used to scope
 * alert records to the correct period.
 *
 * Examples:
 *   monthly      → "2026-01"
 *   quarterly    → "2026-Q1"
 *   semi-annual  → "2026-H1"
 *   annual       → "2026"
 */
export function getPeriodKey(date: Date, period: BudgetPeriod): string {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed

  switch (period) {
    case 'monthly':
      return `${year}-${String(month + 1).padStart(2, '0')}`;
    case 'quarterly': {
      const quarter = Math.floor(month / 3) + 1;
      return `${year}-Q${quarter}`;
    }
    case 'semi-annual':
      return `${year}-H${month < 6 ? 1 : 2}`;
    case 'annual':
      return `${year}`;
  }
}

// ---------------------------------------------------------------------------
// Spend calculations
// ---------------------------------------------------------------------------

/**
 * Sum of all transactions for `categoryId` within the period that contains `asOf`.
 */
export function getCurrentPeriodSpend(
  transactions: Transaction[],
  categoryId: string,
  period: BudgetPeriod,
  asOf: Date
): number {
  const [start, end] = getPeriodBounds(asOf, period);

  return transactions
    .filter(t => {
      if (t.categoryId !== categoryId) return false;
      const d = parseLocalDate(t.date);
      return d >= start && d <= end;
    })
    .reduce((sum, t) => sum + t.amount, 0);
}

/**
 * Historical average spend per period for `categoryId`.
 *
 * Looks back up to 12 complete periods (not including the current period).
 * Returns null when the category has no transaction history.
 * `periodsOfData` < 2 should trigger a "limited history" warning in the UI (US-02 AC).
 *
 * Note: non-monthly periods are not yet implemented — returns null until
 * the corresponding budget period UI is built.
 */
export function getHistoricalAverage(
  transactions: Transaction[],
  categoryId: string,
  period: BudgetPeriod,
  asOf: Date
): { average: number; periodsOfData: number } | null {
  if (period !== 'monthly') {
    // TODO: implement for quarterly, semi-annual, and annual periods
    return null;
  }

  const maxPeriods = 12;
  let totalSpend = 0;
  let periodsWithData = 0;

  for (let i = 1; i <= maxPeriods; i++) {
    // Step back i months from asOf to get a prior period
    const targetDate = new Date(asOf.getFullYear(), asOf.getMonth() - i, 1);
    const [start, end] = getPeriodBounds(targetDate, 'monthly');

    const periodTotal = transactions
      .filter(t => {
        if (t.categoryId !== categoryId) return false;
        const d = parseLocalDate(t.date);
        return d >= start && d <= end;
      })
      .reduce((sum, t) => sum + t.amount, 0);

    if (periodTotal > 0) periodsWithData++;
    totalSpend += periodTotal;
  }

  if (periodsWithData === 0) return null;

  // Average over months that had actual spend (mirrors how a user mentally
  // estimates "what do I normally spend on this?")
  const average = totalSpend / periodsWithData;
  return { average, periodsOfData: periodsWithData };
}

// ---------------------------------------------------------------------------
// Progress bar helpers
// ---------------------------------------------------------------------------

/**
 * Percent of budget used. Can exceed 100 when over budget.
 * Returns 0 for hidden categories (budget === 0) to avoid division by zero.
 */
export function getProgressPercent(spent: number, budgetAmount: number): number {
  if (budgetAmount === 0) return 0;
  return (spent / budgetAmount) * 100;
}

/**
 * Color state for expense progress bars.
 *
 *  < 80%   → green
 *  ≥ 80%   → yellow
 *  ≥ 100%  → red     (exactly at budget)
 *  > 100%  → deep-red
 */
export function getExpenseBarColor(percent: number): ExpenseBarColor {
  if (percent > 100) return 'deep-red';
  if (percent >= 100) return 'red';
  if (percent >= 80) return 'yellow';
  return 'green';
}

/**
 * Color state for income progress bars — inverse model reflecting how much of
 * expected income has been received.
 *
 *  < 50%   → red
 *  ≥ 50%   → orange
 *  ≥ 80%   → yellow
 *  ≥ 100%  → green
 */
export function getIncomeBarColor(percent: number): IncomeBarColor {
  if (percent >= 100) return 'green';
  if (percent >= 80) return 'yellow';
  if (percent >= 50) return 'orange';
  return 'red';
}

// ---------------------------------------------------------------------------
// Cashflow projection  (FR-20 – FR-24)
// ---------------------------------------------------------------------------

/**
 * Returns the number of calendar days remaining in the period that contains
 * `asOf`, inclusive of today.
 */
export function getDaysRemainingInPeriod(asOf: Date, period: BudgetPeriod): number {
  const [, end] = getPeriodBounds(asOf, period);
  const msPerDay = 1000 * 60 * 60 * 24;
  // Normalize both to midnight to avoid fractional-day errors
  const todayMidnight = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  return Math.round((end.getTime() - todayMidnight.getTime()) / msPerDay) + 1;
}

/**
 * Returns the number of calendar days elapsed since the start of the period,
 * inclusive of today (minimum 1).
 */
export function getDaysElapsedInPeriod(asOf: Date, period: BudgetPeriod): number {
  const [start] = getPeriodBounds(asOf, period);
  const msPerDay = 1000 * 60 * 60 * 24;
  const todayMidnight = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  return Math.max(1, Math.round((todayMidnight.getTime() - start.getTime()) / msPerDay) + 1);
}

/**
 * Aggregate cashflow projection for the period containing `asOf`.
 *
 * - Expenses: per-category rate (spent ÷ days elapsed) extrapolated to period-end, then summed.
 * - Income:   fixed budgeted amount (not rate-based).
 * - Day 1 or no transactions yet: falls back to static budget totals (FR-24).
 *
 * v1 only supports monthly period for projection; returns zeroed result for
 * other periods until those UI surfaces are built.
 */
export function getCashflowProjection(
  transactions: Transaction[],
  budgets: Budget[],
  categories: Category[],
  asOf: Date
): CashflowProjection {
  const period: BudgetPeriod = 'monthly'; // v1: projection only for monthly
  const [periodStart, periodEnd] = getPeriodBounds(asOf, period);

  const msPerDay = 1000 * 60 * 60 * 24;
  const totalDays =
    Math.round((periodEnd.getTime() - periodStart.getTime()) / msPerDay) + 1;

  const todayMidnight = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  const daysElapsed =
    Math.max(1, Math.round((todayMidnight.getTime() - periodStart.getTime()) / msPerDay) + 1);

  const expenseCategories = categories.filter(c => c.type === 'expense');
  const incomeCategories = categories.filter(c => c.type === 'income');

  // Sum of budgeted income and expense amounts
  const budgetedIncome = incomeCategories.reduce((sum, cat) => {
    const b = budgets.find(b => b.categoryId === cat.id && b.period === period);
    return sum + (b ? b.amount : 0);
  }, 0);

  const budgetedExpenses = expenseCategories.reduce((sum, cat) => {
    const b = budgets.find(b => b.categoryId === cat.id && b.period === period);
    return sum + (b ? b.amount : 0);
  }, 0);

  // Check if we're on day 1 or there are no transactions yet this period (FR-24)
  const periodTransactions = transactions.filter(t => {
    const d = parseLocalDate(t.date);
    return d >= periodStart && d <= periodEnd;
  });

  if (daysElapsed <= 1 || periodTransactions.length === 0) {
    return {
      budgetedIncome,
      budgetedExpenses,
      projectedExpenses: budgetedExpenses,
      projectedNet: budgetedIncome - budgetedExpenses,
      isStaticProjection: true,
    };
  }

  // Rate-based projection: per-category spend rate × total days in period
  const projectedExpenses = expenseCategories.reduce((sum, cat) => {
    const spent = getCurrentPeriodSpend(transactions, cat.id, period, asOf);
    const rate = spent / daysElapsed;
    return sum + rate * totalDays;
  }, 0);

  return {
    budgetedIncome,
    budgetedExpenses,
    projectedExpenses,
    projectedNet: budgetedIncome - projectedExpenses,
    isStaticProjection: false,
  };
}

// ---------------------------------------------------------------------------
// Alert logic  (FR-15 – FR-19)
// ---------------------------------------------------------------------------

/**
 * Returns thresholds that should fire alerts right now for a given category.
 *
 * A threshold fires when:
 *   - The category's spend has crossed it, AND
 *   - No existing AlertRecord for this category + period + threshold exists.
 *
 * Alert reset (FR-19): when a budget is increased such that spend drops below
 * a previously-fired threshold, the caller is responsible for removing the
 * stale AlertRecord so this function will re-fire if the threshold is crossed
 * again.
 *
 * Returns an array because both thresholds can become pending simultaneously
 * (e.g. when a budget is decreased sharply in one step).
 */
export function getPendingAlerts(
  currentSpend: number,
  budget: Budget,
  alertRecords: AlertRecord[],
  categoryId: string,
  asOf: Date
): AlertThreshold[] {
  // No alerts for hidden categories or income categories (FR-14)
  if (budget.amount === 0) return [];

  const percent = getProgressPercent(currentSpend, budget.amount);
  const periodKey = getPeriodKey(asOf, budget.period);

  const fired = new Set(
    alertRecords
      .filter(r => r.categoryId === categoryId && r.periodKey === periodKey)
      .map(r => r.threshold)
  );

  const pending: AlertThreshold[] = [];

  if (percent >= 80 && !fired.has(80)) pending.push(80);
  if (percent >= 100 && !fired.has(100)) pending.push(100);

  return pending;
}

// ---------------------------------------------------------------------------
// Convenience: build BudgetProgress view models for the budget list UI
// ---------------------------------------------------------------------------

/**
 * Builds a BudgetProgress view model for every category that has a budget set.
 * Categories with no Budget record are excluded (FR-06).
 */
export function buildBudgetProgressList(
  categories: Category[],
  budgets: Budget[],
  transactions: Transaction[],
  asOf: Date
): BudgetProgress[] {
  const period: BudgetPeriod = 'monthly'; // v1 UI only shows monthly budgets

  return categories
    .flatMap(cat => {
      const budget = budgets.find(b => b.categoryId === cat.id && b.period === period);
      if (!budget) return []; // no budget set → not shown (FR-06)

      const spent = getCurrentPeriodSpend(transactions, cat.id, period, asOf);
      const percent = getProgressPercent(spent, budget.amount);

      const barColor =
        cat.type === 'expense'
          ? getExpenseBarColor(percent)
          : getIncomeBarColor(percent);

      return [{
        categoryId: cat.id,
        categoryName: cat.name,
        categoryType: cat.type,
        budgetAmount: budget.amount,
        spent,
        percent,
        barColor,
        isHidden: budget.amount === 0,
      } satisfies BudgetProgress];
    });
}

// ---------------------------------------------------------------------------
// Alert message formatting  (FR-15, FR-16)
// ---------------------------------------------------------------------------

/**
 * Produces the exact in-app alert message text specified in the PRD.
 *
 * 80%  → "You've used {X}% of your {Category} budget. ${remaining} left with {N} days to go."
 * 100% → "You've reached your {Category} budget. You're ${overage} over with {N} days remaining."
 *
 * remaining is floored at $0 so a >100% state never shows a negative "left" amount
 * in the 80% message when both alerts appear simultaneously.
 */
export function formatAlertMessage(
  threshold: AlertThreshold,
  categoryName: string,
  spent: number,
  budgetAmount: number,
  daysRemaining: number
): string {
  const dayWord = daysRemaining === 1 ? 'day' : 'days';

  if (threshold === 80) {
    const percent  = Math.round((spent / budgetAmount) * 100);
    const remaining = Math.max(0, budgetAmount - spent);
    return (
      `You've used ${percent}% of your ${categoryName} budget. ` +
      `$${remaining.toFixed(0)} left with ${daysRemaining} ${dayWord} to go.`
    );
  }

  // threshold === 100
  const overage = Math.max(0, spent - budgetAmount);
  return (
    `You've reached your ${categoryName} budget. ` +
    `You're $${overage.toFixed(0)} over with ${daysRemaining} ${dayWord} remaining.`
  );
}
