import { Budget, Category, Transaction } from '@/lib/types';
import {
  getCashflowProjection,
  getPeriodSpendByCategory,
  getDaysElapsedInPeriod,
} from '@/lib/budget-utils';

interface Props {
  transactions: Transaction[];
  budgets: Budget[];
  categories: Category[];
  asOf: Date;
}

export default function CashflowCard({ transactions, budgets, categories, asOf }: Props) {
  const projection   = getCashflowProjection(transactions, budgets, categories, asOf);
  const daysElapsed  = getDaysElapsedInPeriod(asOf, 'monthly');

  // Month-to-date actuals: sum all transactions recorded this period. One pass
  // over the array, then a lookup per category — the per-category filter this
  // replaced walked every transaction once for each of ~40 categories, twice.
  const spendByCategory = getPeriodSpendByCategory(transactions, 'monthly', asOf);

  const totalReceived = categories
    .filter(c => c.type === 'income')
    .reduce((sum, c) => sum + (spendByCategory.get(c.id) ?? 0), 0);

  const totalSpent = categories
    .filter(c => c.type === 'expense')
    .reduce((sum, c) => sum + (spendByCategory.get(c.id) ?? 0), 0);

  const mtdNet        = totalReceived - totalSpent;
  const netPositive   = projection.projectedNet >= 0;
  const mtdPositive   = mtdNet >= 0;
  const hasMtdData    = totalReceived > 0 || totalSpent > 0;

  return (
    <div className="bg-surface rounded-xl shadow-sm border border-line-subtle p-5">
      <p className="text-xs font-semibold text-fg-faint uppercase tracking-wide mb-4">
        Cashflow Forecast
      </p>

      {/* ── Row 1: planned totals + projected net ─────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="text-xs text-fg-muted mb-1">Budgeted Income</p>
          <p className="text-xl font-bold text-success">
            ${projection.budgetedIncome.toLocaleString()}
          </p>
        </div>

        <div>
          <p className="text-xs text-fg-muted mb-1">Budgeted Expenses</p>
          <p className="text-xl font-bold text-fg-soft">
            ${projection.budgetedExpenses.toLocaleString()}
          </p>
        </div>

        <div>
          <p className="text-xs text-fg-muted mb-1">Projected Net</p>
          <p className={`text-xl font-bold ${netPositive ? 'text-accent' : 'text-danger'}`}>
            {netPositive ? '+' : ''}${Math.round(projection.projectedNet).toLocaleString()}
          </p>
          {/* Sub-label communicates whether this is a live projection or just the plan */}
          <p className="text-xs text-fg-faint mt-0.5">
            {projection.isStaticProjection
              ? 'budget plan'
              : netPositive ? 'projected surplus' : 'projected deficit'
            }
          </p>
        </div>
      </div>

      {/* ── Divider ───────────────────────────────────────────────────── */}
      <div className="border-t border-line-subtle my-4" />

      {/* ── Row 2: month-to-date actuals ──────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold text-fg-faint uppercase tracking-wide mb-2">
          Month to Date
        </p>

        {hasMtdData ? (
          <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-sm">
            <span className="text-fg-tertiary">
              Received{' '}
              <span className="font-semibold text-success">
                ${totalReceived.toLocaleString()}
              </span>
            </span>
            <span className="text-fg-ghost select-none">·</span>
            <span className="text-fg-tertiary">
              Spent{' '}
              <span className="font-semibold text-fg-soft">
                ${totalSpent.toLocaleString()}
              </span>
            </span>
            <span className="text-fg-ghost select-none">·</span>
            <span className="text-fg-tertiary">
              Net{' '}
              <span className={`font-semibold ${mtdPositive ? 'text-accent' : 'text-danger'}`}>
                {mtdPositive ? '+' : ''}${mtdNet.toLocaleString()}
              </span>
            </span>
          </div>
        ) : (
          <p className="text-sm text-fg-faint italic">No transactions recorded yet.</p>
        )}
      </div>

      {/* ── Projection context note ───────────────────────────────────── */}
      <p className="text-xs text-fg-faint mt-3">
        {projection.isStaticProjection
          ? 'Showing budget plan — no spending data to project from yet.'
          : `Projecting from ${daysElapsed} day${daysElapsed === 1 ? '' : 's'} of spending data.`
        }
      </p>
    </div>
  );
}
